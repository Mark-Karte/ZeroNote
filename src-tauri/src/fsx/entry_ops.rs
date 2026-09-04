//! Создание, переименование и удаление в дереве файлов.
//!
//! Р-049 разрешает запись в папку пользователя только по явной команде —
//! пункт меню ею и является. Но «по команде» не значит «без проверок»:
//! здесь их пять, и каждая закрывает случай, в котором приложение испортило бы
//! чужие данные молча.
//!
//! Проверка имени отделена от работы с диском намеренно: вся её сложность —
//! в разборе чужой строки, и проверять это надо тестами, а не руками
//! на живой файловой системе.

use std::path::{Path, PathBuf};

/// Знаки, которых не бывает в именах файлов Windows.
///
/// Косая черта здесь тоже запрещена, и в этом отличие от `markdown/new_note`:
/// там имя приходит из ссылки и может быть путём, а здесь пользователь вводит
/// имя одной записи. Косая черта в нём означает «создать в другом месте»,
/// то есть не то, что человек видел в диалоге.
const FORBIDDEN: &[char] = &['<', '>', ':', '"', '|', '?', '*', '/', '\\'];

/// Имена, зарезервированные Windows. Файл с таким именем не создать,
/// а сообщение системы об этом ничего не объясняет.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Debug, PartialEq, Eq)]
pub enum NameError {
    /// Пустое имя или одни пробелы.
    Empty,
    /// Знак, недопустимый в имени файла.
    Bad { bad: char },
    /// Имя, занятое системой: CON, NUL, COM1 и прочие.
    Reserved { name: String },
    /// Точка в конце или пробел в конце: Windows их молча отрезает, и файл
    /// получится не с тем именем, которое ввели.
    Trailing,
    /// `.` или `..` — не имя, а часть пути.
    Dots,
}

impl std::fmt::Display for NameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NameError::Empty => write!(f, "имя не может быть пустым"),
            NameError::Bad { bad } => {
                write!(f, "знак «{bad}» недопустим в имени файла")
            }
            NameError::Reserved { name } => write!(
                f,
                "имя «{name}» занято системой Windows и файлом быть не может"
            ),
            NameError::Trailing => write!(
                f,
                "имя не может оканчиваться точкой или пробелом: Windows их отбрасывает"
            ),
            NameError::Dots => write!(f, "«.» и «..» — это части пути, а не имя"),
        }
    }
}

impl std::error::Error for NameError {}

/// Проверить имя одной записи — файла или папки.
///
/// Возвращает то же имя, если оно годное. Отдельная функция, потому что
/// проверок пять, и три из них неочевидны: имя `CON` не создастся вовсе,
/// имя с точкой на конце создастся, но другое, а `..` уведёт на уровень выше.
pub fn check_name(name: &str) -> Result<&str, NameError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(NameError::Empty);
    }
    if trimmed == "." || trimmed == ".." {
        return Err(NameError::Dots);
    }

    if let Some(bad) = trimmed.chars().find(|c| FORBIDDEN.contains(c) || c.is_control()) {
        return Err(NameError::Bad { bad });
    }

    // Windows отбрасывает точку на конце имени: файл создастся, но другой —
    // «файл.» станет «файл», и найти его потом по введённому имени не выйдет.
    //
    // Пробелы по краям при этом просто снимаются: это описка, а не намерение,
    // и отказывать из-за неё было бы придиркой. Имя из одних пробелов уже
    // отсеяно выше как пустое.
    if trimmed.ends_with('.') {
        return Err(NameError::Trailing);
    }

    // Зарезервировано и само имя, и оно же с любым расширением: `NUL.txt`
    // так же не создаётся, как и `NUL`.
    let stem = trimmed.split('.').next().unwrap_or(trimmed);
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
        return Err(NameError::Reserved {
            name: stem.to_owned(),
        });
    }

    Ok(trimmed)
}

/// Путь новой записи внутри папки.
pub fn child_path(parent: &Path, name: &str) -> Result<PathBuf, NameError> {
    Ok(parent.join(check_name(name)?))
}

/// Путь записи после переименования — в той же папке.
///
/// Переименование не переносит: перенос в другую папку это другая операция
/// с другими проверками, и делать её незаметно, под видом смены имени,
/// нельзя.
pub fn renamed_path(path: &Path, name: &str) -> Result<PathBuf, NameError> {
    let name = check_name(name)?;
    Ok(match path.parent() {
        Some(parent) => parent.join(name),
        None => PathBuf::from(name),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_names_pass() {
        assert_eq!(check_name("заметка.md"), Ok("заметка.md"));
        assert_eq!(check_name("  файл.txt  "), Ok("файл.txt"));
        assert_eq!(check_name("папка"), Ok("папка"));
    }

    #[test]
    fn empty_name_is_refused() {
        assert_eq!(check_name(""), Err(NameError::Empty));
        assert_eq!(check_name("   "), Err(NameError::Empty));
    }

    /// Косая черта в имени означала бы «создать в другом месте» — то есть
    /// не то, что человек видел в диалоге.
    #[test]
    fn separators_are_refused() {
        assert_eq!(check_name("папка/файл.md"), Err(NameError::Bad { bad: '/' }));
        assert_eq!(check_name(r"папка\файл.md"), Err(NameError::Bad { bad: '\\' }));
    }

    #[test]
    fn forbidden_characters_are_refused() {
        assert_eq!(check_name("вопрос?.md"), Err(NameError::Bad { bad: '?' }));
        assert_eq!(check_name("два:двоеточия"), Err(NameError::Bad { bad: ':' }));
    }

    #[test]
    fn dots_are_not_a_name() {
        assert_eq!(check_name(".."), Err(NameError::Dots));
        assert_eq!(check_name("."), Err(NameError::Dots));
    }

    /// Скрытые файлы вида `.gitignore` — законное имя, и запрещать их нельзя.
    #[test]
    fn leading_dot_is_a_normal_name() {
        assert_eq!(check_name(".gitignore"), Ok(".gitignore"));
    }

    /// Точку на конце Windows молча отрезает: файл создастся, но другой.
    #[test]
    fn trailing_dot_is_refused() {
        assert_eq!(check_name("файл."), Err(NameError::Trailing));
        assert_eq!(check_name("файл..."), Err(NameError::Trailing));
    }

    /// А пробелы по краям — описка, а не намерение: снимаем и работаем.
    #[test]
    fn spaces_around_the_name_are_trimmed() {
        assert_eq!(check_name(" файл.txt "), Ok("файл.txt"));
    }

    #[test]
    fn reserved_names_are_refused() {
        assert_eq!(
            check_name("con"),
            Err(NameError::Reserved {
                name: "con".to_owned()
            })
        );
        // С расширением оно так же не создаётся.
        assert!(matches!(check_name("NUL.txt"), Err(NameError::Reserved { .. })));
        // А вот `console.md` — обычное имя, и запрещать его нельзя.
        assert!(check_name("console.md").is_ok());
    }

    #[test]
    fn child_goes_into_the_parent() {
        let parent = Path::new(r"C:\заметки");
        assert_eq!(
            child_path(parent, "новая.md"),
            Ok(PathBuf::from(r"C:\заметки\новая.md"))
        );
    }

    /// Переименование не переносит в другую папку — оно меняет только имя.
    #[test]
    fn rename_stays_in_the_same_folder() {
        let path = Path::new(r"C:\заметки\архив\старое.md");
        assert_eq!(
            renamed_path(path, "новое.md"),
            Ok(PathBuf::from(r"C:\заметки\архив\новое.md"))
        );
    }
}
