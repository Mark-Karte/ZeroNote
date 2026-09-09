//! Заметки, которые приложение создаёт само (задача 90).
//!
//! Пока одна — ежедневная. Логики здесь нет: имя и шаблон считает
//! `markdown/daily`, запись идёт через `fsx::atomic_save`, как всякая другая.
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
