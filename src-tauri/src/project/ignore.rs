//! Правила игнорирования корня.
//!
//! Семантика — та же, что у `.gitignore` (решение Р-050): её знают все, кто
//! пользуется git, и придумывать вторую было бы недобротой к пользователю.
//! Матчер берётся из крейта `ignore`.
//!
//! Порядок применения обратен по значимости — чем позже, тем сильнее:
//!
//! 1. встроенный список (`.git`, `node_modules`, `target`, `dist`, `.obsidian`);
//! 2. `.gitignore` от корня и до самой папки включительно, снаружи внутрь;
//! 3. правила из `zeronote.toml`.
//!
//! Поэтому строкой `!node_modules/` пользователь может вернуть то, что скрыли
//! умолчания или чужой `.gitignore`, а обратное невозможно. Ради этого три
//! источника держатся раздельно, а не сливаются в один матчер: у слитого
//! порядок задаётся при сборке и переопределить его нечем.
//!
//! Вложенные `.gitignore` учитываются, и это не роскошь: в любом репозитории
//! половина правил лежит не в корне. Матчер каждого файла привязан к своей
//! папке — у `.gitignore` шаблоны отсчитываются от того места, где он лежит.

use std::path::{Path, PathBuf};

// Ведущее `::` означает «внешний крейт `ignore`, а не модуль, в котором мы
// находимся»: имена совпадают, и без этого уточнения читатель кода (а иногда
// и компилятор) вынужден гадать.
use ::ignore::Match;
use ::ignore::gitignore::{Gitignore, GitignoreBuilder};

use super::IgnoreSettings;

/// Встроенный список: то, что не стоит показывать почти никогда.
///
/// Косая черта в конце означает «только каталог с таким именем», без неё
/// правило поймало бы и файл `dist` рядом с заметками.
pub const DEFAULT_RULES: &[&str] = &[".git/", "node_modules/", "target/", "dist/", ".obsidian/"];

/// Готовые к применению правила одного корня.
pub struct IgnoreRules {
    /// Встроенный список. Слабее всего.
    defaults: Gitignore,
    /// Правила из `zeronote.toml`. Сильнее всего.
    user: Gitignore,
    /// Учитывать ли `.gitignore` проекта.
    use_gitignore: bool,
    root: PathBuf,
    /// Правила, которые не удалось разобрать. Не ошибка сборки корня:
    /// одна кривая строка в `zeronote.toml` не повод не открыть папку —
    /// но пользователь должен о ней узнать.
    problems: Vec<String>,
}

impl std::fmt::Debug for IgnoreRules {
    // `Gitignore` не умеет Debug, а он нужен структурам, которые нас содержат.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IgnoreRules")
            .field("root", &self.root)
            .field("defaults", &self.defaults.len())
            .field("user", &self.user.len())
            .field("problems", &self.problems)
            .finish()
    }
}

/// Собрать матчер из набора строк, привязанный к папке.
fn matcher_from_lines(anchor: &Path, lines: &[String], problems: &mut Vec<String>) -> Gitignore {
    let mut builder = GitignoreBuilder::new(anchor);

    for line in lines {
        if let Err(e) = builder.add_line(None, line) {
            problems.push(format!("правило «{line}»: {e}"));
        }
    }

    match builder.build() {
        Ok(matcher) => matcher,
        Err(e) => {
            problems.push(format!("правила не собрались: {e}"));
            Gitignore::empty()
        }
    }
}

/// Собрать правила корня.
///
/// `root` нужен матчеру целиком: шаблоны вида `/build` привязаны к корню,
/// а не к любому месту дерева, и без знания корня их не применить.
pub fn build(root: &Path, settings: &IgnoreSettings) -> IgnoreRules {
    let mut problems = Vec::new();

    let defaults = if settings.use_defaults {
        let lines: Vec<String> = DEFAULT_RULES.iter().map(|r| (*r).to_owned()).collect();
        matcher_from_lines(root, &lines, &mut problems)
    } else {
        Gitignore::empty()
    };

    let before = problems.len();
    let user = matcher_from_lines(root, &settings.rules, &mut problems);
    // Уточняем, откуда взялась кривая строка: «правило такое-то» без указания
    // файла пользователю ничего не говорит.
    for problem in problems.iter_mut().skip(before) {
        problem.push_str(" в zeronote.toml");
    }

    IgnoreRules {
        defaults,
        user,
        use_gitignore: settings.use_gitignore,
        root: root.to_path_buf(),
        problems,
    }
}

impl IgnoreRules {
    /// Матчеры `.gitignore` от корня до этой папки включительно, снаружи внутрь.
    ///
    /// Строится один раз на чтение папки, а не на каждую запись в ней: иначе
    /// на папке в десять тысяч файлов мы прочитали бы одни и те же `.gitignore`
    /// десять тысяч раз.
    pub fn gitignore_chain(&self, dir: &Path) -> Vec<Gitignore> {
        if !self.use_gitignore || !dir.starts_with(&self.root) {
            return Vec::new();
        }

        // Собираем путь от корня вниз: сначала перечисляем предков снизу вверх,
        // потом переворачиваем. Иначе пришлось бы склеивать путь по кусочкам.
        let mut dirs = Vec::new();
        let mut current = Some(dir);
        while let Some(path) = current {
            dirs.push(path.to_path_buf());
            if path == self.root {
                break;
            }
            current = path.parent();
        }
        dirs.reverse();

        let mut chain = Vec::new();
        for dir in dirs {
            let file = dir.join(".gitignore");
            if !file.exists() {
                continue;
            }
            let mut builder = GitignoreBuilder::new(&dir);
            // Ошибку чтения проглатываем молча: файл мог исчезнуть прямо
            // сейчас, и жаловаться на это при каждом раскрытии папки хуже,
            // чем не жаловаться.
            if builder.add(&file).is_none()
                && let Ok(matcher) = builder.build()
            {
                chain.push(matcher);
            }
        }
        chain
    }

    /// Скрыт ли путь при уже собранной цепочке `.gitignore`.
    ///
    /// Побеждает самый поздний источник, у которого есть мнение: так правило
    /// пользователя может вернуть скрытое, а не только добавить своё.
    pub fn decide(&self, path: &Path, is_dir: bool, chain: &[Gitignore]) -> bool {
        if !path.starts_with(&self.root) {
            // Чужой путь не скрыт: молчаливое «да» на файл из другого места
            // было бы опаснее — он просто исчез бы из дерева без объяснений.
            return false;
        }

        let mut hidden = false;

        let mut apply = |verdict: Match<&::ignore::gitignore::Glob>| match verdict {
            Match::Ignore(_) => hidden = true,
            Match::Whitelist(_) => hidden = false,
            Match::None => {}
        };

        apply(self.defaults.matched_path_or_any_parents(path, is_dir));
        for matcher in chain {
            // Матчер знает только своё поддерево; пути выше он не касается.
            if path.starts_with(matcher.path()) {
                apply(matcher.matched_path_or_any_parents(path, is_dir));
            }
        }
        apply(self.user.matched_path_or_any_parents(path, is_dir));

        hidden
    }

    /// Скрыт ли путь. Цепочка `.gitignore` собирается на месте.
    ///
    /// Удобно для одиночной проверки; при обходе папки берите `gitignore_chain`
    /// и `decide`, иначе одни и те же файлы будут читаться снова и снова.
    pub fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        let chain = self.gitignore_chain(path.parent().unwrap_or(&self.root));
        self.decide(path, is_dir, &chain)
    }

    pub fn problems(&self) -> &[String] {
        &self.problems
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
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
        let root = Path::new(r"C:\проект");
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
        let root = Path::new(r"C:\проект");
        let rules = build(root, &IgnoreSettings::default());

        assert!(!rules.is_ignored(&root.join("dist"), false));
        assert!(rules.is_ignored(&root.join("dist"), true));
    }

    #[test]
    fn user_rules_are_applied() {
        let root = Path::new(r"C:\проект");
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
    #[test]
    fn user_rule_can_override_a_default() {
        let root = Path::new(r"C:\проект");
        let settings = IgnoreSettings {
            rules: vec!["!node_modules/".to_owned()],
            ..IgnoreSettings::default()
        };
        let rules = build(root, &settings);

        assert!(!rules.is_ignored(&root.join("node_modules"), true));
    }

    #[test]
    fn defaults_can_be_switched_off() {
        let root = Path::new(r"C:\проект");
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

    /// Вложенный `.gitignore` действует в своей папке, а его шаблоны
    /// отсчитываются от неё же. В репозитории таких файлов обычно несколько.
    #[test]
    fn nested_gitignore_is_honoured() {
        let dir = temp_dir("nested");
        let inner = dir.join("модуль");
        std::fs::create_dir_all(&inner).unwrap();
        std::fs::write(dir.join(".gitignore"), "*.log\n").unwrap();
        std::fs::write(inner.join(".gitignore"), "секрет.md\n").unwrap();

        let rules = build(&dir, &IgnoreSettings::default());

        assert!(rules.is_ignored(&inner.join("секрет.md"), false));
        // Правило вложенного файла не действует за пределами своей папки.
        assert!(!rules.is_ignored(&dir.join("секрет.md"), false));
        // Правило корневого файла продолжает действовать внутри.
        assert!(rules.is_ignored(&inner.join("вывод.log"), false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Правило пользователя сильнее чужого `.gitignore`: свой файл проекта
    /// должен уметь вернуть то, что скрыл репозиторий.
    #[test]
    fn user_rule_overrides_gitignore() {
        let dir = temp_dir("override");
        std::fs::write(dir.join(".gitignore"), "*.log\n").unwrap();

        let settings = IgnoreSettings {
            rules: vec!["!важный.log".to_owned()],
            ..IgnoreSettings::default()
        };
        let rules = build(&dir, &settings);

        assert!(!rules.is_ignored(&dir.join("важный.log"), false));
        assert!(rules.is_ignored(&dir.join("прочий.log"), false));
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
        let root = Path::new(r"C:\проект");
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
        assert!(
            rules.problems()[0].contains("zeronote.toml"),
            "пользователь должен знать, где искать: {:?}",
            rules.problems()
        );
        // Остальные правила при этом работают.
        assert!(rules.is_ignored(&root.join("файл.tmp"), false));
    }

    /// Путь вне корня чужой, и скрывать его нельзя: он исчез бы из дерева
    /// без всяких объяснений.
    #[test]
    fn path_outside_the_root_is_never_ignored() {
        let root = Path::new(r"C:\проект");
        let rules = build(root, &IgnoreSettings::default());

        assert!(!rules.is_ignored(Path::new(r"D:\другое\node_modules"), true));
    }
}
