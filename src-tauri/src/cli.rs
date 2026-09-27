//! Разбор командной строки.
//!
//! Редактор запускают не только с ярлыка: «Открыть с помощью» из проводника,
//! перетаскивание файла на значок, вызов из консоли. Всё это приходит
//! аргументами, и файлы оттуда надо открыть.

/// Флаги, за которыми следует значение. Их значение — не имя файла,
/// и в список путей оно попадать не должно.
const FLAGS_WITH_VALUE: [&str; 2] = ["--bench", "--bench-out"];

/// Пути к файлам из аргументов командной строки — полными.
///
/// Первый аргумент — путь к самому исполняемому файлу, он пропускается.
/// Всё, что начинается с дефиса, считается флагом и тоже пропускается:
/// собственных однобуквенных ключей у нас нет, а чужие лучше игнорировать,
/// чем пытаться открыть как файл.
///
/// **Путь приводится к полному здесь, в процессе, которому его дали**
/// (находки Ф5 и Я7 ревизии). Из консоли приходит `zeronote notes.md`,
/// и значит он что-то только от текущей папки этой консоли. До задачи 142
/// строка шла дальше как есть: второй экземпляр отдавал её первому,
/// а тот разрешал от своей текущей папки — папки ярлыка или прошлого
/// файла — и открывал не тот файл; первый экземпляр хранил относительный
/// путь в буфере, в сессии и в недавнем, и после перезапуска с ярлыка
/// сохранение ушло бы в другую папку.
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

        paths.push(full(arg));
        i += 1;
    }

    paths
}

/// Полный путь от текущей папки этого процесса.
///
/// `std::path::absolute` на Windows — это `GetFullPathNameW`: одна работа
/// со строкой, без обращения к диску, поэтому несуществующий файл остаётся
/// несуществующим и дойдёт до открытия внятным «не найден». Заодно
/// сворачиваются `.` и `..`: `zeronote .` откроет корнем эту папку,
/// а не папку, где работает первый экземпляр.
///
/// Не вышло — оставляем строку как есть: открытие её отвергнет
/// (`commands::files::open_path` относительных путей не берёт).
fn full(arg: &str) -> String {
    match std::path::absolute(arg) {
        Ok(path) => path.into_os_string().into_string().unwrap_or_else(|_| arg.to_owned()),
        Err(_) => arg.to_owned(),
    }
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

    /// Путь из консоли — от её текущей папки, и полным (Ф5, Я7 ревизии):
    /// дальше его разрешал бы первый экземпляр от своей.
    #[test]
    fn relative_path_becomes_full() {
        let here = std::env::current_dir().unwrap();

        assert_eq!(
            file_paths(&args(&["zeronote.exe", "notes.md", "."])),
            vec![
                here.join("notes.md").to_string_lossy().into_owned(),
                here.to_string_lossy().into_owned(),
            ]
        );
        assert_eq!(
            file_paths(&args(&["zeronote.exe", r"C:\заметки\..\список.md"])),
            vec![r"C:\список.md"]
        );
    }

    #[test]
    fn empty_command_line_gives_nothing() {
        assert!(file_paths(&args(&["zeronote.exe"])).is_empty());
        assert!(file_paths(&[]).is_empty());
    }
}
