//! Дерево файлов: чтение содержимого одной папки.
//!
//! **Дерево не обходится целиком.** Раскрыли папку — прочитали её содержимое,
//! и только его. Так устроен обозреватель VS Code, и причина не в экономии:
//! полный обход хранилища на сто тысяч файлов упирается в потолок при любой
//! реализации, а чтение одной папки не упирается никогда. Инвариант 6
//! выполняется не «фоновым обходом с отменой», а тем, что обходить нечего.
//!
//! Полный обход всё-таки понадобится — индексу на задаче 11. Но это другой
//! потребитель с другими требованиями: ему нужна отменяемость и ход работы,
//! а дереву нужна мгновенность.

pub mod watch;

use std::path::{Path, PathBuf};

use crate::project::ignore::IgnoreRules;

/// Одна строка дерева.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: PathBuf,
    pub name: String,
    pub is_dir: bool,
    /// Символьная ссылка или точка соединения. Внутрь не заходим (Р-054):
    /// `C:\проект\ссылка → C:\проект` — это петля, в которой обход остаётся
    /// навсегда.
    pub is_link: bool,
}

#[derive(Debug)]
pub enum TreeError {
    Io { path: PathBuf, source: std::io::Error },
}

impl std::fmt::Display for TreeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TreeError::Io { path, source } => write!(f, "{}: {source}", path.display()),
        }
    }
}

impl std::error::Error for TreeError {}

/// Сравнение имён так, как ожидает человек.
///
/// Папки идут выше файлов, регистр не важен, а числа в именах сравниваются
/// числами: иначе «глава10» встаёт между «глава1» и «глава2», и найти нужное
/// в списке из сорока глав становится отдельной задачей.
fn compare(a: &Entry, b: &Entry) -> std::cmp::Ordering {
    b.is_dir.cmp(&a.is_dir).then_with(|| natural(&a.name, &b.name))
}

/// Сравнение строк с числовыми кусками.
///
/// Идём по обеим строкам одновременно. Встретили цифры с обеих сторон —
/// откусываем число целиком и сравниваем как число; иначе сравниваем знаки
/// без учёта регистра.
fn natural(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    // Работаем по символам, а не по байтам: в именах бывает кириллица,
    // и разрезать её посередине нельзя.
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (mut i, mut j) = (0usize, 0usize);

    // «глава02» и «глава2» — числа равны, но имена разные, и порядок между
    // ними обязан быть определённым: иначе список перетасовывается при каждом
    // чтении папки, потому что порядок обхода каталога ничем не гарантирован.
    // Запоминаем первое такое расхождение и пускаем его в ход последним.
    let mut zero_padding: Ordering = Ordering::Equal;

    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let start_a = i;
            let start_b = j;
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }

            let left: String = a[start_a..i].iter().collect();
            let right: String = b[start_b..j].iter().collect();
            // Ведущие нули не делают число больше: сравнивается значение,
            // а длина без нулей и есть порядок величины.
            let left_value = left.trim_start_matches('0');
            let right_value = right.trim_start_matches('0');

            match left_value
                .len()
                .cmp(&right_value.len())
                .then_with(|| left_value.cmp(right_value))
            {
                Ordering::Equal => {
                    if zero_padding == Ordering::Equal {
                        zero_padding = left.cmp(&right);
                    }
                }
                other => return other,
            }
            continue;
        }

        let la = a[i].to_lowercase().next().unwrap_or(a[i]);
        let lb = b[j].to_lowercase().next().unwrap_or(b[j]);
        match la.cmp(&lb) {
            Ordering::Equal => {}
            other => return other,
        }
        i += 1;
        j += 1;
    }

    (a.len() - i)
        .cmp(&(b.len() - j))
        .then(zero_padding)
        // Последний рубеж: имена, различающиеся только регистром, в одной
        // папке на Windows не встречаются, но на всякий случай порядок должен
        // быть определён и здесь.
        .then_with(|| a.cmp(&b))
}

/// Прочитать содержимое одной папки.
///
/// `rules` — правила корня, которому папка принадлежит. Скрытое ими наружу
/// не отдаётся вовсе (Р-056): «показать скрытое» — это ветвление в дереве,
/// в поиске и в индексе, а не флажок.
pub fn read_children(dir: &Path, rules: &IgnoreRules) -> Result<Vec<Entry>, TreeError> {
    let entries = std::fs::read_dir(dir).map_err(|source| TreeError::Io {
        path: dir.to_path_buf(),
        source,
    })?;

    // Цепочка `.gitignore` строится один раз на папку, а не на запись в ней:
    // иначе на папке в десять тысяч файлов одни и те же файлы читались бы
    // десять тысяч раз.
    let chain = rules.gitignore_chain(dir);
    let mut out = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();

        // `file_type` берётся из уже прочитанной записи каталога и не требует
        // отдельного обращения к диску — на папке в десять тысяч файлов
        // разница между этим и `metadata` на каждый файл заметна.
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        let is_link = file_type.is_symlink();
        // У ссылки на папку сам тип записи — «ссылка», а не «папка». Чтобы
        // показать её с нужным значком и раскрывающим уголком, приходится
        // спросить, куда она ведёт. Это единственное место, где мы идём
        // по ссылке, и внутрь мы всё равно не заходим.
        let is_dir = if is_link {
            std::fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false)
        } else {
            file_type.is_dir()
        };

        if rules.decide(&path, is_dir, &chain) {
            continue;
        }

        let name = entry.file_name().to_string_lossy().into_owned();

        // Наш собственный временный файл живёт миллисекунды, но попасться
        // на глаза успевает. Мигать им в списке незачем.
        if crate::fsx::atomic_save::is_temp_name(&name) {
            continue;
        }

        out.push(Entry {
            path,
            name,
            is_dir,
            is_link,
        });
    }

    out.sort_by(compare);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::IgnoreSettings;
    use crate::project::ignore;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-tree-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn directories_come_before_files() {
        let dir = temp_dir("order");
        std::fs::write(dir.join("аааа.md"), "").unwrap();
        std::fs::create_dir(dir.join("яяяя")).unwrap();

        let rules = ignore::build(&dir, &IgnoreSettings::default());
        let entries = read_children(&dir, &rules).unwrap();

        assert_eq!(names(&entries), vec!["яяяя", "аааа.md"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// «глава10» не должна вставать между «глава1» и «глава2»: в папке
    /// с сорока главами это превращает поиск нужной в отдельную задачу.
    #[test]
    fn numbers_are_compared_as_numbers() {
        let dir = temp_dir("natural");
        for name in ["глава1.md", "глава2.md", "глава10.md", "глава02.md"] {
            std::fs::write(dir.join(name), "").unwrap();
        }

        let rules = ignore::build(&dir, &IgnoreSettings::default());
        let entries = read_children(&dir, &rules).unwrap();

        assert_eq!(
            names(&entries),
            vec!["глава1.md", "глава02.md", "глава2.md", "глава10.md"]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Регистр не должен разбивать список на две части — заглавные и строчные.
    #[test]
    fn case_does_not_split_the_list() {
        let dir = temp_dir("case");
        for name in ["Береза.md", "астра.md", "Вишня.md"] {
            std::fs::write(dir.join(name), "").unwrap();
        }

        let rules = ignore::build(&dir, &IgnoreSettings::default());
        let entries = read_children(&dir, &rules).unwrap();

        assert_eq!(names(&entries), vec!["астра.md", "Береза.md", "Вишня.md"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignored_entries_are_not_returned() {
        let dir = temp_dir("ignored");
        std::fs::create_dir(dir.join("node_modules")).unwrap();
        std::fs::create_dir(dir.join(".git")).unwrap();
        std::fs::write(dir.join("заметка.md"), "").unwrap();
        std::fs::write(dir.join("черновик.tmp"), "").unwrap();

        let settings = IgnoreSettings {
            rules: vec!["*.tmp".to_owned()],
            ..IgnoreSettings::default()
        };
        let rules = ignore::build(&dir, &settings);
        let entries = read_children(&dir, &rules).unwrap();

        assert_eq!(names(&entries), vec!["заметка.md"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_directory_is_an_error_not_a_panic() {
        let dir = temp_dir("missing");
        let rules = ignore::build(&dir, &IgnoreSettings::default());

        let result = read_children(&dir.join("нет-такой"), &rules);

        assert!(matches!(result, Err(TreeError::Io { .. })));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Пустая папка — это пустой список, а не ошибка.
    #[test]
    fn empty_directory_reads_as_empty() {
        let dir = temp_dir("empty");
        let rules = ignore::build(&dir, &IgnoreSettings::default());

        assert!(read_children(&dir, &rules).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
