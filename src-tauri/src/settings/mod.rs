//! Пользовательские настройки: файл `data/settings.toml`.
//!
//! Файл — основной интерфейс настройки, а не выгрузка из окна параметров.
//! Отсюда два следствия, заложенных в устройство модуля:
//!
//! * читаем терпимо — отсутствующий ключ берёт значение по умолчанию;
//! * ошибаемся громко — опечатка в имени ключа называется по имени, а не
//!   проглатывается с молчаливым «настройка не применилась».
//!
//! Здесь только чтение. Запись живёт в `edit.rs` и идёт через `toml_edit`,
//! чтобы комментарии и порядок ключей пережили правку из окна параметров
//! (решения Р-013, Р-089). Через serde файл не записывается никогда: он
//! пересобрал бы документ из структуры и стёр всё, чего в структуре нет.

pub mod edit;

use std::path::Path;

use crate::theme::Density;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    #[serde(default = "default_schema")]
    pub schema: u32,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub font: FontSettings,
    #[serde(default)]
    pub editor: EditorSettings,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct AppearanceSettings {
    /// `"system"` — следовать настройке Windows; иначе идентификатор темы.
    pub theme: String,
    /// Какие темы использовать при `theme = "system"`.
    pub light_theme: String,
    pub dark_theme: String,
    pub density: Density,
}

/// Поведение редактора. Не оформление: перенос строк меняет то, как текст
/// разложен, а не как он выглядит, и в теме ему места нет.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct EditorSettings {
    /// Переносить длинные строки по ширине окна. По умолчанию нет — так
    /// ведёт себя Notepad++, и для кода это верное умолчание.
    pub wrap: bool,
    /// Закрывать скобки и кавычки при наборе. По умолчанию да — решение Р-113.
    pub auto_close: bool,
    /// Чем набирать отступ там, где файл не подсказал: `"spaces"` или `"tabs"`.
    ///
    /// Только умолчание: в существующем файле отступ определяется по его
    /// содержимому (Р-106). Иначе первое же нажатие `Tab` в чужом файле
    /// смешало бы табы с пробелами.
    pub indent_style: IndentStyle,
    /// Ширина отступа: сколько пробелов или во сколько столбцов рисуется таб.
    pub indent_width: u8,
    /// Показывать пробелы, табуляции и переносы строк.
    pub invisibles: bool,
    /// Показывать панель разметки над markdown-файлами. По умолчанию да:
    /// заметки — половина того, ради чего редактор писался, а панель видна
    /// только там, где ей место, и не мешает никому больше.
    pub markdown_bar: bool,
    /// Подсказывать имена заметок после `[[` в markdown (Р-132).
    ///
    /// По умолчанию да: это то, ради чего связи между заметками и делались,
    /// а без подсказки имя приходится помнить наизусть. Выключатель нужен
    /// всё равно — список, всплывающий во время набора, мешает тому, кто
    /// пишет ссылки не глядя.
    pub link_suggest: bool,
    /// Сохранять правки в файл без команды (Р-133).
    ///
    /// По умолчанию **нет**, и это заявление о том, чем мы считаем себя
    /// по умолчанию: редактор файлов не пишет в чужой файл без команды.
    /// Пришедший из Obsidian включит и получит привычное; пришедший из
    /// Notepad++ не обнаружит, что его конфиг изменился, пока он отходил.
    pub autosave: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IndentStyle {
    Spaces,
    Tabs,
}

/// Умолчания пишутся руками, а не выводятся `derive(Default)`: у `bool`
/// умолчание `false`, а автозакрытие должно быть включено. Забыть про это
/// легко, и тогда настройка молча выключилась бы у всех, у кого её нет
/// в файле, — то есть у всех.
impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            wrap: false,
            auto_close: true,
            // Четыре пробела — умолчание VS Code и Obsidian, на которые
            // ZeroNote равняется по удобствам (Р-114).
            indent_style: IndentStyle::Spaces,
            indent_width: 4,
            invisibles: false,
            markdown_bar: true,
            link_suggest: true,
            autosave: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FontSettings {
    pub ui: UiFont,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct UiFont {
    /// `None` — значение из темы. Ключ просто отсутствует в файле.
    pub family: Option<String>,
    pub size: Option<u32>,
}

pub const SETTINGS_SCHEMA: u32 = 1;

fn default_schema() -> u32 {
    SETTINGS_SCHEMA
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            schema: SETTINGS_SCHEMA,
            appearance: AppearanceSettings::default(),
            font: FontSettings::default(),
            editor: EditorSettings::default(),
        }
    }
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        AppearanceSettings {
            theme: "system".to_owned(),
            light_theme: "light".to_owned(),
            dark_theme: "dark".to_owned(),
            density: Density::Normal,
        }
    }
}

impl Default for FontSettings {
    fn default() -> Self {
        FontSettings {
            ui: UiFont::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsError {
    Parse(String),
    UnsupportedSchema { found: u32 },
}

impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettingsError::Parse(message) => {
                write!(f, "не удалось разобрать settings.toml: {message}")
            }
            SettingsError::UnsupportedSchema { found } => write!(
                f,
                "версия формата настроек {found} не поддерживается, ожидается {SETTINGS_SCHEMA}"
            ),
        }
    }
}

impl std::error::Error for SettingsError {}

pub fn parse(source: &str) -> Result<Settings, SettingsError> {
    let settings: Settings =
        toml::from_str(source).map_err(|e| SettingsError::Parse(e.message().to_owned()))?;

    if settings.schema != SETTINGS_SCHEMA {
        return Err(SettingsError::UnsupportedSchema {
            found: settings.schema,
        });
    }

    Ok(settings)
}

/// Чтение с диска.
///
/// Отсутствие файла — не ошибка: это первый запуск, берём значения по умолчанию.
/// А вот испорченный файл — ошибка, и она должна дойти до пользователя, иначе
/// он будет чинить «не работает тема» вслепую.
pub fn load(path: &Path) -> Result<Settings, SettingsError> {
    match std::fs::read_to_string(path) {
        Ok(source) => parse(&source),
        Err(_) => Ok(Settings::default()),
    }
}

/// Образец файла, который кладётся при первом запуске.
///
/// Записывается дословно, вместе с комментариями: сериализация через serde
/// комментарии не переживает, а для файла, который правят руками, они и есть
/// половина пользы.
pub const DEFAULT_TEMPLATE: &str = r#"# Настройки ZeroNote.
#
# Файл можно править руками и класть в git. Приложение подхватывает изменения
# на лету, перезапуск не нужен.
#
# Закомментированные ключи показывают значения по умолчанию.

schema = 1

[appearance]
# "system" — следовать настройке оформления Windows.
# Иначе — идентификатор темы. Встроенные:
#   светлые — "light" (Бумага), "sepia" (Сепия)
#   тёмные  — "dark" (Графит), "midnight" (Полночь), "nordic" (Нордик),
#             "pine" (Хвоя), "contrast" (Контраст)
# Свою тему кладите в data/themes/ и указывайте её id.
theme = "system"

# Какие темы использовать, когда theme = "system".
light_theme = "light"
dark_theme = "dark"

# Плотность интерфейса: "normal" или "compact".
density = "normal"

[font.ui]
# Шрифт интерфейса. Если ключа нет — берётся из темы (по умолчанию системный).
# family = "Segoe UI"
# size = 13

[editor]
# Переносить длинные строки по ширине окна.
wrap = false
# Закрывать скобки и кавычки при наборе. В прозе — markdown и обычном
# тексте — кавычки не закрываются и при включённой настройке: там они
# не парные.
auto_close = true
# Чем набирать отступ: "spaces" или "tabs", и какой ширины. Это только
# умолчание: в существующем файле отступ определяется по его содержимому,
# и настройка его не переписывает. Что определилось — видно в строке
# состояния, там же можно сменить для одной вкладки.
indent_style = "spaces"
indent_width = 4
# Показывать пробелы, табуляции и переносы строк.
invisibles = false
# Панель разметки над markdown-файлами: жирный, курсив, заголовки, списки,
# ссылка и заготовки. Появляется только на markdown, в остальных файлах
# её нет. Всё то же есть в палитре команд.
markdown_bar = true
# Подсказывать имена заметок после `[[` в markdown. Список берётся из индекса
# проекта — тот же, что показывает быстрое открытие. Автодополнением кода
# ZeroNote не занимается и заниматься не будет.
link_suggest = true
# Сохранять правки в файл без команды: через две секунды после последней
# правки и когда окно теряет фокус. По умолчанию выключено — редактор файлов
# не пишет в чужой файл без команды. Черновики (инвариант 4) работают всегда
# и не зависят от этой настройки.
autosave = false
"#;

/// Создать файл настроек, если его ещё нет.
///
/// Существующий файл не трогаем никогда: он мог быть отредактирован руками,
/// и перезапись уничтожила бы комментарии и правки пользователя.
pub fn write_default_if_missing(path: &Path) -> std::io::Result<bool> {
    if path.exists() {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, DEFAULT_TEMPLATE)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Образец обязан разбираться и давать ровно значения по умолчанию.
    /// Без этого теста комментарии в образце и код разъедутся незаметно.
    #[test]
    fn template_matches_defaults() {
        let parsed = parse(DEFAULT_TEMPLATE).expect("образец должен разбираться");
        assert_eq!(parsed, Settings::default());
    }

    /// Настройка, которой в файле нет, берёт умолчание — и для автозакрытия
    /// это `true`, а не `false`.
    ///
    /// Тест не про сериализацию, а про грабли: у `bool` умолчание `false`,
    /// и `derive(Default)` молча выключил бы автозакрытие у всех, у кого
    /// файл настроек написан до появления этого ключа. То есть у всех.
    #[test]
    fn auto_close_is_on_when_the_key_is_missing() {
        let parsed = parse(
            r#"
            schema = 1
            [editor]
            wrap = true
        "#,
        )
        .expect("файл должен разбираться");

        assert!(parsed.editor.wrap);
        assert!(parsed.editor.auto_close, "автозакрытие включено по умолчанию");
        assert!(
            parsed.editor.markdown_bar,
            "панель разметки включена по умолчанию"
        );
    }

    /// Пустой файл — это все значения по умолчанию, а не ошибка.
    #[test]
    fn empty_file_yields_defaults() {
        let parsed = parse("schema = 1").expect("минимальный файл должен разбираться");
        assert_eq!(parsed, Settings::default());
    }

    /// Частичный файл дополняется умолчаниями, а не обнуляет остальное.
    #[test]
    fn partial_file_is_filled_with_defaults() {
        let parsed = parse(
            r#"
            schema = 1
            [appearance]
            density = "compact"
        "#,
        )
        .expect("частичный файл должен разбираться");

        assert_eq!(parsed.appearance.density, Density::Compact);
        assert_eq!(parsed.appearance.theme, "system");
        assert_eq!(parsed.appearance.light_theme, "light");
    }

    /// Опечатка называется по имени. Файл правят руками, и молчаливое
    /// игнорирование ключа — худшее, что можно сделать.
    #[test]
    fn typo_in_key_is_reported() {
        let error = parse(
            r#"
            schema = 1
            [appearance]
            densty = "compact"
        "#,
        )
        .expect_err("опечатка должна быть ошибкой");

        let message = error.to_string();
        assert!(
            message.contains("densty"),
            "сообщение должно называть ключ: {message}"
        );
    }

    /// Файл из будущей версии не применяется наполовину.
    #[test]
    fn future_schema_is_rejected() {
        assert_eq!(
            parse("schema = 42"),
            Err(SettingsError::UnsupportedSchema { found: 42 })
        );
    }

    /// Отсутствие файла — первый запуск, а не поломка.
    #[test]
    fn missing_file_yields_defaults() {
        let path = std::env::temp_dir().join("zeronote-нет-такого-файла.toml");
        assert_eq!(load(&path), Ok(Settings::default()));
    }

    /// Существующий файл не перезаписывается: там могут быть правки и комментарии.
    #[test]
    fn existing_file_is_never_overwritten() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-settings-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.toml");

        let mine = "schema = 1\n# мой комментарий\n";
        std::fs::write(&path, mine).unwrap();

        let written = write_default_if_missing(&path).unwrap();

        assert!(!written, "файл существовал, писать было нельзя");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), mine);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
