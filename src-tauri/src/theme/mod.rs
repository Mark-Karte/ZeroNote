//! Разбор файлов тем и сборка итогового набора значений токенов.
//!
//! Вся логика оформления живёт здесь, в Rust. Фронтенд получает готовую плоскую
//! таблицу «имя токена → значение CSS» и просто выставляет её на `:root`.
//! Ни одного правила выбора цвета на стороне интерфейса нет — это то же самое
//! разделение обязанностей, что и с файловым вводом-выводом.

pub mod tokens;

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    Normal,
    Compact,
}

/// Файл темы как он лежит на диске.
///
/// `deny_unknown_fields` — сознательный выбор: файл правится руками, и опечатка
/// в названии раздела должна быть видна сразу, а не приводить к молчаливому
/// «настройка не применилась».
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeFile {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub appearance: Appearance,

    #[serde(default)]
    pub palette: BTreeMap<String, String>,

    // Разделы переопределения семантических токенов. Имя раздела становится
    // префиксом имени токена: [color] bg-canvas -> color-bg-canvas.
    #[serde(default)]
    pub color: BTreeMap<String, String>,
    #[serde(default)]
    pub font: BTreeMap<String, String>,
    #[serde(default)]
    pub space: BTreeMap<String, String>,
    #[serde(default)]
    pub radius: BTreeMap<String, String>,
    #[serde(default)]
    pub border: BTreeMap<String, String>,
    #[serde(default)]
    pub shadow: BTreeMap<String, String>,
    #[serde(default)]
    pub motion: BTreeMap<String, String>,
    #[serde(default)]
    pub z: BTreeMap<String, String>,
    #[serde(default)]
    pub control: BTreeMap<String, String>,
}

/// Текущая версия формата файла темы.
pub const THEME_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThemeError {
    Parse(String),
    UnsupportedSchema { found: u32 },
    UnknownToken { name: String },
    UnknownPaletteKey { token: String, key: String },
    UnclosedReference { token: String, value: String },
    Io(String),
}

impl std::fmt::Display for ThemeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ThemeError::Parse(message) => write!(f, "не удалось разобрать тему: {message}"),
            ThemeError::UnsupportedSchema { found } => write!(
                f,
                "версия формата темы {found} не поддерживается, ожидается {THEME_SCHEMA}"
            ),
            ThemeError::UnknownToken { name } => {
                write!(f, "неизвестный токен оформления: {name}")
            }
            ThemeError::UnknownPaletteKey { token, key } => write!(
                f,
                "токен {token} ссылается на отсутствующий цвет палитры: {key}"
            ),
            ThemeError::UnclosedReference { token, value } => {
                write!(f, "в значении токена {token} не закрыта ссылка: {value}")
            }
            ThemeError::Io(message) => write!(f, "ошибка чтения темы: {message}"),
        }
    }
}

impl std::error::Error for ThemeError {}

impl ThemeFile {
    /// Разделы переопределений вместе с их префиксами.
    ///
    /// Возвращаются заимствованные ссылки: копировать таблицы незачем, они
    /// нужны только на время сборки итогового набора.
    fn sections(&self) -> [(&str, &BTreeMap<String, String>); 9] {
        [
            ("color", &self.color),
            ("font", &self.font),
            ("space", &self.space),
            ("radius", &self.radius),
            ("border", &self.border),
            ("shadow", &self.shadow),
            ("motion", &self.motion),
            ("z", &self.z),
            ("control", &self.control),
        ]
    }
}

pub fn parse(source: &str) -> Result<ThemeFile, ThemeError> {
    let theme: ThemeFile =
        toml::from_str(source).map_err(|e| ThemeError::Parse(e.message().to_owned()))?;

    if theme.schema != THEME_SCHEMA {
        return Err(ThemeError::UnsupportedSchema {
            found: theme.schema,
        });
    }

    Ok(theme)
}

const LIGHT_SOURCE: &str = include_str!("builtin/light.toml");
const DARK_SOURCE: &str = include_str!("builtin/dark.toml");

/// Встроенная тема. Разбирается при каждом обращении — это доли миллисекунды
/// на файл в пару килобайт, и оно того стоит: не нужен ни кэш, ни блокировка.
pub fn builtin(appearance: Appearance) -> ThemeFile {
    let source = match appearance {
        Appearance::Light => LIGHT_SOURCE,
        Appearance::Dark => DARK_SOURCE,
    };
    // Встроенные темы вкомпилированы в бинарник. Если они не разбираются —
    // это ошибка сборки проекта, а не пользователя, и её надо увидеть сразу.
    // Тест builtin_themes_parse ловит такое до выпуска.
    parse(source).expect("встроенная тема должна разбираться")
}

pub fn builtin_source(appearance: Appearance) -> &'static str {
    match appearance {
        Appearance::Light => LIGHT_SOURCE,
        Appearance::Dark => DARK_SOURCE,
    }
}

/// Подстановка ссылок `{palette.ключ}` внутри значения токена.
///
/// Ссылки ищутся в любом месте строки, а не только целиком: это нужно теням
/// вида `0 1px 2px {palette.shadow}`. Вложенность не поддерживается намеренно —
/// значение палитры считается литералом.
fn substitute(
    value: &str,
    palette: &BTreeMap<String, String>,
    token: &str,
) -> Result<String, ThemeError> {
    const PREFIX: &str = "{palette.";

    let mut out = String::with_capacity(value.len());
    let mut rest = value;

    while let Some(start) = rest.find(PREFIX) {
        out.push_str(&rest[..start]);
        let after = &rest[start + PREFIX.len()..];

        let Some(end) = after.find('}') else {
            return Err(ThemeError::UnclosedReference {
                token: token.to_owned(),
                value: value.to_owned(),
            });
        };

        let key = &after[..end];
        let Some(replacement) = palette.get(key) else {
            return Err(ThemeError::UnknownPaletteKey {
                token: token.to_owned(),
                key: key.to_owned(),
            });
        };

        out.push_str(replacement);
        rest = &after[end + 1..];
    }

    out.push_str(rest);
    Ok(out)
}

/// Итоговая таблица «имя токена → значение CSS» без пользовательских
/// переопределений. Отдельная функция только ради краткости в тестах.
pub fn resolve(theme: &ThemeFile, density: Density) -> Result<BTreeMap<String, String>, ThemeError> {
    resolve_with(theme, density, &BTreeMap::new())
}

/// Итоговая таблица «имя токена → значение CSS».
///
/// Порядок наложения: база → метрики плотности → семантические роли →
/// переопределения темы → переопределения из настроек пользователя.
/// Последним шагом раскрываются ссылки на палитру.
///
/// Настройки идут после темы намеренно: выбранный пользователем шрифт
/// интерфейса не должен сбрасываться при смене темы.
pub fn resolve_with(
    theme: &ThemeFile,
    density: Density,
    overrides: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, ThemeError> {
    let known: BTreeSet<&str> = tokens::all_names().into_iter().collect();

    let mut values: BTreeMap<String, String> = BTreeMap::new();

    for (name, value) in tokens::BASE {
        values.insert((*name).to_owned(), (*value).to_owned());
    }

    let metrics = match density {
        Density::Normal => tokens::METRICS_NORMAL,
        Density::Compact => tokens::METRICS_COMPACT,
    };
    for (name, value) in metrics {
        values.insert((*name).to_owned(), (*value).to_owned());
    }

    for (name, value) in tokens::SEMANTIC_COLORS {
        values.insert((*name).to_owned(), (*value).to_owned());
    }

    for (prefix, section) in theme.sections() {
        for (key, value) in section {
            let name = format!("{prefix}-{key}");
            if !known.contains(name.as_str()) {
                return Err(ThemeError::UnknownToken { name });
            }
            values.insert(name, value.clone());
        }
    }

    for (name, value) in overrides {
        if !known.contains(name.as_str()) {
            return Err(ThemeError::UnknownToken { name: name.clone() });
        }
        values.insert(name.clone(), value.clone());
    }

    // Пользовательская тема может задать только часть палитры: недостающие
    // цвета берутся из встроенной темы того же вида. Так тема из пяти строк
    // остаётся работоспособной и не разваливается на неописанных ролях.
    let mut palette = builtin(theme.appearance).palette;
    for (key, value) in &theme.palette {
        palette.insert(key.clone(), value.clone());
    }

    let mut resolved = BTreeMap::new();
    for (name, value) in values {
        let expanded = substitute(&value, &palette, &name)?;
        resolved.insert(name, expanded);
    }

    Ok(resolved)
}

/// Краткое описание темы для списка выбора в интерфейсе.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInfo {
    pub id: String,
    pub name: String,
    pub appearance: Appearance,
    /// `true` — встроенная, файла на диске нет.
    pub builtin: bool,
}

/// Все доступные темы: две встроенные плюс всё, что лежит в папке пользователя.
///
/// Битые файлы не роняют список: тема, которую не удалось разобрать, просто
/// не попадает в него, а причина возвращается отдельным списком, чтобы
/// интерфейс мог показать её пользователю, а не проглотить.
pub fn available(themes_dir: &Path) -> (Vec<ThemeInfo>, Vec<String>) {
    let mut list = vec![
        info_of(&builtin(Appearance::Light), true),
        info_of(&builtin(Appearance::Dark), true),
    ];
    let mut problems = Vec::new();

    let entries = match std::fs::read_dir(themes_dir) {
        Ok(entries) => entries,
        // Папки тем может не быть — это нормальная ситуация, а не ошибка.
        Err(_) => return (list, problems),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }

        match std::fs::read_to_string(&path) {
            Ok(source) => match parse(&source) {
                Ok(theme) => {
                    // Пользовательская тема с id встроенной перекрывает её.
                    list.retain(|existing| existing.id != theme.id);
                    list.push(info_of(&theme, false));
                }
                Err(e) => problems.push(format!("{}: {e}", path.display())),
            },
            Err(e) => problems.push(format!("{}: {e}", path.display())),
        }
    }

    list.sort_by(|a, b| a.name.cmp(&b.name));
    (list, problems)
}

fn info_of(theme: &ThemeFile, builtin: bool) -> ThemeInfo {
    ThemeInfo {
        id: theme.id.clone(),
        name: theme.name.clone(),
        appearance: theme.appearance,
        builtin,
    }
}

/// Найти тему по идентификатору: сначала среди пользовательских, потом среди
/// встроенных. Пользовательская тема с тем же id имеет приоритет — это даёт
/// простой способ подменить встроенную, не трогая бинарник.
pub fn load_by_id(themes_dir: &Path, id: &str) -> Option<ThemeFile> {
    if let Ok(entries) = std::fs::read_dir(themes_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("toml") {
                continue;
            }
            if let Ok(source) = std::fs::read_to_string(&path)
                && let Ok(theme) = parse(&source)
                && theme.id == id
            {
                return Some(theme);
            }
        }
    }

    match id {
        "light" => Some(builtin(Appearance::Light)),
        "dark" => Some(builtin(Appearance::Dark)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Встроенные темы вкомпилированы в бинарник: если они не разбираются,
    /// приложение падает при первом же старте. Ловим это тестом.
    #[test]
    fn builtin_themes_parse() {
        let light = builtin(Appearance::Light);
        assert_eq!(light.id, "light");
        assert_eq!(light.appearance, Appearance::Light);

        let dark = builtin(Appearance::Dark);
        assert_eq!(dark.id, "dark");
        assert_eq!(dark.appearance, Appearance::Dark);
    }

    /// После сборки не должно остаться ни одной неразвёрнутой ссылки,
    /// иначе в CSS уедет строка вида "{palette.bg-0}" и элемент станет невидимым.
    #[test]
    fn builtin_themes_resolve_completely() {
        for appearance in [Appearance::Light, Appearance::Dark] {
            for density in [Density::Normal, Density::Compact] {
                let resolved =
                    resolve(&builtin(appearance), density).expect("встроенная тема должна собраться");

                for (name, value) in &resolved {
                    assert!(
                        !value.contains("{palette."),
                        "токен {name} остался с неразвёрнутой ссылкой: {value}"
                    );
                    assert!(!value.is_empty(), "токен {name} пуст");
                }
            }
        }
    }

    /// Итоговая таблица обязана покрывать весь канонический список токенов.
    #[test]
    fn resolve_covers_every_token() {
        let resolved =
            resolve(&builtin(Appearance::Dark), Density::Normal).expect("тема должна собраться");
        let produced: BTreeSet<&str> = resolved.keys().map(|k| k.as_str()).collect();
        let expected: BTreeSet<&str> = tokens::all_names().into_iter().collect();
        assert_eq!(produced, expected);
    }

    /// Плотность меняет метрики и не трогает цвета.
    #[test]
    fn density_changes_metrics_only() {
        let theme = builtin(Appearance::Dark);
        let normal = resolve(&theme, Density::Normal).unwrap();
        let compact = resolve(&theme, Density::Compact).unwrap();

        assert_ne!(normal["space-3"], compact["space-3"]);
        assert_ne!(
            normal["control-statusbar-height"],
            compact["control-statusbar-height"]
        );
        assert_eq!(normal["color-bg-canvas"], compact["color-bg-canvas"]);
        assert_eq!(normal["color-fg-default"], compact["color-fg-default"]);
    }

    /// Тема из одного раздела [palette] обязана работать: это основной способ
    /// написать свою тему, и он не должен требовать перечисления всех ролей.
    #[test]
    fn minimal_theme_needs_palette_only() {
        let source = r##"
            schema = 1
            id = "мой-вариант"
            name = "Мой вариант"
            appearance = "dark"

            [palette]
            bg-0 = "#000000"
            accent = "#ff8800"
        "##;

        let theme = parse(source).expect("тема должна разобраться");
        let resolved = resolve(&theme, Density::Normal).expect("тема должна собраться");

        assert_eq!(resolved["color-bg-canvas"], "#000000");
        assert_eq!(resolved["color-accent"], "#ff8800");
        // Не заданное в палитре берётся из встроенной тёмной темы.
        assert_eq!(
            resolved["color-fg-default"],
            builtin(Appearance::Dark).palette["fg-0"]
        );
    }

    /// Опечатка в имени токена должна называться по имени, а не молча теряться.
    #[test]
    fn unknown_token_is_reported() {
        let source = r##"
            schema = 1
            id = "с-опечаткой"
            name = "С опечаткой"
            appearance = "dark"

            [color]
            bg-canvass = "#123456"
        "##;

        let theme = parse(source).expect("разбор TOML должен пройти");
        let error = resolve(&theme, Density::Normal).expect_err("должна быть ошибка");

        assert_eq!(
            error,
            ThemeError::UnknownToken {
                name: "color-bg-canvass".to_owned()
            }
        );
    }

    /// Опечатка в названии раздела тоже не должна проходить молча.
    #[test]
    fn unknown_section_is_reported() {
        let source = r##"
            schema = 1
            id = "x"
            name = "X"
            appearance = "dark"

            [colour]
            bg-canvas = "#123456"
        "##;

        assert!(matches!(parse(source), Err(ThemeError::Parse(_))));
    }

    /// Ссылка на несуществующий цвет палитры называет и токен, и ключ.
    #[test]
    fn unknown_palette_key_is_reported() {
        let source = r##"
            schema = 1
            id = "x"
            name = "X"
            appearance = "dark"

            [color]
            bg-canvas = "{palette.нет-такого}"
        "##;

        let theme = parse(source).unwrap();
        let error = resolve(&theme, Density::Normal).expect_err("должна быть ошибка");

        assert_eq!(
            error,
            ThemeError::UnknownPaletteKey {
                token: "color-bg-canvas".to_owned(),
                key: "нет-такого".to_owned()
            }
        );
    }

    /// Ссылки раскрываются и внутри составного значения — это нужно теням.
    #[test]
    fn reference_inside_compound_value() {
        let source = r##"
            schema = 1
            id = "x"
            name = "X"
            appearance = "dark"

            [palette]
            accent = "#112233"

            [shadow]
            raised = "0 1px 2px {palette.accent}, 0 0 0 1px {palette.accent}"
        "##;

        let theme = parse(source).unwrap();
        let resolved = resolve(&theme, Density::Normal).unwrap();

        assert_eq!(
            resolved["shadow-raised"],
            "0 1px 2px #112233, 0 0 0 1px #112233"
        );
    }

    /// Чужая версия формата отвергается с внятным сообщением, а не молча
    /// применяется наполовину.
    #[test]
    fn future_schema_is_rejected() {
        let source = r##"
            schema = 99
            id = "x"
            name = "X"
            appearance = "dark"
        "##;

        assert_eq!(
            parse(source),
            Err(ThemeError::UnsupportedSchema { found: 99 })
        );
    }
}
