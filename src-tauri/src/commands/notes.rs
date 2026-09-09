//! Заметки, которые приложение создаёт само: ежедневная (задача 90)
//! и заготовки-шаблоны (задача 95).
//!
//! Логики здесь нет: имя и подстановки считает `markdown/daily`, пути —
//! `model/vault`, запись идёт через `fsx::atomic_save`, как всякая другая.
//! Здесь то, что нельзя проверить чистой функцией: настройки, папка данных
//! и существующий файл.
//!
//! Главное правило: **существующая заметка не переписывается никогда**.
//! Команду за день нажимают много раз, и второе нажатие обязано открыть
//! написанное утром, а не заменить его пустым шаблоном.

use std::path::Path;

use crate::markdown::daily::{self, Fields};
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

/// За какие дни месяца заметки уже написаны.
///
/// Месяц приходит в виде `2026-09` — от окна, как и дата: у ядра нет
/// часового пояса, и «текущий месяц» оно посчитать не может. Ответ — номера
/// дней, а не пути: календарю нужно знать, что помечать, а открывать он
/// будет той же командой, что и «заметка на сегодня».
#[tauri::command]
pub fn daily_notes_of_month(state: tauri::State<'_, AppState>, month: String) -> Vec<u32> {
    let settings = crate::settings::load(&state.data_dir.settings_file()).unwrap_or_default();
    let vault = crate::model::vault::path_of(&settings.notes.vault, &state.data_dir.path);
    let folder = crate::model::vault::daily_folder(&settings.notes.daily_folder, &vault);

    let Ok(entries) = std::fs::read_dir(&folder) else {
        // Папки может не быть вовсе — ни одной заметки ещё не написали.
        // Это не ошибка: календарь просто покажет месяц без пометок.
        return Vec::new();
    };

    let names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_file())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();

    days_of(&names, &month)
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
    let raw = crate::text::document::read_raw(&bytes)
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
    let raw = crate::text::document::read_raw(&bytes)
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
