//! Команды индекса.
//!
//! Логики здесь нет: очередь и отмену ведёт `index/jobs.rs`, запрос —
//! `index/query.rs`.

use crate::index::jobs::Progress;
use crate::index::query::Hit;
use crate::model::root::RootId;
use crate::state::AppState;

type Fallible<T> = Result<T, String>;

/// Поставить корень в очередь на индексацию.
///
/// Полный проход сверяет то, что на диске, с тем, что в базе, и перечитывает
/// только изменившееся. Поэтому «переиндексировать» стоит дёшево и зовётся
/// при каждом добавлении корня и при каждом запуске.
pub fn schedule_scan(state: &AppState, root_id: RootId) {
    let Some((path, rules, max_size)) = ({
        let roots = state.roots.lock().expect("реестр корней повреждён");
        roots.get(root_id).filter(|root| root.available).map(|root| {
            (
                root.path.clone(),
                root.rules.clone(),
                root.project.index.max_file_size,
            )
        })
    }) else {
        return;
    };

    state
        .index
        .lock()
        .expect("индекс повреждён")
        .scan_root(root_id, path, rules, max_size);
}

#[tauri::command]
pub fn index_progress(state: tauri::State<'_, AppState>) -> Progress {
    state.index.lock().expect("индекс повреждён").progress()
}

/// Сколько файлов корня лежит в индексе.
#[tauri::command]
pub fn index_count(state: tauri::State<'_, AppState>, root_id: RootId) -> u64 {
    state.index.lock().expect("индекс повреждён").count(root_id)
}

/// Отменить индексацию — и ту, что идёт, и ту, что стоит в очереди.
#[tauri::command]
pub fn cancel_index(state: tauri::State<'_, AppState>) {
    state.index.lock().expect("индекс повреждён").cancel();
}

/// Запустить индексацию корня заново.
#[tauri::command]
pub fn reindex_root(state: tauri::State<'_, AppState>, root_id: RootId) {
    schedule_scan(&state, root_id);
}

/// Поиск по содержимому.
///
/// `root_id` не задан — ищем во всех корнях сразу.
#[tauri::command]
pub fn search_project(
    state: tauri::State<'_, AppState>,
    query: String,
    root_id: Option<RootId>,
    limit: Option<u32>,
) -> Fallible<Vec<Hit>> {
    state
        .index
        .lock()
        .expect("индекс повреждён")
        .search(&query, root_id, limit.unwrap_or(200))
}
