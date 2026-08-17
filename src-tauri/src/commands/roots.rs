//! Команды корней: папка как проект.
//!
//! Логики здесь нет: список ведёт `model/root.rs`, файл проекта разбирает
//! `project/`, запись делает `fsx/atomic_save.rs`.

use std::path::PathBuf;

use crate::fsx::atomic_save;
use crate::model::root::{Root, RootId};
use crate::project;
use crate::state::AppState;

type Fallible<T> = Result<T, String>;

/// Каким корень виден фронтенду.
///
/// Правил игнорирования и разобранного проекта здесь нет: интерфейсу они
/// не нужны, а лишнее в протоколе потом придётся поддерживать.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootView {
    pub id: RootId,
    pub path: String,
    pub name: String,
    pub has_project_file: bool,
    pub available: bool,
    pub problems: Vec<String>,
}

impl RootView {
    pub fn of(root: &Root) -> RootView {
        RootView {
            id: root.id,
            path: root.path.display().to_string(),
            name: root.name.clone(),
            has_project_file: root.has_project_file,
            available: root.available,
            problems: root.problems.clone(),
        }
    }
}

#[tauri::command]
pub fn list_roots(state: tauri::State<'_, AppState>) -> Vec<RootView> {
    let roots = state.roots.lock().expect("реестр корней повреждён");
    roots.list().iter().map(RootView::of).collect()
}

/// Добавить папку корнем.
///
/// Ничего в неё не пишет — ни файла проекта, ни служебных отметок (Р-049).
/// Проверяется тестом `adding_a_root_writes_nothing_into_the_folder`.
#[tauri::command]
pub fn add_root(state: tauri::State<'_, AppState>, path: String) -> Fallible<RootView> {
    let path = PathBuf::from(path);

    // Несуществующую папку добавлять незачем: пользователь выбирает её
    // системным диалогом, и промах здесь означает опечатку в чужом сценарии.
    // Пропавший позже корень — другое дело, он остаётся в списке (Р-052).
    if !path.is_dir() {
        return Err(format!("{} — это не папка", path.display()));
    }

    let mut roots = state.roots.lock().expect("реестр корней повреждён");
    Ok(RootView::of(roots.add(path)))
}

#[tauri::command]
pub fn remove_root(state: tauri::State<'_, AppState>, id: RootId) -> bool {
    let mut roots = state.roots.lock().expect("реестр корней повреждён");
    roots.remove(id)
}

/// Перечитать корни: файлы проектов и доступность папок.
///
/// Зовётся при возвращении фокуса в окно — тогда же, когда сверяются открытые
/// файлы (Р-014). Именно в этот момент пользователь мог поправить
/// `zeronote.toml` в другой программе или подключить пропавший диск.
#[tauri::command]
pub fn refresh_roots(state: tauri::State<'_, AppState>) -> Vec<RootView> {
    let mut roots = state.roots.lock().expect("реестр корней повреждён");
    roots.reload_all();
    roots.list().iter().map(RootView::of).collect()
}

/// Создать `zeronote.toml` в корне — по явной команде пользователя.
///
/// Существующий файл не трогаем никогда: в нём могут быть правки и
/// комментарии. Тот же приём, что у `settings.toml` и `keymap.toml`.
#[tauri::command]
pub fn create_project_file(state: tauri::State<'_, AppState>, id: RootId) -> Fallible<RootView> {
    let path = {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        let root = roots.get(id).ok_or("корень не найден")?;
        project::project_path(&root.path)
    };

    if path.exists() {
        return Err(format!("{} уже существует", path.display()));
    }

    // Через атомарную запись, как и всё остальное: заодно она откажется
    // писать внутрь `.obsidian` (инвариант 2).
    atomic_save::save(&path, project::DEFAULT_TEMPLATE.as_bytes()).map_err(|e| e.to_string())?;

    let mut roots = state.roots.lock().expect("реестр корней повреждён");
    let root = roots.get_mut(id).ok_or("корень не найден")?;
    root.reload();
    Ok(RootView::of(root))
}
