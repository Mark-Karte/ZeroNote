//! Разбор командной строки.
//!
//! Редактор запускают не только с ярлыка: «Открыть с помощью» из проводника,
//! перетаскивание файла на значок, вызов из консоли. Всё это приходит
//! аргументами, и файлы оттуда надо открыть.

/// Флаги, за которыми следует значение. Их значение — не имя файла,
/// и в список путей оно попадать не должно.
const FLAGS_WITH_VALUE: [&str; 2] = ["--bench", "--bench-out"];

/// Пути к файлам из аргументов командной строки.
///
/// Первый аргумент — путь к самому исполняемому файлу, он пропускается.
/// Всё, что начинается с дефиса, считается флагом и тоже пропускается:
/// собственных однобуквенных ключей у нас нет, а чужие лучше игнорировать,
/// чем пытаться открыть как файл.
pub fn file_paths(args: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    let mut i = 1;

    while i < args.len() {
        let arg = &args[i];

        if FLAGS_WITH_VALUE.contains(&arg.as_str()) {
            i += 2;
            continue;
        }
        if arg.starts_with('-') {
            i += 1;
            continue;
        }

        paths.push(arg.clone());
        i += 1;
    }

    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn takes_file_paths() {
        assert_eq!(
            file_paths(&args(&[
                "zeronote.exe",
                r"C:\заметки\список.md",
                r"D:\код\main.rs"
            ])),
            vec![r"C:\заметки\список.md", r"D:\код\main.rs"]
        );
    }

    /// Значение флага стенда — не файл, открывать его нельзя.
    #[test]
    fn skips_flags_and_their_values() {
        assert_eq!(
            file_paths(&args(&[
                "zeronote.exe",
                "--bench",
                "startup",
                "--bench-out",
                r"C:\out.txt",
                r"C:\настоящий.md",
            ])),
            vec![r"C:\настоящий.md"]
        );
    }

    #[test]
    fn empty_command_line_gives_nothing() {
        assert!(file_paths(&args(&["zeronote.exe"])).is_empty());
        assert!(file_paths(&[]).is_empty());
    }
}
