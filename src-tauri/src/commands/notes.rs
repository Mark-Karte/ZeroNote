//! Заметки, которые приложение создаёт само: ежедневная (задача 90)
//! и заготовки-шаблоны (задача 95), — и вложения заметки: картинка
//! из буфера обмена (задача 146) и файлы, брошенные в неё (задача 147).
//!
//! Логики здесь нет: имя и подстановки считает `markdown/daily`, пути —
//! `model/vault`, запись идёт через `fsx::atomic_save`, как всякая другая.
//! Здесь то, что нельзя проверить чистой функцией: настройки, папка данных
//! и существующий файл.
//!
//! Главное правило: **существующая заметка не переписывается никогда**.
//! Команду за день нажимают много раз, и второе нажатие обязано открыть
//! написанное утром, а не заменить его пустым шаблоном.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::markdown::attachment::{self, Attachments, LinkForm};
use crate::markdown::daily::{self, Fields};
use crate::model::root::RootId;
use crate::project::ignore::IgnoreRules;
use crate::state::AppState;

type Fallible<T> = Result<T, String>;

/// Что вышло: путь и была ли заметка создана только что.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyNote {
    pub path: String,
    /// `false` — заметка уже была, её просто открыли.
    pub created: bool,
}

/// Открыть заметку на сегодня, создав её при необходимости.
///
/// Дату и время приносит окно: у ядра нет часового пояса, а «сегодня» —
/// это про человека, а не про UTC. Ядро дате не верит и проверяет её вид
/// (`markdown::daily`): из даты складывается имя файла.
///
/// Запись в папку пользователя без переспроса — то же исключение из Р-049,
/// что у создания заметки по висячей ссылке (Р-098): нажатие команды и есть
/// явное указание, а действие обратимо — файл пустой и виден в дереве.
#[tauri::command]
pub fn open_daily_note(
    state: tauri::State<'_, AppState>,
    date: String,
    time: String,
) -> Fallible<DailyNote> {
    let title = daily::title(&date).map_err(|e| e.to_string())?;
    let name = daily::file_name(&date).map_err(|e| e.to_string())?;

    // Настройки читаются с диска, как и всюду: файл и есть состояние (Р-077),
    // и его могли поправить руками минуту назад. Испорченный файл не мешает
    // команде — она отработает на умолчаниях, а о поломке скажет окно
    // параметров.
    let settings = crate::settings::load(&state.data_dir.settings_file())
        .unwrap_or_default();
    let template = settings.notes.daily_template;

    // Папка заметок — дом для записей (задача 94), а `daily_folder` — путь
    // внутри него. Абсолютный путь по-прежнему означает папку саму по себе:
    // так настроенное на этапе 13 остаётся работать.
    let vault = crate::model::vault::path_of(&settings.notes.vault, &state.data_dir.path);
    let folder = crate::model::vault::daily_folder(&settings.notes.daily_folder, &vault);

    ensure(&folder, &name, &template, &Fields { date, time, title })
}

/// Найти или создать заметку. Отдельно от настроек — ради проверяемости.
fn ensure(folder: &Path, name: &str, template: &str, fields: &Fields) -> Fallible<DailyNote> {
    let path = folder.join(name);

    // Инвариант 2 — до всякой работы с диском.
    if crate::fsx::atomic_save::is_inside_obsidian(&path) {
        return Err("в .obsidian ничего не пишется (инвариант 2)".to_owned());
    }

    // Существующая заметка не переписывается никогда: команду за день
    // нажимают много раз, и второе нажатие обязано открыть написанное утром.
    if path.exists() {
        return Ok(DailyNote {
            path: path.to_string_lossy().into_owned(),
            created: false,
        });
    }

    let text = body(template, fields)?;

    std::fs::create_dir_all(folder)
        .map_err(|e| format!("не удалось создать папку {}: {e}", folder.display()))?;

    // Через атомарную запись, как и всё остальное (инвариант 3).
    crate::fsx::atomic_save::save(&path, text.as_bytes()).map_err(|e| e.to_string())?;

    Ok(DailyNote {
        path: path.to_string_lossy().into_owned(),
        created: true,
    })
}

/// Ответ календарю: что помечать и за какой папкой следить.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyMonth {
    /// Папка ежедневных заметок в том виде, в каком о ней говорит наблюдатель
    /// за корнями (задача 107). Календарь сверяет с ней событие
    /// `tree-changed` и перечитывает месяц, только когда событие про неё.
    pub folder: String,
    /// Номера дней месяца, за которые заметка написана.
    pub days: Vec<u32>,
}

/// За какие дни месяца заметки уже написаны.
///
/// Месяц приходит в виде `2026-09` — от окна, как и дата: у ядра нет
/// часового пояса, и «текущий месяц» оно посчитать не может. Ответ — номера
/// дней, а не пути: календарю нужно знать, что помечать, а открывать он
/// будет той же командой, что и «заметка на сегодня».
///
/// Папка уезжает в ответе, а не считается окном: правила о ней (путь внутри
/// дома, абсолютный путь сам по себе, Р-238) живут здесь, и вторая их копия
/// во фронтенде разошлась бы молча.
#[tauri::command]
pub fn daily_notes_of_month(state: tauri::State<'_, AppState>, month: String) -> DailyMonth {
    let settings = crate::settings::load(&state.data_dir.settings_file()).unwrap_or_default();
    let vault = crate::model::vault::path_of(&settings.notes.vault, &state.data_dir.path);
    let folder = crate::model::vault::daily_folder(&settings.notes.daily_folder, &vault);

    // Наблюдатель называет папки путями от корня, а корень хранится
    // развёрнутым (`root::normalize`: без коротких имён, в регистре диска).
    // Папка из настроек приводится к тому же виду — иначе `C:\Users\user`
    // и `C:\Users\USER~1` оказались бы разными папками.
    let watched = crate::model::root::normalize(&folder);

    DailyMonth {
        folder: watched.to_string_lossy().into_owned(),
        days: written_days(&folder, &month),
    }
}

/// Какие дни месяца уже записаны в папке. Папки нет — ни одного.
fn written_days(folder: &Path, month: &str) -> Vec<u32> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        // Папки может не быть вовсе — ни одной заметки ещё не написали.
        // Это не ошибка: календарь просто покажет месяц без пометок.
        return Vec::new();
    };

    let names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_file())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();

    days_of(&names, month)
}

/// Какие дни месяца встречаются среди имён. Отдельно — ради проверяемости.
fn days_of(names: &[String], month: &str) -> Vec<u32> {
    let mut days: Vec<u32> = names
        .iter()
        .filter_map(|name| daily::date_of(name))
        .filter_map(|date| {
            let rest = date.strip_prefix(month)?.strip_prefix('-')?;
            rest.parse::<u32>().ok()
        })
        .collect();

    days.sort_unstable();
    days.dedup();
    days
}

/// Заготовка: имя для списка и путь для чтения.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    /// Имя файла без расширения — оно же подпись в списке.
    pub name: String,
    pub path: String,
}

/// Расширения, которые считаются заготовкой.
///
/// Шаблон — это текст, который вставляют в заметку. Картинке или PDF в этом
/// списке делать нечего, а читать чужой двоичный файл как текст — верный
/// способ вставить в заметку мусор.
const TEMPLATE_EXTENSIONS: [&str; 3] = ["md", "markdown", "txt"];

/// Куда настройки указывают за шаблонами. `None` — папка не задана.
fn templates_dir(state: &AppState) -> Option<std::path::PathBuf> {
    let settings = crate::settings::load(&state.data_dir.settings_file()).unwrap_or_default();
    let vault = crate::model::vault::path_of(&settings.notes.vault, &state.data_dir.path);
    crate::model::vault::templates_folder(&settings.notes.templates, &vault)
}

/// Список заготовок.
///
/// Папки нет или она пуста — пустой список, а не ошибка: «шаблонов нет» —
/// обычное состояние, и отвечать на него окном с ошибкой незачем. Вложенные
/// папки не обходятся: заготовки лежат стопкой, а не деревом.
#[tauri::command]
pub fn list_templates(state: tauri::State<'_, AppState>) -> Vec<Template> {
    match templates_dir(&state) {
        Some(dir) => templates_in(&dir),
        None => Vec::new(),
    }
}

/// Что в папке заготовок. Отдельно от команды — ради проверяемости.
fn templates_in(dir: &Path) -> Vec<Template> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut items: Vec<Template> = entries
        .flatten()
        .filter(|entry| entry.path().is_file())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| TEMPLATE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .map(|entry| {
            let path = entry.path();
            Template {
                name: path
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                path: path.to_string_lossy().into_owned(),
            }
        })
        .collect();

    // По алфавиту и без учёта регистра: порядок файловой системы
    // на разных дисках разный, а список читают глазами.
    items.sort_by_key(|item| item.name.to_lowercase());
    items
}

/// Прочитать заготовку и подставить в неё поля.
///
/// Путь проверяется по папке шаблонов: команда читает файл с диска, и брать
/// путь у окна на веру — значит отдать чтение любого файла кому угодно, кто
/// доберётся до IPC. Р-118 в той же логике: наружу приложение ходит только
/// туда, куда само решило.
#[tauri::command]
pub fn read_template(
    state: tauri::State<'_, AppState>,
    path: String,
    date: String,
    time: String,
    title: String,
) -> Fallible<String> {
    let path = std::path::PathBuf::from(path);
    let Some(dir) = templates_dir(&state) else {
        return Err("папка шаблонов не задана".to_owned());
    };

    if !crate::model::root::same_path(path.parent().unwrap_or(Path::new("")), &dir) {
        return Err(format!("{} — не заготовка из папки шаблонов", path.display()));
    }

    let bytes = std::fs::read(&path)
        .map_err(|e| format!("шаблон {} не прочитан: {e}", path.display()))?;
    // Шаблон только читается, и его текст ложится в новую заметку UTF-8:
    // подсказка проекта здесь ничего не защищает от порчи.
    let raw = crate::text::document::read_raw(&bytes, None)
        .map_err(|e| format!("шаблон {} не прочитан: {e}", path.display()))?;

    Ok(daily::fill(&raw.text, &Fields { date, time, title }))
}

/// Создать заметку с готовым содержимым.
///
/// Имя своё, а не `create_note`: та команда с задачи 29 создаёт пустую
/// заметку по висячей ссылке, и две команды с одним именем в реестре Tauri
/// не уживаются. Отдельно от `create_entry` (задача 38) — та создаёт пустой
/// файл в дереве, а здесь текст известен заранее. Правила у всех троих одни:
/// `.obsidian` не трогаем, существующий файл не переписываем, запись
/// атомарная.
#[tauri::command]
pub fn create_note_from_text(folder: String, name: String, text: String) -> Fallible<String> {
    let folder = std::path::PathBuf::from(folder);
    let path = crate::fsx::entry_ops::child_path(&folder, &name).map_err(|e| e.to_string())?;

    if crate::fsx::atomic_save::is_inside_obsidian(&path) {
        return Err("в .obsidian ничего не пишется (инвариант 2)".to_owned());
    }

    if path.exists() {
        return Err(format!("«{}» здесь уже есть", path.display()));
    }

    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("не удалось создать папку {}: {e}", folder.display()))?;
    crate::fsx::atomic_save::save(&path, text.as_bytes()).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}

/// Что вышло у вставки картинки: где файл и что вставить в текст.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PastedImage {
    pub path: String,
    pub link: String,
}

/// Записать картинку из буфера обмена вложением заметки (задача 146).
///
/// Байты PNG приходят телом запроса, а не числами JSON: снимок экрана
/// весит мегабайты. Путь заметки и отметка времени — заголовками,
/// в процентной записи (`encodeURIComponent`): заголовок HTTP держит
/// только ASCII, а в пути кириллица. Отметку приносит окно, как дату
/// ежедневной заметки: у ядра нет часового пояса.
///
/// Запись в папку пользователя без переспроса — то же исключение
/// из Р-049, что у ежедневной заметки: вставка и есть явная команда,
/// а файл новый и виден в дереве.
#[tauri::command]
pub fn save_pasted_image(
    state: tauri::State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Fallible<PastedImage> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("картинка пришла не байтами".to_owned());
    };
    let header = |name: &str| -> Fallible<String> {
        let value = request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| format!("в запросе нет {name}"))?;
        unescape(value).ok_or_else(|| format!("{name} не раскодируется"))
    };
    let note = PathBuf::from(header("zn-note")?);
    let stamp = header("zn-stamp")?;

    // Настройки — с диска, как у ежедневной заметки: файл и есть
    // состояние (Р-077). Испорченный файл — умолчание, папка заметки.
    let settings = crate::settings::load(&state.data_dir.settings_file()).unwrap_or_default();

    // Корень и его правила — дешёвой копией под замком, дальше без него:
    // запись на диск под замком реестра корней держала бы все команды.
    let root = root_of(&state, &note);

    let path = save_image(
        &settings.notes.attachments,
        &note,
        root.as_ref().map(|root| root.path.as_path()),
        &stamp,
        bytes,
    )?;

    let form = link_form(&state, &note, &path, root.as_ref());
    index_now(&state, root.as_ref(), form, std::slice::from_ref(&path));
    let link = attachment::link(&note, &path, form)
        .ok_or_else(|| format!("на {} не выходит ссылки из заметки", path.display()))?;
    Ok(PastedImage {
        path: path.to_string_lossy().into_owned(),
        link,
    })
}

/// Корень заметки — дешёвой копией из реестра: путь, правила, номер
/// и предел индекса.
struct RootOf {
    path: PathBuf,
    rules: Arc<IgnoreRules>,
    id: RootId,
    max_size: u64,
}

/// Корень заметки: замок реестра держится только на копирование
/// указателей, диск дальше читается без него.
fn root_of(state: &AppState, note: &Path) -> Option<RootOf> {
    let roots = state.roots.lock().expect("реестр корней повреждён");
    roots.for_path(note).map(|root| RootOf {
        path: root.path.clone(),
        rules: Arc::clone(&root.rules),
        id: root.id,
        max_size: root.project.index.max_file_size,
    })
}

/// Внести новые файлы в индекс сразу, если на них ссылаются через
/// индекс (`[[…]]`): иначе превью спросит его раньше слежения и покажет
/// «нет картинки». Ссылку относительно заметки индекс не разрешает,
/// а скрытого правилами он знать не должен (Р-303) — таких не вносим.
fn index_now(state: &AppState, root: Option<&RootOf>, form: LinkForm, paths: &[PathBuf]) {
    if let (Some(root), LinkForm::Name | LinkForm::RootPath(_)) = (root, form) {
        state
            .index
            .lock()
            .expect("индекс повреждён")
            .index_now(root.id, paths, root.max_size);
    }
}

/// Как сослаться на `file` из заметки `note` (задачи 146 и 147).
///
/// `[[…]]` — только когда файл в корне заметки и индекс его видит:
/// вне проектов индекса нет, а скрытое правилами он не знает (Р-303),
/// и там ссылка относительно заметки. Имя, которое в проекте носит другой
/// файл, привело бы к нему — тогда путь от корня. Только что созданный
/// файл индекс ещё не знает, так что любой найденный по имени — чужой.
fn link_form<'a>(state: &AppState, note: &Path, file: &Path, root: Option<&'a RootOf>) -> LinkForm<'a> {
    let Some(RootOf { path: root_path, rules, .. }) = root else {
        return LinkForm::Relative;
    };
    if !crate::model::root::inside(root_path, file) || rules.is_ignored(file, false) {
        return LinkForm::Relative;
    }
    let Some(name) = attachment::name_text(file) else {
        return LinkForm::RootPath(root_path);
    };
    let from = note.to_string_lossy();
    let mine = file.to_string_lossy().to_lowercase();
    let taken = super::index::scope_of(state, &from).is_some_and(|scope| {
        state
            .index
            .lock()
            .expect("индекс повреждён")
            .resolve_link(name, &from, &scope)
            .is_some_and(|found| found.path.to_lowercase() != mine)
    });
    if taken {
        LinkForm::RootPath(root_path)
    } else {
        LinkForm::Name
    }
}

/// Что вышло с одним брошенным файлом: ссылка или почему её нет.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DroppedFile {
    pub link: Option<String>,
    pub error: Option<String>,
}

/// Файлы, брошенные на текст заметки, — ссылками (задача 147).
///
/// Файл в корне заметки (вне проектов — в её папке) остаётся на месте,
/// на него ставится ссылка. Файл извне копируется в папку вложений —
/// как у Obsidian, решение владельца: ссылка полным путём ломается,
/// как только хранилище переезжает на другой компьютер. Исходный файл
/// не трогается никогда.
///
/// Копирование большого файла — чтение и запись диска, и в потоке
/// окна оно подвесило бы окно (инвариант 6, Р-308): работа идёт в пуле
/// потоков. Ответ — по файлу: неудача одного не отменяет остальных.
/// Запись в папку пользователя — по явному действию человека (Р-049).
#[tauri::command]
pub async fn link_dropped(
    state: tauri::State<'_, AppState>,
    note: String,
    files: Vec<String>,
) -> Fallible<Vec<DroppedFile>> {
    let note = PathBuf::from(note);
    let settings = crate::settings::load(&state.data_dir.settings_file()).unwrap_or_default();
    let root = root_of(&state, &note);

    let placed = {
        let note = note.clone();
        let root_path = root.as_ref().map(|root| root.path.clone());
        tauri::async_runtime::spawn_blocking(move || {
            files
                .iter()
                .map(|file| {
                    place_file(&settings.notes.attachments, &note, root_path.as_deref(), Path::new(file))
                })
                .collect::<Vec<_>>()
        })
        .await
        .map_err(|e| format!("копирование прервалось: {e}"))?
    };

    Ok(placed
        .into_iter()
        .map(|result| match result {
            Ok(path) => {
                let form = link_form(&state, &note, &path, root.as_ref());
                index_now(&state, root.as_ref(), form, std::slice::from_ref(&path));
                match attachment::link(&note, &path, form) {
                    Some(link) => DroppedFile { link: Some(link), error: None },
                    None => DroppedFile {
                        link: None,
                        error: Some(format!("на {} не выходит ссылки из заметки", path.display())),
                    },
                }
            }
            Err(error) => DroppedFile { link: None, error: Some(error) },
        })
        .collect())
}

/// Где будет лежать брошенный файл: на месте, если он в корне заметки
/// (вне проектов — в её папке), иначе — копией в папке вложений.
fn place_file(attachments: &Attachments, note: &Path, root: Option<&Path>, file: &Path) -> Fallible<PathBuf> {
    if !file.is_absolute() || !note.is_absolute() {
        return Err(format!("путь неполный: {}", file.display()));
    }
    if !file.is_file() {
        return Err(format!("{} — не файл", file.display()));
    }
    let area = match root {
        Some(root) => root,
        None => note.parent().ok_or_else(|| format!("у {} нет папки", note.display()))?,
    };
    if crate::model::root::inside(area, file) {
        return Ok(file.to_path_buf());
    }

    let name = file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("имя {} не в Юникоде", file.display()))?;
    let folder = attachments_folder(attachments, note, root)?;
    let target = reserve(&folder, |number| Ok(attachment::numbered(name, number)))?;
    // Копия ложится поверх пустого файла, занявшего имя, — он наш.
    // Не атомарно: оборванное копирование оставит неполную копию,
    // исходник при этом цел. На ошибке копия убирается.
    if let Err(e) = std::fs::copy(file, &target) {
        std::fs::remove_file(&target).ok();
        return Err(format!("не удалось скопировать {}: {e}", file.display()));
    }
    Ok(target)
}

/// Папка вложений заметки: по настройке, с проверкой `.obsidian`,
/// создаётся, если её нет. Папки самой заметки нет — отказ: заметку
/// удалили снаружи, и создавать её папку заново ради вложения значило бы
/// положить файл туда, где его не ждут.
fn attachments_folder(attachments: &Attachments, note: &Path, root: Option<&Path>) -> Fallible<PathBuf> {
    if !note.parent().is_some_and(Path::is_dir) {
        return Err(format!("папки заметки {} нет на диске", note.display()));
    }
    let folder = attachments
        .folder(note, root)
        .ok_or_else(|| format!("у {} нет папки", note.display()))?;
    if crate::fsx::atomic_save::is_inside_obsidian(&folder) {
        return Err("папка вложений внутри .obsidian — туда ZeroNote не пишет (инвариант 2)".to_owned());
    }
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("не удалось создать папку {}: {e}", folder.display()))?;
    Ok(folder)
}

/// Занять в папке свободное имя: `name(0)`, `name(1)`, … — созданием
/// пустого файла. `create_new` атомарен на стороне Windows: второй
/// создатель того же имени получит отказ, поэтому существующий файл
/// не переписывается никогда — даже появившийся в этот самый миг.
fn reserve(folder: &Path, name: impl Fn(u32) -> Fallible<String>) -> Fallible<PathBuf> {
    for number in 0..1000 {
        let path = folder.join(name(number)?);
        if crate::fsx::atomic_save::is_inside_obsidian(&path) {
            return Err("в .obsidian ZeroNote не пишет (инвариант 2)".to_owned());
        }
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Ok(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("не удалось создать {}: {e}", path.display())),
        }
    }
    Err(format!("в папке {} заняты все номера этого имени", folder.display()))
}

/// Записать PNG в папку вложений заметки. Вернуть путь нового файла.
///
/// Имя занимает `reserve`, потом в файл пишется картинка атомарной
/// записью, как всякий файл (инвариант 3). Занято — следующий номер,
/// как у Obsidian.
fn save_image(
    attachments: &Attachments,
    note: &Path,
    root: Option<&Path>,
    stamp: &str,
    bytes: &[u8],
) -> Fallible<PathBuf> {
    if !bytes.starts_with(crate::clipboard::PNG_SIGNATURE) {
        return Err("вставляется только PNG".to_owned());
    }
    if !note.is_absolute() {
        return Err(format!("путь заметки неполный: {}", note.display()));
    }
    // Из отметки складывается имя — проверить до того, как создавать папку.
    attachment::image_name(stamp, 0)?;

    let folder = attachments_folder(attachments, note, root)?;
    let path = reserve(&folder, |number| attachment::image_name(stamp, number))?;
    if let Err(e) = crate::fsx::atomic_save::save(&path, bytes) {
        // Пустой файл, занявший имя, — наш: убрать его, чтобы
        // не оставлять в папке человека пустышку.
        std::fs::remove_file(&path).ok();
        return Err(format!("не удалось записать {}: {e}", path.display()));
    }
    Ok(path)
}

/// Раскодировать процентную запись (`%D0%97` → `З`). `None` — запись
/// сломана или внутри не UTF-8.
fn unescape(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let hex = std::str::from_utf8(bytes.get(at + 1..at + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Содержимое новой заметки: шаблон с подстановками или заголовок.
///
/// Шаблон, которого нет на диске, — это отказ, а не тишина: человек его
/// указал, значит ждёт именно его, и заметка с заголовком вместо шаблона
/// выглядела бы как «шаблон не работает», а почему — неизвестно.
fn body(template: &str, fields: &Fields) -> Fallible<String> {
    let template = template.trim();
    if template.is_empty() {
        return Ok(daily::blank(fields));
    }

    let path = Path::new(template);
    let bytes = std::fs::read(path)
        .map_err(|e| format!("шаблон {} не прочитан: {e}", path.display()))?;
    // Шаблон только читается, и его текст ложится в новую заметку UTF-8:
    // подсказка проекта здесь ничего не защищает от порчи.
    let raw = crate::text::document::read_raw(&bytes, None)
        .map_err(|e| format!("шаблон {} не прочитан: {e}", path.display()))?;

    Ok(daily::fill(&raw.text, fields))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn days_are_taken_from_daily_names_only() {
        let names: Vec<String> = [
            "Заметка 2026-09-01.md",
            "Заметка 2026-09-09.md",
            "Заметка 2026-10-01.md",
            "Заметка про отпуск.md",
            "readme.md",
        ]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();

        assert_eq!(days_of(&names, "2026-09"), vec![1, 9]);
        assert_eq!(days_of(&names, "2026-10"), vec![1]);
        assert!(days_of(&names, "2026-11").is_empty());
    }

    /// Месяц сравнивается целиком, а не началом строки: иначе «2026-1»
    /// поймал бы и октябрь, и ноябрь, и декабрь.
    #[test]
    fn a_partial_month_matches_nothing() {
        let names = vec!["Заметка 2026-10-05.md".to_owned()];
        assert!(days_of(&names, "2026-1").is_empty());
    }

    /// Днём считается файл в самой папке: папка с именем заметки и заметка
    /// во вложенной папке календарь не помечают. Папки нет — дней нет,
    /// и это не ошибка.
    #[test]
    fn written_days_are_files_in_the_folder_itself() {
        let dir = temp_dir("daily-month");
        std::fs::write(dir.join("Заметка 2026-09-25.md"), "").unwrap();
        std::fs::create_dir(dir.join("Заметка 2026-09-24.md")).unwrap();
        std::fs::create_dir(dir.join("архив")).unwrap();
        std::fs::write(dir.join("архив").join("Заметка 2026-09-23.md"), "").unwrap();

        assert_eq!(written_days(&dir, "2026-09"), vec![25]);
        assert!(written_days(&dir.join("нет такой"), "2026-09").is_empty());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Заготовками считаются только текстовые файлы: читать чужой двоичный
    /// файл как текст — верный способ вставить в заметку мусор.
    #[test]
    fn only_text_files_are_templates() {
        let dir = temp_dir("templates");
        std::fs::write(dir.join("Встреча.md"), "# {{title}}").unwrap();
        std::fs::write(dir.join("заметка.markdown"), "-").unwrap();
        std::fs::write(dir.join("список.txt"), "-").unwrap();
        std::fs::write(dir.join("картинка.png"), [0u8, 1, 2]).unwrap();
        std::fs::create_dir(dir.join("папка")).unwrap();

        let names: Vec<String> = templates_in(&dir).into_iter().map(|t| t.name).collect();
        assert_eq!(names, vec!["Встреча", "заметка", "список"]);

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Папки нет — пустой список, а не ошибка: «шаблонов нет» это обычное
    /// состояние, и окно с ошибкой на него было бы враньём о поломке.
    #[test]
    fn a_missing_folder_is_an_empty_list() {
        let dir = temp_dir("templates-none").join("нет такой");
        assert!(templates_in(&dir).is_empty());
    }

    #[test]
    fn a_note_is_created_with_its_text() {
        let dir = temp_dir("note-from-text");
        let path = create_note_from_text(
            dir.to_string_lossy().into_owned(),
            "Встреча.md".to_owned(),
            "# Встреча\n\nтекст\n".to_owned(),
        )
        .expect("заметка не создана");

        let written = std::fs::read_to_string(&path).unwrap();
        assert_eq!(written, "# Встреча\n\nтекст\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Существующий файл не переписывается — как и везде, где приложение
    /// само создаёт заметки (Р-229).
    #[test]
    fn an_existing_file_is_never_overwritten() {
        let dir = temp_dir("note-exists");
        std::fs::write(dir.join("Встреча.md"), "написано утром").unwrap();

        let outcome = create_note_from_text(
            dir.to_string_lossy().into_owned(),
            "Встреча.md".to_owned(),
            "пустой шаблон".to_owned(),
        );
        assert!(outcome.is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("Встреча.md")).unwrap(),
            "написано утром"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Инвариант 2: в `.obsidian` не пишется ничего и никогда.
    #[test]
    fn obsidian_is_refused_for_new_notes() {
        let dir = temp_dir("note-obsidian").join(".obsidian");
        std::fs::create_dir_all(&dir).unwrap();

        let outcome = create_note_from_text(
            dir.to_string_lossy().into_owned(),
            "Встреча.md".to_owned(),
            "текст".to_owned(),
        );
        assert!(outcome.is_err());
        assert!(!dir.join("Встреча.md").exists());

        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-daily-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Самый короткий PNG, какой нужен проверке: подпись и хвост.
    fn png() -> Vec<u8> {
        let mut bytes = crate::clipboard::PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(b"...");
        bytes
    }

    const STAMP: &str = "20260928143012";

    /// Картинка ложится по настройке, с именем Obsidian, байт в байт;
    /// папка создаётся, если её нет.
    #[test]
    fn pasted_image_goes_where_the_setting_says() {
        let root = temp_dir("paste-where");
        std::fs::create_dir_all(root.join("Проекты")).unwrap();
        let note = root.join("Проекты").join("Заметка.md");

        let beside = save_image(&Attachments::NoteFolder, &note, Some(&root), STAMP, &png()).unwrap();
        assert_eq!(beside, root.join("Проекты").join("Pasted image 20260928143012.png"));
        assert_eq!(std::fs::read(&beside).unwrap(), png());

        let one_place = Attachments::InRoot("Вложения".into());
        let far = save_image(&one_place, &note, Some(&root), STAMP, &png()).unwrap();
        assert_eq!(far, root.join("Вложения").join("Pasted image 20260928143012.png"));

        std::fs::remove_dir_all(&root).ok();
    }

    /// Имя занято — следующий номер; чужой файл не тронут.
    #[test]
    fn pasted_image_never_overwrites() {
        let root = temp_dir("paste-taken");
        let note = root.join("Заметка.md");
        let taken = root.join("Pasted image 20260928143012.png");
        std::fs::write(&taken, "чужое").unwrap();

        let path = save_image(&Attachments::NoteFolder, &note, Some(&root), STAMP, &png()).unwrap();

        assert_eq!(path, root.join("Pasted image 20260928143012 1.png"));
        assert_eq!(std::fs::read_to_string(&taken).unwrap(), "чужое");
        std::fs::remove_dir_all(&root).ok();
    }

    /// В `.obsidian` не пишется, даже если туда ведёт корень проекта:
    /// настройка `/` у заметки внутри него.
    #[test]
    fn pasted_image_stays_out_of_obsidian() {
        let dir = temp_dir("paste-obsidian");
        let root = dir.join(".obsidian");
        std::fs::create_dir_all(&root).unwrap();
        let note = root.join("Заметка.md");

        assert!(save_image(&Attachments::Root, &note, Some(&root), STAMP, &png()).is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Не PNG, неполный путь, папки заметки нет — отказ, и ничего
    /// не создано.
    #[test]
    fn pasted_image_refusals() {
        let root = temp_dir("paste-refuse");
        let note = root.join("Заметка.md");

        assert!(save_image(&Attachments::NoteFolder, &note, None, STAMP, b"BM....").is_err());
        assert!(save_image(&Attachments::NoteFolder, Path::new("Заметка.md"), None, STAMP, &png()).is_err());
        let gone = root.join("удалённая").join("Заметка.md");
        assert!(save_image(&Attachments::NoteFolder, &gone, None, STAMP, &png()).is_err());
        assert!(!root.join("удалённая").exists());
        assert!(save_image(&Attachments::NoteFolder, &note, None, "..\\..\\x", &png()).is_err());

        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir_all(&root).ok();
    }

    /// Файл в корне заметки остаётся на месте — ссылка на него, копии нет.
    #[test]
    fn dropped_file_inside_the_root_stays() {
        let root = temp_dir("drop-inside");
        std::fs::create_dir_all(root.join("Архив")).unwrap();
        let note = root.join("Заметка.md");
        let file = root.join("Архив").join("отчёт.pdf");
        std::fs::write(&file, "pdf").unwrap();

        let placed = place_file(&Attachments::NoteFolder, &note, Some(&root), &file).unwrap();

        assert_eq!(placed, file);
        assert!(!root.join("отчёт.pdf").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    /// Файл извне — копией в папку вложений, под своим именем; занято —
    /// с номером. Исходник цел, чужой файл с тем же именем тоже.
    #[test]
    fn dropped_file_from_outside_is_copied() {
        let dir = temp_dir("drop-outside");
        let root = dir.join("Хранилище");
        let outside = dir.join("Загрузки");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let note = root.join("Заметка.md");
        let file = outside.join("отчёт.pdf");
        std::fs::write(&file, "свежий").unwrap();

        let beside = Attachments::BesideNote("Вложения".into());
        let first = place_file(&beside, &note, Some(&root), &file).unwrap();
        assert_eq!(first, root.join("Вложения").join("отчёт.pdf"));
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "свежий");

        let second = place_file(&beside, &note, Some(&root), &file).unwrap();
        assert_eq!(second, root.join("Вложения").join("отчёт 1.pdf"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "свежий");
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "свежий");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Вне проектов «корень» — папка заметки: её файлы на месте,
    /// остальные — копией рядом.
    #[test]
    fn dropped_file_for_a_note_outside_projects() {
        let dir = temp_dir("drop-no-root");
        let notes = dir.join("Разное");
        std::fs::create_dir_all(notes.join("img")).unwrap();
        let note = notes.join("Заметка.md");
        let near = notes.join("img").join("x.png");
        let far = dir.join("y.png");
        std::fs::write(&near, "png").unwrap();
        std::fs::write(&far, "png").unwrap();

        assert_eq!(place_file(&Attachments::Root, &note, None, &near).unwrap(), near);
        assert_eq!(place_file(&Attachments::Root, &note, None, &far).unwrap(), notes.join("y.png"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn dropped_folder_is_refused() {
        let root = temp_dir("drop-folder");
        let outside = temp_dir("drop-folder-src");
        let note = root.join("Заметка.md");

        assert!(place_file(&Attachments::NoteFolder, &note, Some(&root), &outside).is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn headers_are_unescaped() {
        assert_eq!(
            unescape("C%3A%5C%D0%97%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B0.md").as_deref(),
            Some(r"C:\Заметка.md")
        );
        assert_eq!(unescape("abc").as_deref(), Some("abc"));
        assert_eq!(unescape("%D0").as_deref(), None);
        assert_eq!(unescape("%Z1").as_deref(), None);
        assert_eq!(unescape("%4").as_deref(), None);
    }

    fn fields() -> Fields {
        Fields {
            date: "2026-09-08".to_owned(),
            time: "21:45".to_owned(),
            title: "Заметка 2026-09-08".to_owned(),
        }
    }

    #[test]
    fn creates_the_note_and_the_folder() {
        let dir = temp_dir("create");
        let folder = dir.join("дневник");

        let note = ensure(&folder, "Заметка 2026-09-08.md", "", &fields()).unwrap();

        assert!(note.created);
        assert_eq!(
            std::fs::read_to_string(&note.path).unwrap(),
            "# Заметка 2026-09-08\n\n"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Главное правило задачи: написанное утром не заменяется пустым
    /// шаблоном вечером.
    #[test]
    fn existing_note_is_opened_not_rewritten() {
        let dir = temp_dir("keep");
        let name = "Заметка 2026-09-08.md";
        std::fs::write(dir.join(name), "написано утром\n").unwrap();

        let note = ensure(&dir, name, "", &fields()).unwrap();

        assert!(!note.created, "заметка была, создавать нечего");
        assert_eq!(
            std::fs::read_to_string(&note.path).unwrap(),
            "написано утром\n"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn template_is_filled_in() {
        let dir = temp_dir("template");
        let template = dir.join("шаблон.md");
        std::fs::write(&template, "# {{title}}\n\nНачато в {{time}}\n").unwrap();

        let note = ensure(
            &dir,
            "Заметка 2026-09-08.md",
            &template.to_string_lossy(),
            &fields(),
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(&note.path).unwrap(),
            "# Заметка 2026-09-08\n\nНачато в 21:45\n"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Указанный, но пропавший шаблон — отказ, а не тихая заметка
    /// с заголовком: иначе «шаблон не работает» и никаких объяснений.
    #[test]
    fn missing_template_is_refused() {
        let dir = temp_dir("no-template");

        let result = ensure(
            &dir,
            "Заметка 2026-09-08.md",
            &dir.join("нет-такого.md").to_string_lossy(),
            &fields(),
        );

        assert!(result.is_err());
        assert!(!dir.join("Заметка 2026-09-08.md").exists(), "файл создан зря");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Инвариант 2 сильнее любой настройки.
    #[test]
    fn obsidian_folder_is_refused() {
        let dir = temp_dir("obsidian");

        let result = ensure(
            &dir.join(".obsidian"),
            "Заметка 2026-09-08.md",
            "",
            &fields(),
        );

        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
