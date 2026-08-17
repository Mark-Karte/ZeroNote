//! Правила игнорирования корня.
//!
//! Семантика — та же, что у `.gitignore` (решение Р-050): её знают все, кто
//! пользуется git, и придумывать вторую было бы недобротой к пользователю.
//! Матчер берётся из крейта `ignore`; своими руками это порядок применения
//! правил, отрицания, привязка шаблона к каталогу и вложенные `.gitignore` —
//! четыре места, где ошибка даёт файл, видимый в дереве и отсутствующий
//! в поиске.
//!
//! Порядок сложения правил важен и обратен по значимости: чем позже правило
//! добавлено, тем оно сильнее. Отсюда порядок «умолчания → `.gitignore` →
//! правила пользователя»: строкой `!node_modules/` в `zeronote.toml` можно
//! вернуть то, что скрыли умолчания, а обратное было бы невозможно.
//!
//! Здесь только матчер. Обход дерева, который им пользуется, — задача 10.

use std::path::Path;

// Ведущее `::` означает «внешний крейт `ignore`, а не модуль, в котором мы
// находимся»: имена совпадают, и без этого уточнения читатель кода (а иногда
// и компилятор) вынужден гадать.
use ::ignore::gitignore::{Gitignore, GitignoreBuilder};

use super::IgnoreSettings;

/// Встроенный список: то, что не стоит показывать почти никогда.
///
/// Косая черта в конце означает «только каталог с таким именем», без неё
/// правило поймало бы и файл `dist` рядом с заметками.
pub const DEFAULT_RULES: &[&str] = &[".git/", "node_modules/", "target/", "dist/", ".obsidian/"];

/// Готовые к применению правила одного корня.
pub struct IgnoreRules {
    matcher: Gitignore,
    root: std::path::PathBuf,
    /// Правила, которые не удалось разобрать. Не ошибка сборки корня:
    /// одна кривая строка в `zeronote.toml` не повод не открыть папку —
    /// но пользователь должен о ней узнать.
    problems: Vec<String>,
}

impl std::fmt::Debug for IgnoreRules {
    // `Gitignore` не умеет Debug, а он нужен структурам, которые нас содержат.
    // Печатаем то, что осмысленно: корень и число правил.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IgnoreRules")
            .field("root", &self.root)
            .field("rules", &self.matcher.len())
            .field("problems", &self.problems)
            .finish()
    }
}

/// Собрать матчер для корня.
///
/// `root` нужен матчеру целиком: шаблоны вида `/build` привязаны к корню,
/// а не к любому месту дерева, и без знания корня их не применить.
pub fn build(root: &Path, settings: &IgnoreSettings) -> IgnoreRules {
    let mut builder = GitignoreBuilder::new(root);
    let mut problems = Vec::new();

    if settings.use_defaults {
        for rule in DEFAULT_RULES {
            // Умолчания заведомо верны, но проверять всё равно дешевле,
            // чем разбираться потом, почему матчер пуст.
            if let Err(e) = builder.add_line(None, rule) {
                problems.push(format!("встроенное правило «{rule}»: {e}"));
            }
        }
    }

    if settings.use_gitignore {
        let gitignore = root.join(".gitignore");
        // `add` возвращает ошибку, а не Result: файла может не быть, и это
        // обычное дело, а не повод шуметь.
        if gitignore.exists()
            && let Some(e) = builder.add(&gitignore)
        {
            problems.push(format!("{}: {e}", gitignore.display()));
        }
    }

    for rule in &settings.rules {
        if let Err(e) = builder.add_line(None, rule) {
            problems.push(format!("правило «{rule}» в zeronote.toml: {e}"));
        }
    }

    match builder.build() {
        Ok(matcher) => IgnoreRules {
            matcher,
            root: root.to_path_buf(),
            problems,
        },
        Err(e) => {
            problems.push(format!("правила игнорирования не собрались: {e}"));
            IgnoreRules {
                matcher: Gitignore::empty(),
                root: root.to_path_buf(),
                problems,
            }
        }
    }
}

impl IgnoreRules {
    /// Скрыт ли путь.
    ///
    /// Путь ожидается абсолютным и лежащим внутри корня. Чужой путь не скрыт:
    /// молчаливое «да» на файл из другого места было бы опаснее — он просто
    /// исчез бы из дерева без объяснений.
    pub fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        if !path.starts_with(&self.root) {
            return false;
        }

        // `matched_path_or_any_parents` вместо `matched`: правило `node_modules/`
        // должно скрывать и всё, что внутри, а не только саму папку. Обход
        // дерева в задаче 10 сможет отсекать каталог целиком и обойдётся более
        // дешёвым `matched`, но здесь путь приходит поодиночке и без контекста.
        self.matcher
            .matched_path_or_any_parents(path, is_dir)
            .is_ignore()
    }

    pub fn problems(&self) -> &[String] {
        &self.problems
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-ignore-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn defaults_hide_the_usual_suspects() {
        let root = std::path::Path::new(r"C:\проект");
        let rules = build(root, &IgnoreSettings::default());

        assert!(rules.is_ignored(&root.join("node_modules"), true));
        assert!(rules.is_ignored(&root.join("node_modules/пакет/index.js"), false));
        assert!(rules.is_ignored(&root.join(".git/HEAD"), false));
        assert!(rules.is_ignored(&root.join(".obsidian/app.json"), false));
        assert!(!rules.is_ignored(&root.join("заметки/список.md"), false));
    }

    /// Файл с именем как у каталога из умолчаний скрываться не должен:
    /// правило записано с косой чертой именно ради этого.
    #[test]
    fn default_rules_match_directories_only() {
        let root = std::path::Path::new(r"C:\проект");
        let rules = build(root, &IgnoreSettings::default());

        assert!(!rules.is_ignored(&root.join("dist"), false));
        assert!(rules.is_ignored(&root.join("dist"), true));
    }

    #[test]
    fn user_rules_are_applied() {
        let root = std::path::Path::new(r"C:\проект");
        let settings = IgnoreSettings {
            rules: vec!["*.tmp".to_owned(), "черновики/".to_owned()],
            ..IgnoreSettings::default()
        };
        let rules = build(root, &settings);

        assert!(rules.is_ignored(&root.join("заметка.tmp"), false));
        assert!(rules.is_ignored(&root.join("черновики/старое.md"), false));
        assert!(!rules.is_ignored(&root.join("заметка.md"), false));
    }

    /// Правило пользователя должно уметь вернуть то, что скрыли умолчания.
    /// Ради этого умолчания добавляются первыми.
    #[test]
    fn user_rule_can_override_a_default() {
        let root = std::path::Path::new(r"C:\проект");
        let settings = IgnoreSettings {
            rules: vec!["!node_modules/".to_owned()],
            ..IgnoreSettings::default()
        };
        let rules = build(root, &settings);

        assert!(!rules.is_ignored(&root.join("node_modules"), true));
    }

    #[test]
    fn defaults_can_be_switched_off() {
        let root = std::path::Path::new(r"C:\проект");
        let settings = IgnoreSettings {
            use_defaults: false,
            ..IgnoreSettings::default()
        };
        let rules = build(root, &settings);

        assert!(!rules.is_ignored(&root.join("node_modules"), true));
    }

    #[test]
    fn gitignore_of_the_project_is_honoured() {
        let dir = temp_dir("gitignore");
        std::fs::write(dir.join(".gitignore"), "*.log\nсборка/\n").unwrap();

        let rules = build(&dir, &IgnoreSettings::default());

        assert!(rules.is_ignored(&dir.join("вывод.log"), false));
        assert!(rules.is_ignored(&dir.join("сборка/итог.md"), false));
        assert!(!rules.is_ignored(&dir.join("заметка.md"), false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn gitignore_can_be_switched_off() {
        let dir = temp_dir("no-gitignore");
        std::fs::write(dir.join(".gitignore"), "*.log\n").unwrap();

        let settings = IgnoreSettings {
            use_gitignore: false,
            ..IgnoreSettings::default()
        };
        let rules = build(&dir, &settings);

        assert!(!rules.is_ignored(&dir.join("вывод.log"), false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Кривое правило не должно мешать открыть папку, но обязано быть названо.
    #[test]
    fn broken_rule_is_reported_not_fatal() {
        let root = std::path::Path::new(r"C:\проект");
        // Незакрытая фигурная скобка — одно из немногого, что здесь и правда
        // ошибка. Квадратные скобки и лишние звёздочки git принимает как
        // обычные знаки, и притворяться строже него мы не станем.
        let settings = IgnoreSettings {
            rules: vec!["черновики{".to_owned(), "*.tmp".to_owned()],
            ..IgnoreSettings::default()
        };
        let rules = build(root, &settings);

        assert_eq!(rules.problems().len(), 1, "{:?}", rules.problems());
        assert!(rules.problems()[0].contains("черновики{"));
        // Остальные правила при этом работают.
        assert!(rules.is_ignored(&root.join("файл.tmp"), false));
    }

    /// Путь вне корня чужой, и скрывать его нельзя: он исчез бы из дерева
    /// без всяких объяснений.
    #[test]
    fn path_outside_the_root_is_never_ignored() {
        let root = std::path::Path::new(r"C:\проект");
        let rules = build(root, &IgnoreSettings::default());

        assert!(!rules.is_ignored(std::path::Path::new(r"D:\другое\node_modules"), true));
    }
}
