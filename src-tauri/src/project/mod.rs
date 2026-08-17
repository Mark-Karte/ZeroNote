//! Файл проекта `zeronote.toml` — наш формат, не чужой (решение Р-022).
//!
//! Лежит в корне папки, правится руками, кладётся в git. Та же философия, что
//! у `settings.toml` и тем: читаем терпимо, ошибаемся громко.
//!
//! **Приложение не создаёт этот файл само** (решение Р-049). Пользователь мог
//! открыть чужую папку просто посмотреть, и насорить в ней файлом — прямое
//! нарушение инварианта 1. Без файла проекта корень работает на умолчаниях,
//! а файл появляется только по явной команде.

use std::path::{Path, PathBuf};

use crate::text::encoding::Encoding;

pub mod ignore;

/// Имя файла проекта. В одном месте, чтобы не разъехалось по коду.
pub const PROJECT_FILE: &str = "zeronote.toml";

pub const PROJECT_SCHEMA: u32 = 1;

fn default_schema() -> u32 {
    PROJECT_SCHEMA
}

/// Разобранный `zeronote.toml`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    #[serde(default = "default_schema")]
    pub schema: u32,
    #[serde(default)]
    pub project: Meta,
    #[serde(default)]
    pub ignore: IgnoreSettings,
    #[serde(default)]
    pub index: IndexSettings,
    #[serde(default)]
    pub editor: EditorSettings,
}

/// Раздел `[index]`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct IndexSettings {
    /// Файлы крупнее в индекс не попадают.
    ///
    /// Поиск по журналу на сто мегабайт не нужен никому, а времени и памяти
    /// он стоит заметно. Списка расширений при этом нет намеренно: его
    /// пришлось бы вечно дополнять, и он молча терял бы чужие текстовые
    /// форматы. Двоичные файлы отсеиваются по содержимому.
    pub max_file_size: u64,
}

impl Default for IndexSettings {
    fn default() -> Self {
        IndexSettings {
            max_file_size: 2 * 1024 * 1024,
        }
    }
}

/// Раздел `[project]`.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct Meta {
    /// Как называть корень в интерфейсе. Пусто — берётся имя папки.
    pub name: Option<String>,
}

/// Раздел `[ignore]`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct IgnoreSettings {
    /// Применять встроенный список: `.git`, `node_modules`, `target`, `dist`,
    /// `.obsidian`. Выключается, если он мешает.
    pub use_defaults: bool,
    /// Учитывать `.gitignore` проекта.
    pub use_gitignore: bool,
    /// Свои правила в семантике `.gitignore`. Применяются последними, поэтому
    /// строка вида `!node_modules/` возвращает то, что скрыли умолчания.
    pub rules: Vec<String>,
}

impl Default for IgnoreSettings {
    fn default() -> Self {
        IgnoreSettings {
            use_defaults: true,
            use_gitignore: true,
            rules: Vec::new(),
        }
    }
}

/// Раздел `[editor]` — настройки редактора на проект.
///
/// Пока в нём одна настройка, и это сознательно: ключ, который присутствует
/// в формате, но ни на что не влияет, — та самая заглушка, которой в проекте
/// быть не должно. Раздел заведён сейчас, потому что менять форму файла позже
/// дороже, чем дописать в него ключ.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct EditorSettings {
    /// Чем считать файл, кодировку которого не удалось определить надёжно.
    ///
    /// Нужна там, где вся папка в одной однобайтовой кодировке: эвристика
    /// на коротком файле ошибается, а проект знает ответ. На файлы с меткой
    /// порядка байтов и на годный UTF-8 не влияет — там гадать не о чем.
    pub default_encoding: Option<Encoding>,
}

impl Default for Project {
    fn default() -> Self {
        Project {
            schema: PROJECT_SCHEMA,
            project: Meta::default(),
            ignore: IgnoreSettings::default(),
            index: IndexSettings::default(),
            editor: EditorSettings::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectError {
    Parse(String),
    UnsupportedSchema { found: u32 },
}

impl std::fmt::Display for ProjectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectError::Parse(message) => {
                write!(f, "не удалось разобрать {PROJECT_FILE}: {message}")
            }
            ProjectError::UnsupportedSchema { found } => write!(
                f,
                "версия формата проекта {found} не поддерживается, ожидается {PROJECT_SCHEMA}"
            ),
        }
    }
}

impl std::error::Error for ProjectError {}

pub fn parse(source: &str) -> Result<Project, ProjectError> {
    let project: Project =
        toml::from_str(source).map_err(|e| ProjectError::Parse(e.message().to_owned()))?;

    if project.schema != PROJECT_SCHEMA {
        return Err(ProjectError::UnsupportedSchema {
            found: project.schema,
        });
    }

    Ok(project)
}

pub fn project_path(root: &Path) -> PathBuf {
    root.join(PROJECT_FILE)
}

/// Что получилось прочитать в корне.
///
/// Отсутствие файла и испорченный файл — разные вещи, и различать их обязан
/// вызывающий код: в первом случае корень работает на умолчаниях молча,
/// во втором пользователь должен увидеть, что именно он сломал.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Loaded {
    pub project: Project,
    /// Файл проекта существует.
    pub present: bool,
    /// Файл есть, но разобрать его не удалось. Действуют умолчания.
    pub problem: Option<String>,
}

pub fn load(root: &Path) -> Loaded {
    let path = project_path(root);

    let Ok(source) = std::fs::read_to_string(&path) else {
        return Loaded {
            project: Project::default(),
            present: false,
            problem: None,
        };
    };

    match parse(&source) {
        Ok(project) => Loaded {
            project,
            present: true,
            problem: None,
        },
        // Сломанный файл не должен ломать работу с папкой: она открывается
        // на умолчаниях, а ошибка едет пользователю полосой предупреждений.
        Err(e) => Loaded {
            project: Project::default(),
            present: true,
            problem: Some(format!("{}: {e}", path.display())),
        },
    }
}

/// Образец файла проекта.
///
/// Пишется дословно вместе с комментариями: сериализация через serde их
/// не переживает, а для файла, который правят руками, они и есть половина
/// пользы. Значения в образце совпадают с умолчаниями — это проверяет тест.
pub const DEFAULT_TEMPLATE: &str = r#"# Проект ZeroNote.
#
# Файл описывает папку как проект: что скрывать из дерева и поиска, чем
# считать файлы с неочевидной кодировкой. Правится руками, кладётся в git.
#
# Закомментированные ключи показывают значения по умолчанию.

schema = 1

[project]
# Как называть папку в боковой панели. Если ключа нет — имя самой папки.
# name = "Мои заметки"

[ignore]
# Встроенный список: .git, node_modules, target, dist, .obsidian
use_defaults = true

# Учитывать .gitignore проекта.
use_gitignore = true

# Свои правила в семантике .gitignore. Применяются последними, поэтому
# строка с восклицательным знаком возвращает то, что скрыли умолчания.
#
#   rules = ["*.tmp", "черновики/", "!node_modules/"]
rules = []

[index]
# Файлы крупнее в поиск по проекту не попадают. Двоичные отсеиваются
# по содержимому, списка расширений нет.
max_file_size = 2097152

[editor]
# Чем считать файл, кодировку которого не удалось определить надёжно.
# Полезно, когда вся папка в одной однобайтовой кодировке.
# На файлы с меткой порядка байтов и на годный UTF-8 не влияет.
#
#   default_encoding = "windows1251"
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-project-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Образец обязан разбираться и давать ровно умолчания: иначе комментарии
    /// в файле и поведение кода разъедутся незаметно.
    #[test]
    fn template_matches_defaults() {
        let parsed = parse(DEFAULT_TEMPLATE).expect("образец должен разбираться");
        assert_eq!(parsed, Project::default());
    }

    /// Частичный файл дополняется умолчаниями, а не обнуляет остальное.
    #[test]
    fn partial_file_is_filled_with_defaults() {
        let parsed = parse(
            r#"
            schema = 1
            [ignore]
            rules = ["*.tmp"]
        "#,
        )
        .expect("частичный файл должен разбираться");

        assert_eq!(parsed.ignore.rules, vec!["*.tmp".to_owned()]);
        assert!(parsed.ignore.use_defaults, "остальное осталось умолчанием");
        assert!(parsed.ignore.use_gitignore);
    }

    /// Опечатка называется по имени. Файл правят руками, и молчаливое
    /// игнорирование ключа — худшее, что можно сделать.
    #[test]
    fn typo_in_key_is_reported() {
        let error = parse(
            r#"
            schema = 1
            [ignore]
            use_defalts = false
        "#,
        )
        .expect_err("опечатка должна быть ошибкой");

        let message = error.to_string();
        assert!(
            message.contains("use_defalts"),
            "сообщение должно называть ключ: {message}"
        );
    }

    #[test]
    fn future_schema_is_rejected() {
        assert_eq!(
            parse("schema = 42"),
            Err(ProjectError::UnsupportedSchema { found: 42 })
        );
    }

    #[test]
    fn default_encoding_is_read() {
        let parsed = parse(
            r#"
            schema = 1
            [editor]
            default_encoding = "windows1251"
        "#,
        )
        .unwrap();

        assert_eq!(parsed.editor.default_encoding, Some(Encoding::Windows1251));
    }

    /// Неизвестная кодировка — ошибка с именем, а не тихий откат к UTF-8:
    /// иначе пользователь будет искать, почему проект «не применил» настройку.
    #[test]
    fn unknown_encoding_is_reported() {
        let error = parse(
            r#"
            schema = 1
            [editor]
            default_encoding = "cp1251"
        "#,
        )
        .expect_err("неизвестная кодировка должна быть ошибкой");

        assert!(
            error.to_string().contains("cp1251"),
            "сообщение должно называть значение: {error}"
        );
    }

    /// Папка без файла проекта — обычный случай, а не поломка.
    #[test]
    fn missing_file_yields_defaults() {
        let dir = temp_dir("missing");

        let loaded = load(&dir);

        assert_eq!(loaded.project, Project::default());
        assert!(!loaded.present);
        assert!(loaded.problem.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Испорченный файл проекта не должен мешать открыть папку: работаем
    /// на умолчаниях, но говорим об этом.
    #[test]
    fn broken_file_is_reported_but_not_fatal() {
        let dir = temp_dir("broken");
        std::fs::write(project_path(&dir), "это не toml = = =").unwrap();

        let loaded = load(&dir);

        assert_eq!(loaded.project, Project::default());
        assert!(loaded.present);
        assert!(loaded.problem.is_some(), "о поломке надо сказать");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
