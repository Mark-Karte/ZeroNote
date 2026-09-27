//! Команды индекса.
//!
//! Логики здесь нет: очередь и отмену ведёт `index/jobs.rs`, запрос —
//! `index/query.rs`.

use crate::index::graph::{Backlink, Resolved, TagHit, Tagged};
use crate::index::jobs::Progress;
use crate::index::names::FileHit;
use crate::index::query::Hit;
use crate::index::scope::{Scope, Scopes};
use crate::model::root::RootId;
use crate::state::AppState;

type Fallible<T> = Result<T, String>;

/// Корни рабочего пространства как области (задача 140).
///
/// Какой корень видит файл, решает путь при запросе, а не номер в строке
/// индекса: при вложенных корнях этот номер — кто проиндексировал первым.
/// Берутся все корни, и недоступные тоже: их записи в индексе остаются
/// (Р-052), и вопрос «чей это файл» к ним по-прежнему применим.
pub(crate) fn scopes(state: &AppState) -> Scopes {
    let roots = state.roots.lock().expect("реестр корней повреждён");
    Scopes::new(
        roots
            .list()
            .iter()
            .map(|root| Scope::new(root.id, &root.path))
            .collect(),
    )
}

/// Область самого глубокого корня этого файла. `None` — файл вне корней.
pub(crate) fn scope_of(state: &AppState, path: &str) -> Option<Scope> {
    scopes(state).for_path(path).cloned()
}

/// Поставить корень в очередь на индексацию.
///
/// Полный проход сверяет то, что на диске, с тем, что в базе, и перечитывает
/// только изменившееся. Поэтому «переиндексировать» стоит дёшево и зовётся
/// при каждом добавлении корня и при каждом запуске.
pub fn schedule_scan(state: &AppState, root_id: RootId) {
    schedule(state, root_id, false);
}

fn schedule(state: &AppState, root_id: RootId, quiet: bool) {
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
        .scan_root(root_id, path, rules, max_size, quiet);
}

#[tauri::command]
pub fn index_progress(state: tauri::State<'_, AppState>) -> Progress {
    state.index.lock().expect("индекс повреждён").progress()
}

/// Пора ли сверить корень с диском заново (Я15).
pub fn needs_catch_up(state: &AppState, root_id: RootId) -> bool {
    state
        .index
        .lock()
        .expect("индекс повреждён")
        .needs_catch_up(root_id)
}

/// Догоняющая сверка корня с диском — тихо, без хода работы в строке
/// состояния (Я15).
pub fn schedule_catch_up(state: &AppState, root_id: RootId) {
    schedule(state, root_id, true);
}

/// Сколько файлов корня лежит в индексе — всё под его папкой.
#[tauri::command]
pub fn index_count(state: tauri::State<'_, AppState>, root_id: RootId) -> u64 {
    let Some(scope) = scopes(&state).get(root_id).cloned() else {
        return 0;
    };
    state.index.lock().expect("индекс повреждён").count(&scope)
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
    let scope = scope_of(&state, &from)?;
    state
        .index
        .lock()
        .expect("индекс повреждён")
        .resolve_link(&target, &from, &scope)
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
    // Файл вне корней: разрешать ссылки не по чему, и висячими они тоже
    // не считаются — мы просто не знаем.
    let Some(scope) = scope_of(&state, &from) else {
        return vec![true; targets.len()];
    };

    let index = state.index.lock().expect("индекс повреждён");
    targets
        .iter()
        .map(|target| index.resolve_link(target, &from, &scope).is_some())
        .collect()
}

/// Создать заметку по висячей ссылке и вернуть путь к ней (Р-098).
///
/// Запись в папку пользователя без переспроса — исключение из Р-049,
/// и оно оговорено: `Ctrl`+щелчок по висячей ссылке и есть явная команда,
/// причём недвусмысленная. Действие обратимо: файл пустой и виден в дереве.
///
/// Существующий файл не перезаписывается никогда. Проверка «нет такого файла»
/// и создание идут не атомарно, но гонка здесь безобидна: единственный, кто
/// может создать файл в этот же миг, — сам пользователь в другой программе,
/// и тогда мы просто откажемся, а не затрём его работу.
#[tauri::command]
pub fn create_note(
    state: tauri::State<'_, AppState>,
    target: String,
    from: String,
) -> Fallible<String> {
    let from_path = std::path::PathBuf::from(&from);

    // Корень нужен, потому что путь в цели ссылки считается от него. Заодно
    // это отсекает файлы вне проектов: класть заметку рядом с чужим файлом,
    // о котором мы ничего не знаем, — не то, о чём просили.
    let root_path = {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        roots
            .for_path(&from_path)
            .map(|root| root.path.clone())
            .ok_or("файл не входит ни в один проект")?
    };

    let path = crate::markdown::new_note::note_path(&target, &from_path, &root_path)
        .map_err(|e| e.to_string())?;

    if crate::fsx::atomic_save::is_inside_obsidian(&path) {
        return Err("в .obsidian ничего не пишется (инвариант 2)".to_owned());
    }

    if path.exists() {
        return Err(format!("{} уже существует", path.display()));
    }

    // Папки из пути ссылки может не быть: `[[архив/Старое]]` называет её
    // сам, и создать её — часть той же команды.
    if let Some(parent) = path.parent()
        && !parent.exists()
    {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("не удалось создать папку {}: {e}", parent.display()))?;
    }

    // Через атомарную запись, как и всё остальное. Заметка пустая: заполнять
    // её за пользователя нечем, а любой шаблон был бы правкой чужого файла
    // ещё до того, как он его открыл.
    crate::fsx::atomic_save::save(&path, &[]).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}

/// Кто ссылается на этот файл.
#[tauri::command]
pub fn backlinks(state: tauri::State<'_, AppState>, path: String) -> Vec<Backlink> {
    let scopes = scopes(&state);
    state
        .index
        .lock()
        .expect("индекс повреждён")
        .backlinks(&path, &scopes)
}

/// Файлы, помеченные тегом. Вложенные теги считаются: `#работа` находит
/// и `#работа/срочное`.
///
/// Корень у файла — самый глубокий живой, в котором он лежит: им подписано
/// место в списке. Записи корня, которого в реестре уже нет, не выдаются
/// (Я10): забывание могло ещё не дойти до базы.
#[tauri::command]
pub fn files_with_tag(
    state: tauri::State<'_, AppState>,
    tag: String,
    limit: Option<u32>,
) -> Vec<Tagged> {
    let scopes = scopes(&state);
    let files = state
        .index
        .lock()
        .expect("индекс повреждён")
        .files_with_tag(&tag, limit.unwrap_or(200));
    files
        .into_iter()
        .filter_map(|mut file| {
            file.root_id = scopes.for_path(&file.path)?.id;
            Some(file)
        })
        .collect()
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
///
/// **Ищет по всем файлам проекта, а не только по текстовым** (задача 82).
/// Картинку и PDF ZeroNote открывает с этапа 10, и не находить их поиском
/// по имени было чистым следствием того, что палитра брала список из индекса,
/// а индекс знал только текст.
#[tauri::command]
pub fn find_files(
    state: tauri::State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> Vec<FileHit> {
    let files = state.index.lock().expect("индекс повреждён").files();
    let scopes = scopes(&state);

    // Путь корня из сопоставления убираем. Иначе совпадать будет он сам:
    // папка вроде `C:\Users\пользователь\Desktop\Project` содержит столько
    // букв, что под неё подходит почти любой запрос, и в выдачу попадают
    // все файлы проекта разом. Найдено это живой проверкой, а не тестом.
    //
    // Корень у файла — самый глубокий, в котором он лежит (задача 140), а
    // файл вне всех корней — запись убранной папки, забывание которой ещё
    // не дошло до базы (Я10): такого в выдаче быть не должно.
    let relative = files.into_iter().filter_map(|file| {
        let scope = scopes.for_path(&file.path)?;
        let inside = scope.relative(&file.path)?;
        Some((scope.id, file.path, file.name, inside))
    });

    crate::index::names::best(&query, relative, limit.unwrap_or(50) as usize)
}

/// Заметки для подсказки имён при `[[` (Р-132).
///
/// Отличий от быстрого открытия три, и все они про честность подсказки
/// (Р-134): список ограничен корнем ссылающегося файла — на файл из другого
/// проекта не сослаться никаким текстом; сам этот файл из списка исключён —
/// ссылка на себя не ведёт никуда; а файл вне проектов не получает подсказки
/// вовсе, потому что ссылаться ему не на что.
#[tauri::command]
pub fn find_notes(
    state: tauri::State<'_, AppState>,
    query: String,
    from: String,
    embed: Option<bool>,
    limit: Option<u32>,
) -> Vec<FileHit> {
    let Some(scope) = scope_of(&state, &from) else {
        return Vec::new();
    };

    // Что предлагать, решает сама запись (Р-218): `![[` — это «вставить
    // файл», и там нужны картинки; `[[` — это «сослаться на заметку»,
    // и снимки экрана в таком списке только мешают. Правило видно
    // из набранного, поэтому спрашивать о нём никого не надо.
    let index = state.index.lock().expect("индекс повреждён");
    let files = if embed.unwrap_or(false) {
        index.files()
    } else {
        index.text_files()
    };
    drop(index);
    let limit = limit.unwrap_or(20) as usize;

    // Список — всё под папкой корня, кто бы это ни проиндексировал
    // (задача 140): ровно то, куда ссылка сможет привести.
    let relative = files.into_iter().filter_map(|file| {
        let inside = scope.relative(&file.path)?;
        Some((scope.id, file.path, file.name, inside))
    });

    // Себя отсеиваем после отбора, а не до: приведение пути к общему виду
    // стоит одной строки на файл, и платить эту цену за все десять тысяч имён
    // на каждое нажатие незачем. Берём на одну строку больше, чтобы список
    // не укоротился, когда своя же заметка попала в выдачу.
    let source = crate::index::writer::path_key(std::path::Path::new(&from));
    let mut hits = crate::index::names::best(&query, relative, limit + 1);
    hits.retain(|hit| {
        crate::index::writer::path_key(std::path::Path::new(&hit.path)) != source
    });
    hits.truncate(limit);
    hits
}

/// Каким текстом записать ссылку на этот файл из того, что открыт (Р-134).
///
/// `null` означает «сослаться нельзя»: файл вне проектов или из другого корня.
/// Подсказка такие файлы не показывает, но ответ на этот вопрос обязан быть
/// честным и без неё — команду зовут и после того, как список успел устареть.
#[tauri::command]
pub fn link_target(
    state: tauri::State<'_, AppState>,
    path: String,
    from: String,
) -> Option<String> {
    let scope = scope_of(&state, &from)?;
    let relative = scope.relative(&path)?;

    state
        .index
        .lock()
        .expect("индекс повреждён")
        .link_text(&path, &from, &scope, &relative)
}

/// Поиск по содержимому.
///
/// `root_id` не задан — ищем во всех корнях сразу. Задан — во всём, что
/// лежит под папкой корня, вместе с вложенными проектами (задача 140).
/// Корень у находки — самый глубокий, в котором она лежит; записи корня,
/// которого в реестре уже нет, не выдаются (Я10).
#[tauri::command]
pub fn search_project(
    state: tauri::State<'_, AppState>,
    query: String,
    root_id: Option<RootId>,
    limit: Option<u32>,
) -> Fallible<Vec<Hit>> {
    let scopes = scopes(&state);
    let scope = match root_id {
        Some(id) => match scopes.get(id) {
            Some(scope) => Some(scope),
            None => return Ok(Vec::new()),
        },
        None => None,
    };

    let hits = state
        .index
        .lock()
        .expect("индекс повреждён")
        .search(&query, scope, limit.unwrap_or(200))?;
    Ok(hits
        .into_iter()
        .filter_map(|mut hit| {
            hit.root_id = scopes.for_path(&hit.path)?.id;
            Some(hit)
        })
        .collect())
}
