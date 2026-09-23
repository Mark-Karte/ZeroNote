//! Коллауты: свой список вместо пяти зашитых ролей (задача 103).
//!
//! Файл `data/callouts.toml` — перечень коллаутов: тип, который пишется
//! в заметке (`> [!tip]`), подпись, которую вставка кладёт в файл рядом
//! с типом, значок и цвет. Образец при первом запуске — двадцать семь типов
//! Obsidian, чтобы из коробки было как там.
//!
//! Устроено так же, как настройки: файл — основной интерфейс, окно
//! параметров — надстройка над ним (Р-077); читаем терпимо, ошибаемся
//! громко (Р-248). Запись — `edit.rs`, через `toml_edit`, чтобы комментарии
//! пережили правку из окна.
//!
//! **Подпись пишется в файл, а не рисуется на экране.** Р-178 остаётся
//! в силе: превью не сочиняет слов, у коллаута без заголовка на экране
//! только значок. Подпись — это текст, который вставка кладёт в заметку
//! рядом с типом (`> [!tip] Совет`), и тогда его видят и Obsidian, и мы.

pub mod edit;

use std::path::Path;

/// Один коллаут.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Callout {
    /// Тип, как он пишется в заметке: `> [!tip]`. Нижний регистр: Obsidian
    /// сравнивает типы без учёта регистра, и мы тоже.
    pub id: String,
    /// Подпись, которую вставка пишет в файл после типа.
    pub title: String,
    /// Значок из реестра приложения по логическому имени. Проверяет его
    /// фронтенд — реестр значков живёт там; незнакомый рисуется значком
    /// заметки и называется в окне параметров.
    pub icon: String,
    /// Цвет: роль из палитры темы ([`COLOR_ROLES`]) или свой `#rrggbb`.
    pub color: String,
}

impl Default for Callout {
    fn default() -> Self {
        Callout {
            id: String::new(),
            title: String::new(),
            icon: DEFAULT_ICON.to_owned(),
            color: DEFAULT_COLOR.to_owned(),
        }
    }
}

pub const DEFAULT_ICON: &str = "md.callout-note";
pub const DEFAULT_COLOR: &str = "accent";

/// Цвета, которые знает тема. Роль, а не значение: у каждой темы свой
/// зелёный, и коллаут «успех» обязан быть зелёным в любой из них — и
/// читаемым, потому что эти цвета проверяет тест читаемости тем (Р-143).
/// Свой цвет `#rrggbb` тоже можно, но за его читаемость отвечает человек,
/// и окно параметров об этом скажет.
pub const COLOR_ROLES: &[&str] = &[
    "accent", "success", "warning", "danger", "muted", "keyword", "string", "number", "type",
    "function",
];

pub const CALLOUTS_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CalloutsError {
    Parse(String),
    UnsupportedSchema { found: u32 },
}

impl std::fmt::Display for CalloutsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CalloutsError::Parse(message) => {
                write!(f, "не удалось разобрать callouts.toml: {message}")
            }
            CalloutsError::UnsupportedSchema { found } => write!(
                f,
                "версия формата коллаутов {found} не поддерживается, ожидается {CALLOUTS_SCHEMA}"
            ),
        }
    }
}

impl std::error::Error for CalloutsError {}

/// Прочитанный список и то, что из файла применить не удалось.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Loaded {
    pub callouts: Vec<Callout>,
    /// По строке на каждое непринятое. Без имени файла — его добавляет тот,
    /// кто показывает (как у настроек).
    pub problems: Vec<String>,
}

/// Годится ли строка типом коллаута.
///
/// Тип стоит в квадратных скобках (`[!тип]`) и кончается на пробеле или `]`,
/// так его читает и Obsidian, и наш разбор (`parseCallout`). Всё остальное
/// можно: кириллица, цифры, дефис.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && !id.chars().any(|c| c.is_whitespace() || c == ']' || c == '[')
}

/// Годится ли строка цветом: роль темы или `#rgb` / `#rrggbb`.
pub fn valid_color(color: &str) -> bool {
    if COLOR_ROLES.contains(&color) {
        return true;
    }
    match color.strip_prefix('#') {
        Some(hex) => (hex.len() == 3 || hex.len() == 6) && hex.chars().all(|c| c.is_ascii_hexdigit()),
        None => false,
    }
}

/// Разбор файла коллаутов.
///
/// Как у настроек (Р-248): ошибка — только если файл нельзя прочитать вовсе;
/// всё остальное называется, а негодная запись пропускается или получает
/// умолчание на месте негодного поля.
pub fn parse(source: &str) -> Result<Loaded, CalloutsError> {
    let mut root: toml::Table =
        toml::from_str(source).map_err(|e| CalloutsError::Parse(e.message().to_owned()))?;

    let schema = match root.remove("schema") {
        None => CALLOUTS_SCHEMA,
        Some(toml::Value::Integer(n)) => u32::try_from(n)
            .map_err(|_| CalloutsError::Parse(format!("schema = {n} — версия формата не бывает такой")))?,
        Some(other) => {
            return Err(CalloutsError::Parse(format!(
                "schema должна быть числом, а в файле {}",
                other.type_str()
            )));
        }
    };
    if schema != CALLOUTS_SCHEMA {
        return Err(CalloutsError::UnsupportedSchema { found: schema });
    }

    let mut problems = Vec::new();
    let mut callouts: Vec<Callout> = Vec::new();

    match root.remove("callout") {
        None => {}
        Some(toml::Value::Array(entries)) => {
            for (index, entry) in entries.into_iter().enumerate() {
                let number = index + 1;
                let toml::Value::Table(table) = entry else {
                    problems.push(format!("запись {number} — не таблица, пропущена"));
                    continue;
                };

                let label = match table.get("id").and_then(|id| id.as_str()) {
                    Some(id) => format!("callout «{id}»"),
                    None => format!("callout {number}"),
                };
                let mut callout: Callout =
                    crate::settings::section(table, &label, &mut problems);

                callout.id = callout.id.trim().to_lowercase();
                if !valid_id(&callout.id) {
                    problems.push(format!(
                        "[{label}] тип пуст или содержит пробел и скобки — запись пропущена"
                    ));
                    continue;
                }
                if callouts.iter().any(|known| known.id == callout.id) {
                    problems.push(format!(
                        "[{label}] такой тип уже есть выше — запись пропущена"
                    ));
                    continue;
                }
                if !valid_color(&callout.color) {
                    problems.push(format!(
                        "[{label}] color = «{}» — это не роль темы и не #rrggbb; взят акцент",
                        callout.color
                    ));
                    callout.color = DEFAULT_COLOR.to_owned();
                }
                if callout.icon.trim().is_empty() {
                    callout.icon = DEFAULT_ICON.to_owned();
                }
                callouts.push(callout);
            }
        }
        Some(other) => problems.push(format!(
            "callout должен быть списком записей [[callout]], а в файле {}",
            other.type_str()
        )),
    }

    for key in root.keys() {
        problems.push(format!("ключ «{key}» незнаком — пропущен"));
    }

    Ok(Loaded { callouts, problems })
}

/// Чтение с диска. Файла нет — образец: список коллаутов не бывает пустым
/// оттого, что файл удалили, — удалённый файл вернётся при следующем запуске.
pub fn load_full(path: &Path) -> Result<Loaded, CalloutsError> {
    match std::fs::read_to_string(path) {
        Ok(source) => parse(&source),
        Err(_) => parse(DEFAULT_TEMPLATE),
    }
}

/// Создать файл коллаутов, если его ещё нет. Существующий не трогаем никогда.
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

/// Образец: типы Obsidian с русскими подписями, как в плагине владельца.
///
/// Цвета — роли темы, подобранные под цвета Obsidian: синий — акцент,
/// голубой — цвет функций, зелёный — успех, жёлтый — внимание, красный —
/// опасность, фиолетовый — цвет ключевых слов, серый — приглушённый.
pub const DEFAULT_TEMPLATE: &str = r##"# Коллауты ZeroNote.
#
# Коллаут — цитата, первая строка которой написана так: > [!тип] Подпись.
# Obsidian рисует её карточкой, ZeroNote тоже. Здесь — какие типы бывают,
# какой у каждого значок и цвет и какую подпись кладёт в заметку вставка.
# Удобнее править во вкладке «Коллауты» окна параметров, но и здесь всё видно.
#
#   id    — тип, как он пишется в заметке: [!tip]. Без пробелов и скобок.
#   title — подпись, которую вставка пишет после типа. Это текст заметки:
#           его увидит и Obsidian.
#   icon  — значок: имя из списка во вкладке «Коллауты».
#   color — цвет: роль темы — "accent", "success", "warning", "danger",
#           "muted", "keyword", "string", "number", "type", "function" —
#           или свой "#rrggbb". Роль меняется вместе с темой и всегда
#           читается; за свой цвет отвечаете вы.
#
# Тип, которого здесь нет, рисуется как "note".

schema = 1

[[callout]]
id = "note"
title = "Заметка"
icon = "md.callout-pencil"
color = "accent"

[[callout]]
id = "info"
title = "Информация"
icon = "md.callout-note"
color = "accent"

[[callout]]
id = "todo"
title = "Задача"
icon = "md.callout-todo"
color = "accent"

[[callout]]
id = "abstract"
title = "Аннотация"
icon = "md.callout-clipboard"
color = "function"

[[callout]]
id = "summary"
title = "Сводка"
icon = "md.callout-clipboard"
color = "function"

[[callout]]
id = "tldr"
title = "Кратко"
icon = "md.callout-clipboard"
color = "function"

[[callout]]
id = "tip"
title = "Совет"
icon = "md.callout-flame"
color = "function"

[[callout]]
id = "hint"
title = "Подсказка"
icon = "md.callout-flame"
color = "function"

[[callout]]
id = "important"
title = "Важно"
icon = "md.callout-flame"
color = "function"

[[callout]]
id = "success"
title = "Успех"
icon = "action.check"
color = "success"

[[callout]]
id = "check"
title = "Проверено"
icon = "action.check"
color = "success"

[[callout]]
id = "done"
title = "Готово"
icon = "action.check"
color = "success"

[[callout]]
id = "question"
title = "Вопрос"
icon = "md.callout-question"
color = "warning"

[[callout]]
id = "help"
title = "Помощь"
icon = "md.callout-question"
color = "warning"

[[callout]]
id = "faq"
title = "ЧаВо"
icon = "md.callout-question"
color = "warning"

[[callout]]
id = "warning"
title = "Предупреждение"
icon = "md.callout-warning"
color = "warning"

[[callout]]
id = "caution"
title = "Осторожно"
icon = "md.callout-warning"
color = "warning"

[[callout]]
id = "attention"
title = "Внимание"
icon = "md.callout-warning"
color = "warning"

[[callout]]
id = "failure"
title = "Неудача"
icon = "md.callout-fail"
color = "danger"

[[callout]]
id = "fail"
title = "Провал"
icon = "md.callout-fail"
color = "danger"

[[callout]]
id = "missing"
title = "Отсутствует"
icon = "md.callout-fail"
color = "danger"

[[callout]]
id = "danger"
title = "Опасность"
icon = "md.callout-danger"
color = "danger"

[[callout]]
id = "error"
title = "Ошибка"
icon = "md.callout-danger"
color = "danger"

[[callout]]
id = "bug"
title = "Баг"
icon = "md.callout-bug"
color = "danger"

[[callout]]
id = "example"
title = "Пример"
icon = "md.bullet-list"
color = "keyword"

[[callout]]
id = "quote"
title = "Цитата"
icon = "md.callout-quote"
color = "muted"

[[callout]]
id = "cite"
title = "Источник"
icon = "md.callout-quote"
color = "muted"
"##;

#[cfg(test)]
mod tests {
    use super::*;

    fn read(source: &str) -> Loaded {
        parse(source).expect("файл должен читаться")
    }

    fn named(problems: &[String], words: &[&str]) -> bool {
        problems
            .iter()
            .any(|problem| words.iter().all(|word| problem.contains(word)))
    }

    /// Образец читается целиком и без единой жалобы: иначе новенький увидел
    /// бы строку в полосе предупреждений о файле, которого не трогал.
    #[test]
    fn template_reads_without_problems() {
        let loaded = read(DEFAULT_TEMPLATE);
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
        assert_eq!(loaded.callouts.len(), 27);
        assert!(loaded.callouts.iter().any(|c| c.id == "note"));
    }

    /// Все цвета образца — роли темы: образец обязан читаться в любой теме.
    #[test]
    fn template_uses_theme_roles_only() {
        for callout in read(DEFAULT_TEMPLATE).callouts {
            assert!(
                COLOR_ROLES.contains(&callout.color.as_str()),
                "{}: {}",
                callout.id,
                callout.color
            );
        }
    }

    #[test]
    fn type_is_read_in_lower_case() {
        let loaded = read("[[callout]]\nid = \"TIP\"\ntitle = \"Совет\"\n");
        assert_eq!(loaded.callouts[0].id, "tip");
    }

    #[test]
    fn own_hex_color_is_accepted() {
        let loaded = read("[[callout]]\nid = \"мой\"\ncolor = \"#ff8800\"\n");
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
        assert_eq!(loaded.callouts[0].color, "#ff8800");
    }

    /// Негодный цвет называется, а коллаут остаётся — с акцентом.
    #[test]
    fn bad_color_is_named_and_the_callout_stays() {
        let loaded = read("[[callout]]\nid = \"мой\"\ncolor = \"оранжевый\"\n");
        assert_eq!(loaded.callouts.len(), 1);
        assert_eq!(loaded.callouts[0].color, DEFAULT_COLOR);
        assert!(named(&loaded.problems, &["мой", "оранжевый"]));
    }

    /// Тип с пробелом в заметке не написать — такая запись пропускается.
    #[test]
    fn bad_type_is_named_and_skipped() {
        let loaded = read("[[callout]]\nid = \"два слова\"\n[[callout]]\nid = \"tip\"\n");
        assert_eq!(loaded.callouts.len(), 1);
        assert!(named(&loaded.problems, &["два слова"]));
    }

    /// Второй коллаут с тем же типом не рисовался бы никогда — его называют.
    #[test]
    fn duplicate_type_is_named() {
        let loaded = read("[[callout]]\nid = \"tip\"\n[[callout]]\nid = \"Tip\"\n");
        assert_eq!(loaded.callouts.len(), 1);
        assert!(named(&loaded.problems, &["уже есть"]));
    }

    /// Опечатка в ключе записи называется, как в настройках (Р-248).
    #[test]
    fn unknown_key_in_an_entry_is_named() {
        let loaded = read("[[callout]]\nid = \"tip\"\ncolour = \"success\"\n");
        assert_eq!(loaded.callouts.len(), 1);
        assert!(named(&loaded.problems, &["colour"]));
    }

    #[test]
    fn empty_file_means_no_callouts() {
        let loaded = read("schema = 1\n");
        assert!(loaded.callouts.is_empty());
        assert!(loaded.problems.is_empty());
    }

    #[test]
    fn future_schema_is_rejected() {
        assert_eq!(
            parse("schema = 9"),
            Err(CalloutsError::UnsupportedSchema { found: 9 })
        );
    }

    /// Пропавший файл — образец, а не пустой список.
    #[test]
    fn missing_file_means_the_template() {
        let path = std::env::temp_dir().join("zeronote-нет-коллаутов.toml");
        let loaded = load_full(&path).unwrap();
        assert_eq!(loaded.callouts.len(), 27);
    }
}
