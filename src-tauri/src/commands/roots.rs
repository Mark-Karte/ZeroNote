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
    /// Это папка заметок, а не открытый проект (задача 94). Дерево «Папок»
    /// её не показывает — у неё своя панель.
    pub is_vault: bool,
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
            is_vault: root.is_vault,
            problems: root.problems.clone(),
        }
    }
}

/// Привести реестр корней в согласие с настройкой «папка заметок».
///
/// Зовётся при восстановлении сессии и после правки настройки. Работа
/// идемпотентная: второй вызов подряд ничего не меняет.
///
/// Прежняя папка заметок из списка **не убирается** — она просто перестаёт
/// быть домом и показывается в «Папках» обычным корнем. Убирать её молча
/// нельзя: настройку могли поправить руками при закрытом приложении, и тогда
/// исчезновение папки из рабочего пространства выглядело бы поломкой. Правило
/// одно на оба случая — так его можно объяснить одной фразой.
pub fn sync_vault(state: &AppState, notices: &mut Vec<String>) -> Option<RootView> {
    // Настройки читаются с диска: файл и есть состояние (Р-077), и его могли
    // поправить руками минуту назад. Испорченный файл не мешает — хранилищем
    // становится папка данных, о поломке скажет окно параметров.
    let settings = crate::settings::load(&state.data_dir.settings_file()).unwrap_or_default();
    let named = !settings.notes.vault.trim().is_empty();
    let path = crate::model::vault::path_of(&settings.notes.vault, &state.data_dir.path);

    // Свою папку создаём молча: она в папке данных приложения и принадлежит
    // ему. Чужую, названную человеком, не создаём никогда (Р-049) — опечатка
    // в пути не должна оставлять после себя папку.
    if !named && !path.is_dir() {
        if let Err(error) = std::fs::create_dir_all(&path) {
            notices.push(format!(
                "не удалось создать папку заметок {}: {error}",
                path.display()
            ));
            return None;
        }
    }

    if named && !path.is_dir() {
        // Папка недоступна — например, отключён диск. Корень всё равно
        // остаётся в списке (Р-052), но молчать об этом нельзя: пустое
        // дерево без объяснений выглядит как поломка.
        notices.push(format!("папка заметок недоступна: {}", path.display()));
    }

    let (id, view, appeared) = {
        let mut roots = state.roots.lock().expect("реестр корней повреждён");
        let known = roots.find_by_path(&crate::model::root::normalize(&path)).is_some();
        let root = roots.add(path.clone());
        let id = root.id;
        roots.mark_vault(&crate::model::root::normalize(&path));
        let view = roots.get(id).map(RootView::of);
        (id, view, !known)
    };

    // Наблюдатель и индексация — только для впервые появившейся папки: корень
    // из сессии их уже получил, а второй вызов `watch` означал бы второе
    // событие на каждую правку файла.
    if appeared {
        state
            .watchers
            .lock()
            .expect("наблюдатели повреждены")
            .watch(id, &path);
        super::index::schedule_scan(state, id);
    }

    view
}

/// Перечитать настройку «папка заметок» и вернуть весь список корней.
///
/// Зовётся после правки настроек в окне параметров. Список целиком, а не одна
/// папка: роль могла уйти с прежней папки, и та возвращается в «Папки» —
/// фронтенду проще применить ответ целиком, чем повторять правило у себя.
#[tauri::command]
pub fn ensure_vault(state: tauri::State<'_, AppState>) -> Vec<RootView> {
    let mut notices = Vec::new();
    sync_vault(&state, &mut notices);

    let roots = state.roots.lock().expect("реестр корней повреждён");
    roots.list().iter().map(RootView::of).collect()
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
    remove(&state, id)
}

fn remove(state: &AppState, id: RootId) -> bool {
    let (removed, overlapping) = {
        let mut roots = state.roots.lock().expect("реестр корней повреждён");
        // Папку заметок «Убрать папку» не берёт: её роль задана настройкой,
        // и корень вернулся бы на место при следующем запуске. Отказ здесь
        // честнее исчезновения на один сеанс.
        let Some(root) = roots.get(id) else {
            return false;
        };
        if root.is_vault {
            return false;
        }
        let path = root.path.clone();
        // Корни, чьи папки пересекаются с убранной, — вложенные в неё
        // и те, в которые вложена она (задача 140). Строка индекса одна
        // на файл, и файлы общей части могли быть записаны за убранным
        // корнем: забудутся вместе с ним, и их надо записать заново.
        let overlapping: Vec<RootId> = roots
            .list()
            .iter()
            .filter(|other| other.id != id && other.available)
            .filter(|other| {
                crate::model::root::inside(&other.path, &path)
                    || crate::model::root::inside(&path, &other.path)
            })
            .map(|other| other.id)
            .collect();
        (roots.remove(id), overlapping)
    };

    if removed {
        state
            .watchers
            .lock()
            .expect("наблюдатели повреждены")
            .unwatch(id);
        // Индекс убранного корня больше не нужен: он занимает место и портит
        // выдачу поиска путями, которых в рабочем пространстве уже нет.
        // Забывание стоит в очереди до проходов ниже — они придут после.
        state
            .index
            .lock()
            .expect("индекс повреждён")
            .forget_root(id);
        for other in overlapping {
            super::index::schedule_scan(state, other);
        }
    }
    removed
}

/// Перечитать корни: файлы проектов и доступность папок.
///
/// Зовётся при возвращении фокуса в окно — тогда же, когда сверяются открытые
/// файлы (Р-014). Именно в этот момент пользователь мог поправить
/// `zeronote.toml` в другой программе или подключить пропавший диск.
///
/// Заодно здесь индекс догоняет диск (задача 140). Сменились правила
/// игнорирования или предел размера — полный проход сразу (Я9): иначе
/// скрытое правилом оставалось находимым поиском до перезапуска. Корень
/// не сверялся дольше `CATCH_UP` — наблюдатель ставится заново, и идёт
/// тихий проход (Я15): слежение теряет события молча, а наблюдатель
/// на неизвестной ошибке `notify` снимает, тоже молча. Папки таких корней
/// уходят фронтенду событием `tree-stale`: раскрытое в дереве тоже могло
/// устареть.
#[tauri::command]
pub fn refresh_roots(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Vec<RootView> {
    use tauri::Emitter;

    let (views, stale) = refresh(&state);
    if !stale.is_empty() {
        let _ = app.emit(crate::tree::watch::TREE_STALE, stale);
    }
    views
}

/// Перечитывание без окна: список корней и папки, которые могли устареть.
fn refresh(state: &AppState) -> (Vec<RootView>, Vec<String>) {
    let (views, changed) = {
        let mut roots = state.roots.lock().expect("реестр корней повреждён");
        // Что было до перечитывания — по этому видно, чьи правила сменились.
        let before: Vec<(RootId, project::IgnoreSettings, u64, bool)> = roots
            .list()
            .iter()
            .map(|root| {
                (
                    root.id,
                    root.project.ignore.clone(),
                    root.project.index.max_file_size,
                    root.available,
                )
            })
            .collect();
        roots.reload_all();

        let changed: Vec<RootId> = roots
            .list()
            .iter()
            .filter(|root| root.available)
            .filter(|root| {
                before.iter().find(|b| b.0 == root.id).is_none_or(|b| {
                    b.1 != root.project.ignore
                        || b.2 != root.project.index.max_file_size
                        // Папка вернулась: пока её не было, событий о ней
                        // не приходило.
                        || !b.3
                })
            })
            .map(|root| root.id)
            .collect();
        (roots.list().iter().map(RootView::of).collect::<Vec<_>>(), changed)
    };

    // Кому пора догонять — спрашиваем до наблюдателей, чтобы не держать
    // две блокировки разом.
    let catch_up: Vec<RootId> = views
        .iter()
        .filter(|view| view.available && !changed.contains(&view.id))
        .filter(|view| super::index::needs_catch_up(state, view.id))
        .map(|view| view.id)
        .collect();

    let mut rescan = changed.clone();
    {
        let mut watchers = state.watchers.lock().expect("наблюдатели повреждены");
        for view in views.iter().filter(|view| view.available) {
            let path = std::path::Path::new(&view.path);
            // Корень мог стать доступным — подключили диск, поднялся VPN:
            // самое время начать за ним следить. Наблюдателя догоняющего
            // корня ставим заново — прежний мог молча умереть. Остальных
            // не трогаем: пересоздавать их на каждое переключение окна незачем.
            if !watchers.is_watching(view.id) {
                watchers.watch(view.id, path);
                if !rescan.contains(&view.id) && !catch_up.contains(&view.id) {
                    rescan.push(view.id);
                }
            } else if catch_up.contains(&view.id) {
                watchers.watch(view.id, path);
            }
        }
    }

    for id in &rescan {
        super::index::schedule_scan(state, *id);
    }
    for id in &catch_up {
        super::index::schedule_catch_up(state, *id);
    }

    let stale = views
        .iter()
        .filter(|view| rescan.contains(&view.id) || catch_up.contains(&view.id))
        .map(|view| view.path.clone())
        .collect();
    (views, stale)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-roots-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Состояние с настоящим индексом и наблюдателями, корень добавлен
    /// и проиндексирован — как после добавления папки в окне.
    fn with_root(tag: &str) -> (AppState, RootId, PathBuf, PathBuf) {
        let data = temp_dir(&format!("{tag}-data"));
        let root = temp_dir(&format!("{tag}-root"));
        std::fs::create_dir_all(root.join("личное")).unwrap();
        std::fs::write(root.join("личное").join("секрет.md"), "слово кумкват").unwrap();

        let state = AppState::for_tests(data.clone());
        state.index.lock().unwrap().start_for_tests(&data);
        state.watchers.lock().unwrap().start_for_tests();
        let id = state.roots.lock().unwrap().add(root.clone()).id;
        let path = state.roots.lock().unwrap().get(id).unwrap().path.clone();
        state.watchers.lock().unwrap().watch(id, &path);
        super::super::index::schedule_scan(&state, id);
        state.index.lock().unwrap().wait_idle();
        (state, id, root, data)
    }

    fn found(state: &AppState, word: &str) -> usize {
        state.index.lock().unwrap().search(word, None, 20).unwrap().len()
    }

    /// Новое правило игнорирования убирает файлы из поиска сразу (Я9),
    /// а не после перезапуска: скрытое в дереве, но находимое поиском, —
    /// утечка.
    #[test]
    fn new_ignore_rule_hides_files_from_search() {
        let (state, _, root, data) = with_root("rule");
        assert_eq!(found(&state, "кумкват"), 1);

        std::fs::write(root.join("zeronote.toml"), "[ignore]\nrules = [\"личное/\"]\n").unwrap();
        refresh(&state);
        state.index.lock().unwrap().wait_idle();

        assert_eq!(found(&state, "кумкват"), 0, "скрытое правилом находится поиском");
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&data);
    }

    /// Потерянные слежением события догоняет проход при возвращении фокуса
    /// (Я15), а раскрытое в дереве под этим корнем объявляется устаревшим.
    #[test]
    fn stale_root_is_caught_up_on_focus() {
        let (state, id, root, data) = with_root("catch-up");
        // Файл появился, а событие о нём потерялось: наблюдатели теста
        // отправляют события в пустоту.
        std::fs::write(root.join("новое.md"), "слово фейхоа").unwrap();

        // Только что сверенный корень не трогаем.
        let (_, stale) = refresh(&state);
        state.index.lock().unwrap().wait_idle();
        assert!(stale.is_empty(), "{stale:?}");
        assert_eq!(found(&state, "фейхоа"), 0);

        state
            .index
            .lock()
            .unwrap()
            .backdate_scan(id, crate::index::jobs::CATCH_UP);
        let (_, stale) = refresh(&state);
        state.index.lock().unwrap().wait_idle();

        assert_eq!(found(&state, "фейхоа"), 1, "потерянное событие не догнали");
        assert_eq!(stale.len(), 1);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&data);
    }

    /// Убрали вложенный корень — файлы его папки, записанные за ним,
    /// возвращает проход внешнего (задача 140).
    #[test]
    fn removing_a_nested_root_keeps_its_files_in_the_outer_one() {
        let (state, outer, root, data) = with_root("nested-remove");
        let inner_path = root.join("личное");
        let inner = state.roots.lock().unwrap().add(inner_path.clone()).id;
        // Файл переписан — теперь его строка за вложенным корнем.
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(inner_path.join("секрет.md"), "слово кумкват снова").unwrap();
        super::super::index::schedule_scan(&state, inner);
        state.index.lock().unwrap().wait_idle();

        assert!(remove(&state, inner));
        state.index.lock().unwrap().wait_idle();

        assert_eq!(found(&state, "кумкват"), 1, "файл пропал из внешнего корня");
        assert!(state.roots.lock().unwrap().get(outer).is_some());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&data);
    }
}
