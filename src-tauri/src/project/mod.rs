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

use crate::l10n::{tr, tr_with};
use crate::text::encoding::Encoding;

pub mod ignore;
pub mod obsidian;

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
                f.write_str(&tr_with("config.parse", &[("file", PROJECT_FILE), ("error", message)]))
            }
            ProjectError::UnsupportedSchema { found } => f.write_str(&tr_with(
                "config.project.schema",
                &[("found", &found.to_string()), ("expected", &PROJECT_SCHEMA.to_string())],
            )),
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
    /// Что не так с файлом проекта: не разобрался (тогда действуют
    /// умолчания) или просит невозможного (тогда действует, но не в этом).
    pub problem: Option<String>,
}

/// Предел индекса выше потолка — сказать словами, а не урезать молча
/// (задача 140, Я13): потолок ставит ядро, какой бы предел ни просил файл.
fn index_limit_problem(path: &Path, project: &Project) -> Option<String> {
    let ceiling = crate::fsx::text_file::LARGE_FILE_THRESHOLD;
    (project.index.max_file_size > ceiling).then(|| {
        tr_with(
            "config.project.max-size",
            &[("file", &path.display().to_string()), ("mib", &(ceiling / (1024 * 1024)).to_string())],
        )
    })
}

pub fn load(root: &Path) -> Loaded {
    let path = project_path(root);

    // `zeronote.toml` — ссылкой на другой файл? Не читаем: цель может лежать
    // на чужом сервере, а файл проекта читается сам, при открытии папки
    // (задача 139). Говорим об этом, а не молчим: иначе «настройки проекта
    // не действуют» без объяснения.
    if std::fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Loaded {
            project: Project::default(),
            present: true,
            problem: Some(
                tr("config.project.link"),
            ),
        };
    }

    let Ok(source) = std::fs::read_to_string(&path) else {
        return Loaded {
            project: Project::default(),
            present: false,
            problem: None,
        };
    };

    match parse(&source) {
        Ok(project) => Loaded {
            problem: index_limit_problem(&path, &project),
            project,
            present: true,
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
pub const TEMPLATE_RU: &str = include_str!("../../../l10n/samples/ru/zeronote.toml");
/// Английский образец — для английского и для своих переводов.
pub const TEMPLATE_EN: &str = include_str!("../../../l10n/samples/en/zeronote.toml");

/// Образец на языке образцов процесса (`l10n::samples`, задача 155).
pub fn template() -> &'static str {
    match crate::l10n::samples() {
        crate::l10n::Builtin::Ru => TEMPLATE_RU,
        crate::l10n::Builtin::En => TEMPLATE_EN,
    }
}

/// Образец файла проекта с уже вписанными правилами игнорирования.
///
/// Нужен переходнику Obsidian: он создаёт файл проекта сразу с перенесёнными
/// фильтрами. Подстановка в готовый образец, а не сборка через serde: serde
/// не переживает комментарии, а в этом файле они и есть половина пользы.
pub fn template_with_rules(rules: &[String], source: &str) -> String {
    if rules.is_empty() {
        return template().to_owned();
    }

    let lines: Vec<String> = rules
        .iter()
        // Строка в одинарных кавычках берётся TOML дословно: обратная косая
        // в правиле вроде `/Папка \[важное\]` не должна стать escape-знаком.
        // Сама одинарная кавычка внутри такой строки невозможна, поэтому
        // в имени файла с апострофом она убирается — иначе получился бы
        // неразбираемый файл.
        .map(|rule| format!("    '{}',", rule.replace('\'', "")))
        .collect();

    // Пояснение над правилами — на языке окна, как и образец вокруг них.
    let filled = format!(
        "{}\nrules = [\n{}\n]",
        tr_with("config.project.rules.imported", &[("source", source)]),
        lines.join("\n")
    );

    template().replace("rules = []", &filled)
}

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
        for sample in [TEMPLATE_RU, TEMPLATE_EN] {
            let parsed = parse(sample).expect("образец должен разбираться");
            assert_eq!(parsed, Project::default());
            // Правила вставляются на место этой строки: без неё перенос
            // из Obsidian молча дал бы образец без правил.
            assert!(sample.contains("\nrules = []\n"));
        }
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

    /// Образец с перенесёнными правилами обязан разбираться, а правила —
    /// доезжать. Иначе переходник создаст файл, который сам же и не прочитает.
    #[test]
    fn template_with_rules_parses() {
        let rules = vec![
            "/Архив".to_owned(),
            r"/Папка \[важное\]".to_owned(),
            "/Работа/Черновики".to_owned(),
        ];

        let text = template_with_rules(&rules, ".obsidian/app.json");
        let parsed = parse(&text).expect("образец с правилами должен разбираться");

        assert_eq!(parsed.ignore.rules, rules);
        assert!(
            text.contains(".obsidian/app.json"),
            "в файле должно быть сказано, откуда взялись правила"
        );
    }

    /// Переносить нечего — образец остаётся обычным.
    #[test]
    fn template_without_rules_is_the_plain_one() {
        assert_eq!(template_with_rules(&[], "что угодно"), template());
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

    /// Файл проекта ссылкой не читается (задача 139, Я5): его читает само
    /// открытие папки, а цель ссылки может лежать на чужом сервере.
    /// Символьная ссылка на файл создаётся только в режиме разработчика
    /// или с правами администратора — без них проверять нечего.
    #[cfg(windows)]
    #[test]
    fn project_file_behind_a_link_is_not_read() {
        let dir = temp_dir("link");
        let real = dir.join("настоящий.toml");
        std::fs::write(&real, "[editor]\ndefault_encoding = \"windows1251\"\n").unwrap();
        if std::os::windows::fs::symlink_file(&real, project_path(&dir)).is_err() {
            eprintln!("символьная ссылка не создалась — проверка пропущена");
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }

        let loaded = load(&dir);

        assert_eq!(loaded.project, Project::default(), "файл по ссылке прочитан");
        assert!(loaded.problem.is_some(), "о пропуске надо сказать");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Предел индекса выше потолка называется словами (Я13), а остальной
    /// файл проекта действует.
    #[test]
    fn index_limit_above_the_ceiling_is_reported() {
        let dir = temp_dir("ceiling");
        std::fs::write(
            project_path(&dir),
            "[project]\nname = \"чужой\"\n\n[index]\nmax_file_size = 9223372036854775807\n",
        )
        .unwrap();

        let loaded = load(&dir);

        assert_eq!(loaded.project.project.name.as_deref(), Some("чужой"));
        assert!(
            loaded.problem.as_deref().is_some_and(|p| p.contains("max_file_size")),
            "{:?}",
            loaded.problem
        );

        std::fs::write(project_path(&dir), "[index]\nmax_file_size = 4194304\n").unwrap();
        assert_eq!(load(&dir).problem, None, "обычный предел — не жалоба");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
