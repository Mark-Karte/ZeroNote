//! Команды индекса.
//!
//! Логики здесь нет: очередь и отмену ведёт `index/jobs.rs`, запрос —
//! `index/query.rs`.

use crate::index::graph::{Backlink, Resolved, TagHit, Tagged};
use crate::index::jobs::Progress;
use crate::index::names::FileHit;
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

/// Куда ведёт `[[ссылка]]`. `null` — ссылка висячая.
///
/// Корень определяется по файлу, из которого ссылаются: ссылка не покидает
/// пределов своего проекта.
#[tauri::command]
pub fn resolve_link(
    state: tauri::State<'_, AppState>,
    target: String,
    from: String,
) -> Option<Resolved> {
    let root_id = {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        roots.for_path(std::path::Path::new(&from)).map(|r| r.id)?
    };

    state
        .index
        .lock()
        .expect("индекс повреждён")
        .resolve_link(&target, &from, root_id)
}

/// Какие из этих ссылок ведут в существующие заметки.
///
/// Пачкой, а не по одной: редактор спрашивает про все ссылки видимой части
/// сразу, и полсотни отдельных вызовов ради полусотни строк — это полсотни
/// пересечений границы IPC на каждую прокрутку.
#[tauri::command]
pub fn resolve_links(
    state: tauri::State<'_, AppState>,
    targets: Vec<String>,
    from: String,
) -> Vec<bool> {
    let root_id = {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        roots.for_path(std::path::Path::new(&from)).map(|r| r.id)
    };

    // Файл вне корней: разрешать ссылки не по чему, и висячими они тоже
    // не считаются — мы просто не знаем.
    let Some(root_id) = root_id else {
        return vec![true; targets.len()];
    };

    let index = state.index.lock().expect("индекс повреждён");
    targets
        .iter()
        .map(|target| index.resolve_link(target, &from, root_id).is_some())
        .collect()
}

/// Кто ссылается на этот файл.
#[tauri::command]
pub fn backlinks(state: tauri::State<'_, AppState>, path: String) -> Vec<Backlink> {
    state.index.lock().expect("индекс повреждён").backlinks(&path)
}

/// Файлы, помеченные тегом. Вложенные теги считаются: `#работа` находит
/// и `#работа/срочное`.
#[tauri::command]
pub fn files_with_tag(
    state: tauri::State<'_, AppState>,
    tag: String,
    limit: Option<u32>,
) -> Vec<Tagged> {
    state
        .index
        .lock()
        .expect("индекс повреждён")
        .files_with_tag(&tag, limit.unwrap_or(200))
}

/// Теги проекта для палитры в режиме `#`.
///
/// Пустой запрос выдаёт самые частые теги, а не пустоту: палитра должна
/// показывать, что в проекте вообще есть.
#[tauri::command]
pub fn find_tags(
    state: tauri::State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> Vec<TagHit> {
    state
        .index
        .lock()
        .expect("индекс повреждён")
        .find_tags(&query, limit.unwrap_or(50))
}

/// Быстрое открытие: нечёткий поиск по именам файлов.
///
/// Пустой запрос выдаёт список файлов, а не пустоту: палитра при открытии
/// должна что-то показывать.
#[tauri::command]
pub fn find_files(
    state: tauri::State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> Vec<FileHit> {
    let files = state.index.lock().expect("индекс повреждён").files();

    // Путь корня из сопоставления убираем. Иначе совпадать будет он сам:
    // папка вроде `C:\Users\пользователь\Desktop\Project` содержит столько
    // букв, что под неё подходит почти любой запрос, и в выдачу попадают
    // все файлы проекта разом. Найдено это живой проверкой, а не тестом.
    let prefixes: Vec<(u64, String)> = {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        roots
            .list()
            .iter()
            .map(|root| (root.id, root.path.display().to_string()))
            .collect()
    };

    let relative = files.into_iter().map(|(root_id, path, name)| {
        let inside = prefixes
            .iter()
            .find(|(id, _)| *id == root_id)
            .and_then(|(_, prefix)| path.get(prefix.len()..))
            .map(|tail| tail.trim_start_matches(['\\', '/']).to_owned())
            .unwrap_or_else(|| path.clone());
        (root_id, path, name, inside)
    });

    crate::index::names::best(&query, relative, limit.unwrap_or(50) as usize)
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
