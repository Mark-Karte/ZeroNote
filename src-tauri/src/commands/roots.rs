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
    /// В папке есть `.obsidian` — можно предложить перенос настроек.
    pub has_obsidian_config: bool,
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
            has_obsidian_config: root.has_obsidian_config,
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

    let view = {
        let mut roots = state.roots.lock().expect("реестр корней повреждён");
        RootView::of(roots.add(path))
    };

    // Наблюдатель ставится уже без блокировки реестра: обращение к системе
    // не должно задерживать остальные команды.
    state
        .watchers
        .lock()
        .expect("наблюдатели повреждены")
        .watch(view.id, std::path::Path::new(&view.path));

    // Индексация уходит в фон и на возврат из команды не влияет: папка
    // должна появиться в дереве сразу, а не через полминуты (инвариант 6).
    super::index::schedule_scan(&state, view.id);

    Ok(view)
}

#[tauri::command]
pub fn remove_root(state: tauri::State<'_, AppState>, id: RootId) -> bool {
    let removed = {
        let mut roots = state.roots.lock().expect("реестр корней повреждён");
        roots.remove(id)
    };

    if removed {
        state
            .watchers
            .lock()
            .expect("наблюдатели повреждены")
            .unwatch(id);
        // Индекс убранного корня больше не нужен: он занимает место и портит
        // выдачу поиска путями, которых в рабочем пространстве уже нет.
        state
            .index
            .lock()
            .expect("индекс повреждён")
            .forget_root(id);
    }
    removed
}

/// Перечитать корни: файлы проектов и доступность папок.
///
/// Зовётся при возвращении фокуса в окно — тогда же, когда сверяются открытые
/// файлы (Р-014). Именно в этот момент пользователь мог поправить
/// `zeronote.toml` в другой программе или подключить пропавший диск.
#[tauri::command]
pub fn refresh_roots(state: tauri::State<'_, AppState>) -> Vec<RootView> {
    let views: Vec<RootView> = {
        let mut roots = state.roots.lock().expect("реестр корней повреждён");
        roots.reload_all();
        roots.list().iter().map(RootView::of).collect()
    };

    // Корень мог стать доступным — подключили диск, поднялся VPN. Тогда самое
    // время начать за ним следить. Уже поставленных наблюдателей не трогаем:
    // пересоздавать их на каждое переключение окна незачем.
    let mut watchers = state.watchers.lock().expect("наблюдатели повреждены");
    for view in &views {
        if view.available && !watchers.is_watching(view.id) {
            watchers.watch(view.id, std::path::Path::new(&view.path));
        }
    }

    views
}

/// Что переходник Obsidian готов перенести из этого корня.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianPreview {
    /// В папке есть `.obsidian`.
    pub detected: bool,
    /// Правила игнорирования, готовые к переносу.
    pub rules: Vec<String>,
    /// Фильтры, которые перенести нельзя, — как записаны в Obsidian.
    pub skipped: Vec<String>,
    /// Файл проекта уже есть: тогда переносим не мы, а пользователь руками
    /// (Р-072).
    pub project_file_exists: bool,
}

/// Посмотреть, что можно перенести из хранилища Obsidian.
///
/// Только чтение — инвариант 2. Никакая ветка этой команды в `.obsidian`
/// не пишет.
#[tauri::command]
pub fn obsidian_preview(
    state: tauri::State<'_, AppState>,
    id: RootId,
) -> Fallible<ObsidianPreview> {
    let roots = state.roots.lock().expect("реестр корней повреждён");
    let root = roots.get(id).ok_or("корень не найден")?;

    let import = project::obsidian::read_import(&root.path);

    Ok(ObsidianPreview {
        detected: root.has_obsidian_config,
        rules: import.rules,
        skipped: import.skipped,
        project_file_exists: root.has_project_file,
    })
}

/// Перенести настройки Obsidian в наш файл проекта.
///
/// Создаёт `zeronote.toml` с перенесёнными правилами. Существующий файл
/// не трогает вовсе (Р-072): дописать в TOML вторую таблицу `[ignore]`
/// нельзя, а переписать файл целиком значит потерять комментарии
/// пользователя.
#[tauri::command]
pub fn obsidian_import(
    state: tauri::State<'_, AppState>,
    id: RootId,
) -> Fallible<RootView> {
    let (root_path, path) = {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        let root = roots.get(id).ok_or("корень не найден")?;
        (root.path.clone(), project::project_path(&root.path))
    };

    if path.exists() {
        return Err(format!(
            "{} уже существует — правила нужно перенести руками",
            path.display()
        ));
    }

    let import = project::obsidian::read_import(&root_path);
    let text = project::template_with_rules(&import.rules, ".obsidian/app.json");

    atomic_save::save(&path, text.as_bytes()).map_err(|e| e.to_string())?;

    let mut roots = state.roots.lock().expect("реестр корней повреждён");
    let root = roots.get_mut(id).ok_or("корень не найден")?;
    root.reload();
    Ok(RootView::of(root))
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
