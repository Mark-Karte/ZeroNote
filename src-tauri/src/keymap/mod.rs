//! Горячие клавиши: список команд, раскладка Notepad++ по умолчанию
//! и переназначение через `data/keymap.toml`.
//!
//! Раскладка Notepad++ — требование совместимости, а не вкусовщина: люди
//! приходят с многолетней мышечной памятью, и ломать её нельзя.
//!
//! Сочетание записывается строкой вида `ctrl+shift+d`. Порядок частей и
//! регистр в файле пользователя произвольны — при разборе всё приводится
//! к одному виду, иначе `Shift+Ctrl+D` и `ctrl+shift+d` считались бы
//! разными сочетаниями и молча перекрывали бы друг друга.

use std::collections::BTreeMap;

/// Все команды, которым можно назначить сочетание.
///
/// Список канонический: имена отсюда обязаны совпадать с реестром обработчиков
/// во фронтенде, это проверяет тест `tests/keymap.test.ts`. Опечатка в файле
/// пользователя тоже сверяется с этим списком и называется по имени.
pub const COMMANDS: &[(&str, &str)] = &[
    ("file.new", "Создать файл"),
    ("file.open", "Открыть файл"),
    ("file.save", "Сохранить"),
    ("file.save-as", "Сохранить как"),
    ("file.save-all", "Сохранить всё"),
    ("file.close-tab", "Закрыть вкладку"),
    ("edit.undo", "Отменить"),
    ("edit.redo", "Повторить"),
    ("edit.select-all", "Выделить всё"),
    ("edit.duplicate-line", "Продублировать строку"),
    ("edit.delete-line", "Удалить строку"),
    ("edit.move-line-up", "Переместить строку вверх"),
    ("edit.move-line-down", "Переместить строку вниз"),
    ("edit.upper-case", "В верхний регистр"),
    ("edit.lower-case", "В нижний регистр"),
    ("search.find", "Найти"),
    ("search.replace", "Заменить"),
    ("search.find-next", "Найти далее"),
    ("search.find-previous", "Найти ранее"),
    ("view.go-to-line", "Перейти к строке"),
    ("view.next-tab", "Следующая вкладка"),
    ("view.previous-tab", "Предыдущая вкладка"),
    ("view.sidebar", "Показать боковую панель"),
    ("project.add-root", "Открыть папку"),
    ("project.quick-open", "Быстрое открытие по имени"),
    ("project.commands", "Палитра команд"),
    ("project.tags", "Палитра тегов"),
    ("project.search", "Найти в проекте"),
    ("project.follow-link", "Перейти по ссылке под курсором"),
    ("project.backlinks", "Обратные ссылки"),
];

/// Раскладка по умолчанию — Notepad++ 8.x.
///
/// Сверено с меню Notepad++ для тех команд, которые реализованы. То, чего
/// у нас пока нет (поиск, макросы, свёртка), в таблице отсутствует, и
/// соответствующие сочетания просто не заняты.
pub const DEFAULTS: &[(&str, &str)] = &[
    ("ctrl+n", "file.new"),
    ("ctrl+o", "file.open"),
    ("ctrl+s", "file.save"),
    ("ctrl+alt+s", "file.save-as"),
    ("ctrl+shift+s", "file.save-all"),
    ("ctrl+w", "file.close-tab"),
    ("ctrl+z", "edit.undo"),
    ("ctrl+y", "edit.redo"),
    ("ctrl+a", "edit.select-all"),
    ("ctrl+d", "edit.duplicate-line"),
    ("ctrl+l", "edit.delete-line"),
    ("ctrl+shift+up", "edit.move-line-up"),
    ("ctrl+shift+down", "edit.move-line-down"),
    ("ctrl+shift+u", "edit.upper-case"),
    ("ctrl+u", "edit.lower-case"),
    ("ctrl+f", "search.find"),
    ("ctrl+h", "search.replace"),
    ("f3", "search.find-next"),
    ("shift+f3", "search.find-previous"),
    ("ctrl+g", "view.go-to-line"),
    ("ctrl+tab", "view.next-tab"),
    ("ctrl+shift+tab", "view.previous-tab"),
    // Двух сочетаний из Notepad++ здесь нет и быть не может: папки как проекта
    // в нём тоже нет. Взяты привычные по VS Code — решение Р-053.
    ("ctrl+b", "view.sidebar"),
    ("ctrl+shift+o", "project.add-root"),
    // Ctrl+P в Notepad++ — печать, которой у нас нет и в первом круге
    // не будет. Ctrl+Shift+F там же — «найти в файлах», то есть ровно
    // тот же смысл, что и у нас.
    ("ctrl+p", "project.quick-open"),
    ("ctrl+shift+p", "project.commands"),
    ("ctrl+shift+f", "project.search"),
    // F12 — «перейти к определению» в привычке любого, кто пользовался
    // средой разработки. Ссылка между заметками — то же самое движение.
    ("f12", "project.follow-link"),
    ("ctrl+shift+b", "project.backlinks"),
];

/// Именованные клавиши, которые разрешено использовать в сочетаниях.
///
/// Буквы и цифры сюда не входят: они распознаются отдельно и всегда состоят
/// из одного знака.
const NAMED_KEYS: &[&str] = &[
    "enter", "tab", "escape", "space", "backspace", "delete", "insert", "home", "end", "pageup",
    "pagedown", "left", "right", "up", "down", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8",
    "f9", "f10", "f11", "f12",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeymapError {
    Parse(String),
    UnsupportedSchema { found: u32 },
    UnknownCommand { binding: String, command: String },
    BadBinding { binding: String },
}

impl std::fmt::Display for KeymapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeymapError::Parse(message) => {
                write!(f, "не удалось разобрать keymap.toml: {message}")
            }
            KeymapError::UnsupportedSchema { found } => write!(
                f,
                "версия формата раскладки {found} не поддерживается, ожидается {KEYMAP_SCHEMA}"
            ),
            KeymapError::UnknownCommand { binding, command } => write!(
                f,
                "сочетание {binding}: неизвестная команда «{command}»"
            ),
            KeymapError::BadBinding { binding } => {
                write!(f, "не удалось разобрать сочетание «{binding}»")
            }
        }
    }
}

impl std::error::Error for KeymapError {}

pub const KEYMAP_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeymapFile {
    pub schema: u32,
    /// Сочетание → команда. Пустая строка снимает сочетание, назначенное
    /// по умолчанию: без этого от ненужной привязки нельзя было бы избавиться.
    #[serde(default)]
    pub bindings: BTreeMap<String, String>,
}

/// Привести сочетание к единому виду: `ctrl+alt+shift+клавиша`.
///
/// Возвращает `None`, если разобрать не удалось. Порядок частей в исходной
/// строке значения не имеет, регистр тоже.
pub fn normalize(binding: &str) -> Option<String> {
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut key: Option<String> = None;

    for part in binding.split('+') {
        let part = part.trim().to_lowercase();
        if part.is_empty() {
            return None;
        }

        match part.as_str() {
            "ctrl" | "control" => ctrl = true,
            "alt" => alt = true,
            "shift" => shift = true,
            other => {
                // Двух клавиш в одном сочетании не бывает: скорее всего опечатка.
                if key.is_some() {
                    return None;
                }
                let named = NAMED_KEYS.contains(&other);
                let single = other.chars().count() == 1
                    && other.chars().all(|c| c.is_ascii_alphanumeric());

                if !named && !single {
                    return None;
                }
                key = Some(other.to_owned());
            }
        }
    }

    let key = key?;

    let mut out = String::new();
    if ctrl {
        out.push_str("ctrl+");
    }
    if alt {
        out.push_str("alt+");
    }
    if shift {
        out.push_str("shift+");
    }
    out.push_str(&key);
    Some(out)
}

fn known_commands() -> Vec<&'static str> {
    COMMANDS.iter().map(|(id, _)| *id).collect()
}

pub fn parse(source: &str) -> Result<KeymapFile, KeymapError> {
    let file: KeymapFile =
        toml::from_str(source).map_err(|e| KeymapError::Parse(e.message().to_owned()))?;

    if file.schema != KEYMAP_SCHEMA {
        return Err(KeymapError::UnsupportedSchema {
            found: file.schema,
        });
    }

    Ok(file)
}

/// Итоговая раскладка: умолчания плюс правки пользователя.
pub fn resolve(user: Option<&KeymapFile>) -> Result<BTreeMap<String, String>, KeymapError> {
    let known = known_commands();
    let mut result: BTreeMap<String, String> = BTreeMap::new();

    for (binding, command) in DEFAULTS {
        let normalized = normalize(binding).expect("умолчания обязаны разбираться");
        result.insert(normalized, (*command).to_owned());
    }

    let Some(user) = user else {
        return Ok(result);
    };

    for (binding, command) in &user.bindings {
        let Some(normalized) = normalize(binding) else {
            return Err(KeymapError::BadBinding {
                binding: binding.clone(),
            });
        };

        // Пустая команда снимает сочетание.
        if command.is_empty() {
            result.remove(&normalized);
            continue;
        }

        if !known.contains(&command.as_str()) {
            return Err(KeymapError::UnknownCommand {
                binding: normalized,
                command: command.clone(),
            });
        }

        result.insert(normalized, command.clone());
    }

    Ok(result)
}

/// Образец файла раскладки, который кладётся при первом запуске.
///
/// Записывается дословно вместе с комментариями: сериализация через serde
/// их не переживает, а для файла, который правят руками, они и есть польза.
pub const DEFAULT_TEMPLATE: &str = r#"# Горячие клавиши ZeroNote.
#
# По умолчанию действует раскладка Notepad++. Здесь задаются только отличия:
# всё, что не упомянуто, остаётся как было. Приложение подхватывает изменения
# на лету, перезапуск не нужен.
#
# Формат: "сочетание" = "команда"
# Порядок частей и регистр не важны: "Shift+Ctrl+D" и "ctrl+shift+d" — одно
# и то же. Пустая команда снимает сочетание.
#
# Пример:
#   [bindings]
#   "ctrl+shift+d" = "edit.duplicate-line"   # добавить своё
#   "ctrl+l" = ""                            # снять стандартное
#
# Список команд — в DESIGN.md, раздел «Горячие клавиши».

schema = 1

[bindings]
"#;

#[cfg(test)]
mod tests {
    use super::*;

    /// Умолчания обязаны разбираться и ссылаться на существующие команды:
    /// иначе приложение стартует с нерабочей раскладкой.
    #[test]
    fn defaults_are_valid() {
        let known = known_commands();
        for (binding, command) in DEFAULTS {
            assert!(
                normalize(binding).is_some(),
                "не разбирается сочетание по умолчанию: {binding}"
            );
            assert!(
                known.contains(command),
                "умолчание ссылается на несуществующую команду: {command}"
            );
        }
    }

    /// Одно сочетание не должно быть занято дважды: вторая привязка молча
    /// перекрыла бы первую.
    #[test]
    fn defaults_do_not_collide() {
        let mut seen = std::collections::BTreeSet::new();
        for (binding, _) in DEFAULTS {
            let normalized = normalize(binding).unwrap();
            assert!(seen.insert(normalized.clone()), "занято дважды: {normalized}");
        }
    }

    /// Порядок частей и регистр не должны создавать разные сочетания.
    #[test]
    fn normalization_ignores_order_and_case() {
        let expected = Some("ctrl+alt+shift+d".to_owned());
        assert_eq!(normalize("ctrl+alt+shift+d"), expected);
        assert_eq!(normalize("Shift+Alt+Ctrl+D"), expected);
        assert_eq!(normalize("  CTRL + SHIFT + ALT + D  "), expected);
        assert_eq!(normalize("Control+Alt+Shift+d"), expected);
    }

    #[test]
    fn named_keys_are_accepted() {
        assert_eq!(normalize("ctrl+g"), Some("ctrl+g".to_owned()));
        assert_eq!(normalize("F5"), Some("f5".to_owned()));
        assert_eq!(
            normalize("ctrl+shift+Up"),
            Some("ctrl+shift+up".to_owned())
        );
        assert_eq!(normalize("alt+PageDown"), Some("alt+pagedown".to_owned()));
    }

    /// Мусор должен отвергаться, а не превращаться в сочетание, которое
    /// никогда не сработает.
    #[test]
    fn garbage_is_rejected() {
        assert_eq!(normalize(""), None);
        assert_eq!(normalize("ctrl+"), None);
        assert_eq!(normalize("ctrl"), None, "одни модификаторы — не сочетание");
        assert_eq!(normalize("ctrl+ддд"), None);
        assert_eq!(normalize("ctrl+a+b"), None, "двух клавиш не бывает");
    }

    #[test]
    fn user_binding_overrides_default() {
        let file = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+d" = "edit.delete-line"
        "#,
        )
        .unwrap();

        let map = resolve(Some(&file)).unwrap();
        assert_eq!(map["ctrl+d"], "edit.delete-line");
        // Остальное не тронуто.
        assert_eq!(map["ctrl+s"], "file.save");
    }

    /// Снять стандартное сочетание должно быть можно: иначе от мешающей
    /// привязки не избавиться.
    #[test]
    fn empty_command_unbinds() {
        let file = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+l" = ""
        "#,
        )
        .unwrap();

        let map = resolve(Some(&file)).unwrap();
        assert!(!map.contains_key("ctrl+l"));
    }

    /// Опечатка в имени команды называется по имени, а не игнорируется.
    #[test]
    fn unknown_command_is_reported() {
        let file = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+d" = "edit.duplicate-lines"
        "#,
        )
        .unwrap();

        let error = resolve(Some(&file)).expect_err("должна быть ошибка");
        let message = error.to_string();
        assert!(
            message.contains("edit.duplicate-lines"),
            "сообщение должно называть команду: {message}"
        );
    }

    #[test]
    fn bad_binding_is_reported() {
        let file = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+нет" = "file.save"
        "#,
        )
        .unwrap();

        assert!(matches!(
            resolve(Some(&file)),
            Err(KeymapError::BadBinding { .. })
        ));
    }

    /// Образец должен разбираться и не менять раскладку по умолчанию.
    #[test]
    fn template_parses_and_changes_nothing() {
        let file = parse(DEFAULT_TEMPLATE).expect("образец должен разбираться");
        assert_eq!(resolve(Some(&file)).unwrap(), resolve(None).unwrap());
    }

    #[test]
    fn future_schema_is_rejected() {
        assert_eq!(
            parse("schema = 77"),
            Err(KeymapError::UnsupportedSchema { found: 77 })
        );
    }
}
