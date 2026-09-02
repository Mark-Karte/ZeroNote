//! Односторонний переходник к хранилищу Obsidian (Р-022, пункт 2).
//!
//! Узкий по устройству: опознать хранилище и перенести в **наш**
//! `zeronote.toml` те настройки, которые у нас на что-то влияют. Обратно
//! ничего не синхронизируется; результат пользователь правит руками.
//!
//! **`.obsidian` только читается** — инвариант 2, без исключений. Здесь нет
//! ни одной функции записи, и появиться она тут не должна.
//!
//! Переносится сегодня одно: фильтры исключения (`userIgnoreFilters`). Всё
//! прочее в `app.json` описывает то, чего у ZeroNote нет, — вставку вложений,
//! создание ссылок, режим просмотра. Переносить их «на будущее» значило бы
//! завести в нашем формате ключи, которые ничего не делают (Р-071).

use std::path::{Path, PathBuf};

/// Имя папки настроек Obsidian.
pub const CONFIG_DIR: &str = ".obsidian";

/// Похожа ли папка на хранилище Obsidian.
///
/// Только по наличию папки настроек. Заглядывать в неё ради опознания незачем:
/// пустое хранилище — обычное дело, у него `app.json` содержит `{}`.
pub fn detect(root: &Path) -> bool {
    root.join(CONFIG_DIR).is_dir()
}

/// Что переходник готов перенести.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Import {
    /// Правила игнорирования в нашей семантике, готовые к записи.
    pub rules: Vec<String>,
    /// Фильтры, которые перенести нельзя, — как они записаны в Obsidian.
    ///
    /// Не выбрасываем молча: пользователь настраивал их руками и должен
    /// узнать, что часть настройки не переехала.
    pub skipped: Vec<String>,
}

fn config_path(root: &Path) -> PathBuf {
    root.join(CONFIG_DIR).join("app.json")
}

/// Экранировать то, что в правиле игнорирования значит не себя.
///
/// Фильтр Obsidian — это буквальный путь, а не шаблон. Звёздочка в имени
/// папки должна остаться звёздочкой, а не стать «любыми знаками».
fn escape(literal: &str) -> String {
    let mut out = String::with_capacity(literal.len() + 4);

    for (i, ch) in literal.chars().enumerate() {
        // Восклицательный знак в начале означает отрицание, решётка —
        // комментарий. В середине строки они безобидны.
        let special_at_start = i == 0 && (ch == '!' || ch == '#');
        if special_at_start || matches!(ch, '\\' | '*' | '?' | '[' | ']') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Превратить фильтр Obsidian в правило нашего формата.
///
/// `None` — перенести нельзя. Такое бывает у фильтров-регулярных выражений:
/// они записываются в косых чертах, и в семантике `.gitignore` их не выразить.
fn convert(filter: &str) -> Option<String> {
    let filter = filter.trim();
    if filter.is_empty() {
        return None;
    }

    // Регулярное выражение: `/что-нибудь/`. Одной косой чертой в начале
    // Obsidian путь не записывает, так что спутать не с чем.
    if filter.len() >= 2 && filter.starts_with('/') && filter.ends_with('/') {
        return None;
    }

    // Путь от корня хранилища. Ведущая косая делает правило привязанным
    // к корню — иначе `заметки` скрыло бы любую папку с таким именем
    // на любой глубине, а Obsidian имел в виду одну конкретную.
    let path = filter.trim_matches('/');
    if path.is_empty() {
        return None;
    }

    Some(format!("/{}", escape(path)))
}

/// Прочитать фильтры исключения из `app.json`.
///
/// Отсутствие файла, пустой `{}` и отсутствие ключа — это одно и то же:
/// переносить нечего. Так выглядит хранилище, в котором настройки не трогали,
/// и это самый частый случай.
pub fn read_import(root: &Path) -> Import {
    let mut import = Import::default();

    let Ok(text) = std::fs::read_to_string(config_path(root)) else {
        return import;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        // Испорченный чужой файл — не наша беда и не повод шуметь:
        // переносить просто нечего.
        return import;
    };

    let Some(filters) = json.get("userIgnoreFilters").and_then(|v| v.as_array()) else {
        return import;
    };

    for filter in filters {
        let Some(filter) = filter.as_str() else {
            continue;
        };
        match convert(filter) {
            Some(rule) => {
                if !import.rules.contains(&rule) {
                    import.rules.push(rule);
                }
            }
            None => import.skipped.push(filter.to_owned()),
        }
    }

    import
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-obsidian-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn vault(tag: &str, app_json: &str) -> PathBuf {
        let dir = temp_dir(tag);
        std::fs::create_dir_all(dir.join(CONFIG_DIR)).unwrap();
        std::fs::write(dir.join(CONFIG_DIR).join("app.json"), app_json).unwrap();
        dir
    }

    #[test]
    fn detects_a_vault() {
        let dir = vault("detect", "{}");
        assert!(detect(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn plain_folder_is_not_a_vault() {
        let dir = temp_dir("plain");
        assert!(!detect(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Хранилище с нетронутыми настройками — самый частый случай.
    /// Переносить нечего, и это не ошибка.
    #[test]
    fn untouched_vault_has_nothing_to_import() {
        let dir = vault("empty", "{}");

        assert_eq!(read_import(&dir), Import::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn converts_path_filters() {
        let dir = vault(
            "paths",
            r#"{"userIgnoreFilters": ["Архив", "Работа/Черновики"]}"#,
        );

        let import = read_import(&dir);

        assert_eq!(import.rules, vec!["/Архив", "/Работа/Черновики"]);
        assert!(import.skipped.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Регулярное выражение в семантике `.gitignore` не выразить. Молчать
    /// об этом нельзя: пользователь настраивал фильтр руками.
    #[test]
    fn regex_filters_are_reported_not_dropped() {
        let dir = vault(
            "regex",
            r#"{"userIgnoreFilters": ["Архив", "/^черновик-\\d+/"]}"#,
        );

        let import = read_import(&dir);

        assert_eq!(import.rules, vec!["/Архив"]);
        assert_eq!(import.skipped, vec![r"/^черновик-\d+/"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Фильтр — буквальный путь, а не шаблон: звёздочка в имени папки
    /// должна остаться звёздочкой.
    #[test]
    fn special_characters_are_escaped() {
        let dir = vault("escape", r#"{"userIgnoreFilters": ["Папка [важное]", "*звёзды*"]}"#);

        let import = read_import(&dir);

        assert_eq!(import.rules, vec![r"/Папка \[важное\]", r"/\*звёзды\*"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Правило привязывается к корню: Obsidian имел в виду одну конкретную
    /// папку, а не любую с таким именем на любой глубине.
    #[test]
    fn rules_are_anchored_at_the_root() {
        let dir = vault("anchor", r#"{"userIgnoreFilters": ["заметки"]}"#);

        assert_eq!(read_import(&dir).rules, vec!["/заметки"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Испорченный чужой файл не должен ломать добавление папки.
    #[test]
    fn broken_config_is_not_fatal() {
        let dir = vault("broken", "это не json");

        assert_eq!(read_import(&dir), Import::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Папки настроек может не быть вовсе — обычная папка с заметками.
    #[test]
    fn missing_config_is_not_fatal() {
        let dir = temp_dir("noconfig");

        assert_eq!(read_import(&dir), Import::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_filters_collapse() {
        let dir = vault("dup", r#"{"userIgnoreFilters": ["Архив", "Архив/", "/Архив"]}"#);

        assert_eq!(read_import(&dir).rules, vec!["/Архив"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
