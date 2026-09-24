//! Редактор тем (задача 105): что показать и как записать одно значение.
//!
//! Формат темы с этапа 3 умеет переопределить любой токен по имени —
//! не хватало правки без текстового редактора. Здесь две вещи: состояние
//! для окна (палитра в порядке файла, каждый токен с умолчанием,
//! переопределением темы и итоговым значением, находки проверки
//! читаемости) и запись одного значения через `toml_edit`, при которой
//! комментарии и порядок файла остаются как были (Р-166).
//!
//! Правка, после которой тема не собралась бы, не пишется вовсе: окно
//! получает отказ словами, файл остаётся прежним. Это то же правило, что
//! у настроек (`settings::edit::verify`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use toml_edit::{DocumentMut, Item, Table};

use super::readability::{self, Finding};
use super::{
    builtin_by_id, builtin_source, effective_palette, layer_default, parse, resolve, resolve_with,
    tokens, Appearance, Density, ThemeError, ThemeFile, SECTIONS,
};

/// Всё, что нужно окну, чтобы показать тему для правки.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorState {
    pub id: String,
    pub name: String,
    pub appearance: Appearance,
    /// Встроенная тема живёт в двоичном файле приложения и не правится:
    /// правят свою копию.
    pub builtin: bool,
    /// Файл своей темы; у встроенной — `None`.
    pub path: Option<String>,
    pub palette: Vec<PaletteEntry>,
    pub tokens: Vec<TokenEntry>,
    pub findings: Vec<Finding>,
    /// Тема не собирается — почему. Из окна такую правку не записать,
    /// значит, файл правили руками.
    pub problem: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteEntry {
    pub key: String,
    /// Действующее значение: из файла темы, из встроенной пары или выведенное.
    pub value: String,
    /// Задано в файле темы. Иначе значение пришло из встроенной темы того же
    /// вида — такой ключ «вернуть» нечего.
    pub own: bool,
    /// Выведено из других цветов палитры (`bg-block`, Р-246), а не задано.
    pub derived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenEntry {
    /// Полное имя: `color-bg-canvas`.
    pub name: String,
    /// Раздел файла темы: `color`.
    pub section: String,
    /// Ключ в разделе: `bg-canvas`.
    pub key: String,
    /// Значение слоя токенов при нынешней плотности, до темы.
    pub default: String,
    /// Переопределение из файла темы.
    pub own: Option<String>,
    /// Что стоит на экране: ссылки на палитру раскрыты.
    pub resolved: String,
}

/// Файл своей темы с этим идентификатором: путь и текст.
///
/// Порядок тот же, что у `load_by_id`: своя тема с идентификатором встроенной
/// сильнее её — значит, правится файл.
pub fn user_theme(themes_dir: &Path, id: &str) -> Option<(PathBuf, String)> {
    let entries = std::fs::read_dir(themes_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        if let Ok(source) = std::fs::read_to_string(&path)
            && let Ok(theme) = parse(&source)
            && theme.id == id
        {
            return Some((path, source));
        }
    }
    None
}

/// Раздел файла, к которому относится токен: `color-bg-canvas` → `color`.
pub fn section_of(name: &str) -> Option<(&'static str, &str)> {
    SECTIONS.iter().find_map(|section| {
        let key = name.strip_prefix(section)?.strip_prefix('-')?;
        Some((*section, key))
    })
}

/// Состояние для окна.
pub fn editor_state(themes_dir: &Path, id: &str, density: Density) -> Result<EditorState, ThemeError> {
    let (theme, path) = match user_theme(themes_dir, id) {
        Some((path, source)) => (parse(&source)?, Some(path)),
        None => (
            builtin_by_id(id).ok_or_else(|| ThemeError::Io(format!("тема «{id}» не найдена")))?,
            None,
        ),
    };

    let (resolved, problem) = match resolve_with(&theme, density, &BTreeMap::new()) {
        Ok(values) => (values, None),
        Err(e) => (BTreeMap::new(), Some(e.to_string())),
    };

    let tokens = tokens::all_names()
        .into_iter()
        .filter_map(|name| {
            let (section, key) = section_of(name)?;
            Some(TokenEntry {
                name: name.to_owned(),
                section: section.to_owned(),
                key: key.to_owned(),
                default: layer_default(name, density).unwrap_or_default(),
                own: theme.section(section).and_then(|table| table.get(key)).cloned(),
                resolved: resolved.get(name).cloned().unwrap_or_default(),
            })
        })
        .collect();

    Ok(EditorState {
        id: theme.id.clone(),
        name: theme.name.clone(),
        appearance: theme.appearance,
        builtin: path.is_none(),
        path: path.map(|p| p.display().to_string()),
        palette: palette_entries(&theme),
        tokens,
        findings: readability::check(&resolved),
        problem,
    })
}

/// Палитра в порядке файла встроенной темы того же вида.
///
/// Порядок — часть смысла: во встроенных файлах ключи идут группами (фоны,
/// текст, акцент, подсветка), и алфавит их перемешал бы. Порядок берётся
/// из исходника через `toml_edit`: разбор через serde кладёт ключи в
/// `BTreeMap` и порядок теряет. Ключи, которых во встроенной нет, — в конце.
fn palette_entries(theme: &ThemeFile) -> Vec<PaletteEntry> {
    let effective = effective_palette(theme);

    let mut order: Vec<String> = builtin_source(theme.appearance)
        .parse::<DocumentMut>()
        .ok()
        .and_then(|doc| {
            doc.get("palette")
                .and_then(Item::as_table)
                .map(|table| table.iter().map(|(key, _)| key.to_owned()).collect())
        })
        .unwrap_or_default();
    for key in effective.keys() {
        if !order.contains(key) {
            order.push(key.clone());
        }
    }

    order
        .into_iter()
        .filter_map(|key| {
            let value = effective.get(&key)?.clone();
            let own = theme.palette.contains_key(&key);
            let derived = key == "bg-block" && !own;
            Some(PaletteEntry { key, value, own, derived })
        })
        .collect()
}

/// Записать одно значение в исходник темы или убрать его (`None`).
///
/// `section` — `palette` или один из разделов токенов. Возвращает новый
/// текст; ошибка — правка сделала бы тему несобираемой или сама негодна.
pub fn set_value(
    source: &str,
    section: &str,
    key: &str,
    value: Option<&str>,
) -> Result<String, ThemeError> {
    if section == "palette" {
        let good = !key.is_empty()
            && key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !good {
            return Err(ThemeError::Invalid(format!(
                "ключ палитры «{key}»: только строчные латинские буквы, цифры и дефис"
            )));
        }
    } else if SECTIONS.contains(&section) {
        let name = format!("{section}-{key}");
        if !tokens::all_names().contains(&name.as_str()) {
            return Err(ThemeError::UnknownToken { name });
        }
    } else {
        return Err(ThemeError::Invalid(format!("раздела [{section}] у темы нет")));
    }

    let value = match value.map(str::trim) {
        Some("") => {
            return Err(ThemeError::Invalid(
                "пустое значение: чтобы вернуть умолчание, уберите значение".to_owned(),
            ));
        }
        Some(text) if text.contains(['\n', '\r']) => {
            return Err(ThemeError::Invalid("значение в одну строку".to_owned()));
        }
        other => other,
    };

    let mut document: DocumentMut = source
        .parse()
        .map_err(|e: toml_edit::TomlError| ThemeError::Parse(e.to_string()))?;

    match value {
        Some(text) => {
            if document.get(section).is_none() {
                document.insert(section, Item::Table(Table::new()));
            }
            let table = document[section]
                .as_table_mut()
                .ok_or_else(|| ThemeError::Invalid(format!("[{section}] в файле темы — не раздел")))?;

            match table.get_mut(key) {
                // Значение меняется на месте, а оформление — отступ
                // и комментарий в конце строки — переезжает на новое:
                // `bg-0 = "#1b1f27"  # подложка окна` так и останется
                // с пояснением.
                Some(existing) if existing.is_value() => {
                    let old = existing.as_value().expect("проверено условием");
                    let prefix = old.decor().prefix().and_then(|s| s.as_str()).unwrap_or(" ").to_owned();
                    let suffix = old.decor().suffix().and_then(|s| s.as_str()).unwrap_or("").to_owned();
                    *existing = Item::Value(toml_edit::Value::from(text).decorated(prefix, suffix));
                }
                Some(_) => {
                    return Err(ThemeError::Invalid(format!("{section}.{key} в файле — не значение")));
                }
                None => {
                    table.insert(key, toml_edit::value(text));
                }
            }
        }
        None => {
            if let Some(table) = document.get_mut(section).and_then(Item::as_table_mut) {
                crate::settings::edit::remove_keeping_comment(table, key);
            }
        }
    }

    let text = document.to_string();

    // Тема обязана собираться при обеих плотностях: метрики у них разные,
    // и ссылка, годная в одной, могла бы сломаться в другой.
    let theme = parse(&text)?;
    resolve(&theme, Density::Normal)?;
    resolve(&theme, Density::Compact)?;

    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    const THEME: &str = r##"# Моя тема — пояснение в заголовке.
schema = 1
id = "моя"
name = "Моя"
appearance = "dark"

[palette]
# Фоны.
bg-0 = "#101010"          # подложка окна
fg-0 = "#eeeeee"

[radius]
sm = "2px"
"##;

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("zeronote-theme-editor-{name}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn palette_value_changes_in_place_with_its_comment() {
        let text = set_value(THEME, "palette", "bg-0", Some("#202020")).unwrap();

        assert!(text.contains(r##"bg-0 = "#202020"          # подложка окна"##), "{text}");
        assert!(text.contains("# Фоны."));
        assert!(text.starts_with("# Моя тема — пояснение в заголовке."));
    }

    #[test]
    fn new_key_goes_into_its_section() {
        let text = set_value(THEME, "palette", "accent", Some("#ff8800")).unwrap();
        let theme = parse(&text).unwrap();
        assert_eq!(theme.palette["accent"], "#ff8800");
    }

    /// Раздела нет — он появляется; порядок прочего не меняется.
    #[test]
    fn missing_section_is_created() {
        let text = set_value(THEME, "control", "tab-height", Some("40px")).unwrap();
        let theme = parse(&text).unwrap();
        assert_eq!(theme.control["tab-height"], "40px");
        assert!(text.find("[palette]").unwrap() < text.find("[control]").unwrap());
    }

    /// Убранный ключ возвращает умолчание, а комментарий над ним остаётся.
    #[test]
    fn removed_key_keeps_the_comment_above_it() {
        let text = set_value(THEME, "palette", "bg-0", None).unwrap();
        let theme = parse(&text).unwrap();

        assert!(!theme.palette.contains_key("bg-0"));
        assert!(text.contains("# Фоны."), "{text}");
    }

    #[test]
    fn unknown_token_is_refused() {
        let error = set_value(THEME, "color", "bg-нет-такого", Some("#000")).unwrap_err();
        assert!(matches!(error, ThemeError::UnknownToken { .. }), "{error:?}");
        assert!(set_value(THEME, "colour", "bg-canvas", Some("#000")).is_err());
    }

    /// Правка, после которой тема не собралась бы, не пишется: ссылка на
    /// цвет палитры, которого нет, сломала бы тему целиком.
    #[test]
    fn edit_that_would_break_the_theme_is_refused() {
        let error = set_value(THEME, "color", "bg-canvas", Some("{palette.нет-такого}")).unwrap_err();
        assert!(matches!(error, ThemeError::UnknownPaletteKey { .. }), "{error:?}");
    }

    #[test]
    fn empty_and_multiline_values_are_refused() {
        assert!(set_value(THEME, "palette", "bg-0", Some("   ")).is_err());
        assert!(set_value(THEME, "palette", "bg-0", Some("#fff\n[z]")).is_err());
        assert!(set_value(THEME, "palette", "Bg 0", Some("#fff")).is_err());
    }

    /// Каждый токен попадает в свой раздел — иначе в окне его не было бы.
    #[test]
    fn every_token_has_a_section() {
        for name in tokens::all_names() {
            assert!(section_of(name).is_some(), "токен без раздела: {name}");
        }
    }

    #[test]
    fn state_of_own_theme_marks_own_values() {
        let dir = temp_dir("own");
        std::fs::write(dir.join("моя.toml"), THEME).unwrap();

        let state = editor_state(&dir, "моя", Density::Normal).unwrap();

        assert!(!state.builtin);
        assert!(state.path.is_some());
        let bg0 = state.palette.iter().find(|entry| entry.key == "bg-0").unwrap();
        assert!(bg0.own);
        assert_eq!(bg0.value, "#101010");
        // Не заданное в файле пришло из встроенной тёмной.
        let accent = state.palette.iter().find(|entry| entry.key == "accent").unwrap();
        assert!(!accent.own);
        // Подложка блока выведена, а не задана.
        let block = state.palette.iter().find(|entry| entry.key == "bg-block").unwrap();
        assert!(block.derived);

        let radius = state.tokens.iter().find(|entry| entry.name == "radius-sm").unwrap();
        assert_eq!(radius.own.as_deref(), Some("2px"));
        assert_eq!(radius.default, "4px");
        assert_eq!(radius.resolved, "2px");
        let canvas = state.tokens.iter().find(|entry| entry.name == "color-bg-canvas").unwrap();
        assert_eq!(canvas.default, "{palette.bg-0}");
        assert_eq!(canvas.resolved, "#101010");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Палитра идёт порядком файла встроенной темы, а не по алфавиту.
    #[test]
    fn palette_follows_the_builtin_order() {
        let state = editor_state(Path::new("папки-нет"), "dark", Density::Normal).unwrap();

        assert!(state.builtin);
        assert!(state.findings.is_empty(), "{:?}", state.findings);
        let keys: Vec<&str> = state.palette.iter().map(|entry| entry.key.as_str()).collect();
        assert_eq!(&keys[..3], &["bg-0", "bg-1", "bg-2"]);
        assert!(keys.iter().position(|k| *k == "fg-0") < keys.iter().position(|k| *k == "accent"));
    }

    #[test]
    fn unreadable_theme_has_findings() {
        let dir = temp_dir("grey");
        let grey = THEME.replace(r##"fg-0 = "#eeeeee""##, r##"fg-0 = "#1a1a1a""##);
        std::fs::write(dir.join("моя.toml"), grey).unwrap();

        let state = editor_state(&dir, "моя", Density::Normal).unwrap();
        assert!(
            state.findings.iter().any(|f| f.token == "color-fg-default"),
            "{:?}",
            state.findings
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
