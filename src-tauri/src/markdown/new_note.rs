//! Куда положить заметку, созданную по висячей ссылке (Р-098).
//!
//! Правила ровно те же, по которым ссылка разрешается (`index/graph.rs`):
//! косая черта в цели означает путь от корня проекта, её отсутствие — поиск
//! по имени, и тогда новая заметка ложится рядом с той, из которой ссылаются.
//! Расхождение здесь было бы худшего сорта: заметка создалась бы не там, где
//! её потом стали бы искать по той же ссылке.
//!
//! Вычисление пути отделено от создания файла, потому что вся его сложность —
//! в разборе чужой строки, и проверять это надо тестами, а не руками.

use std::path::{Path, PathBuf};

/// Знаки, которых не бывает в именах файлов Windows.
///
/// Косой черты здесь нет: она разделяет части пути и разбирается отдельно.
const FORBIDDEN: &[char] = &['<', '>', ':', '"', '|', '?', '*'];

#[derive(Debug, PartialEq, Eq)]
pub enum NoteError {
    /// В цели ссылки не осталось ничего, из чего можно сделать имя.
    Empty,
    /// В имени знак, недопустимый в имени файла.
    BadName { part: String, bad: char },
    /// Цель уводит за пределы проекта.
    Escapes,
}

impl std::fmt::Display for NoteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NoteError::Empty => write!(f, "в ссылке нет имени заметки"),
            NoteError::BadName { part, bad } => write!(
                f,
                "в имени «{part}» есть знак «{bad}», недопустимый в имени файла"
            ),
            NoteError::Escapes => {
                write!(f, "ссылка уводит за пределы проекта")
            }
        }
    }
}

impl std::error::Error for NoteError {}

/// Путь к заметке, которую надо создать по цели `target`.
///
/// `from` — файл, в котором стоит ссылка; `root` — корень его проекта.
/// Ни один из путей не проверяется на существование: это чистое вычисление,
/// а решение «создавать или отказать» принимает команда.
pub fn note_path(target: &str, from: &Path, root: &Path) -> Result<PathBuf, NoteError> {
    let target = target.trim();
    if target.is_empty() {
        return Err(NoteError::Empty);
    }

    // Обе косые черты, потому что в ссылках пишут и ту, и другую, — так же
    // считает `link_key`.
    let with_path = target.contains('/') || target.contains('\\');

    let mut parts: Vec<String> = Vec::new();
    for part in target.split(['/', '\\']) {
        let part = part.trim();
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(NoteError::Escapes);
        }
        // Управляющие знаки тоже отвергаем: имя файла с ними не создать,
        // а сообщение об ошибке файловой системы человеку ничего не скажет.
        if let Some(bad) = part
            .chars()
            .find(|c| FORBIDDEN.contains(c) || c.is_control())
        {
            return Err(NoteError::BadName {
                part: part.to_owned(),
                bad,
            });
        }
        parts.push(part.to_owned());
    }

    let Some(last) = parts.pop() else {
        return Err(NoteError::Empty);
    };

    // Расширение добавляется, только если его ещё нет, — то же правило,
    // что у `link_key`, который снимает ровно `.md` и никакое другое.
    let name = if last.to_lowercase().ends_with(".md") {
        last
    } else {
        format!("{last}.md")
    };

    let mut path = if with_path {
        root.to_path_buf()
    } else {
        // Рядом с той заметкой, из которой ссылаются. Родителя нет только
        // у корня тома — тогда кладём в корень проекта.
        from.parent().unwrap_or(root).to_path_buf()
    };

    for part in parts {
        path.push(part);
    }
    path.push(name);

    // Подстраховка: `..` уже отвергнут выше, но проверка стоит дёшево,
    // а цена ошибки — файл, созданный вне проекта пользователя.
    if !path.starts_with(root) {
        return Err(NoteError::Escapes);
    }

    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = r"C:\проект";
    const FROM: &str = r"C:\проект\заметки\Планы.md";

    fn path_of(target: &str) -> Result<String, NoteError> {
        note_path(target, Path::new(FROM), Path::new(ROOT))
            .map(|p| p.to_string_lossy().into_owned())
    }

    #[test]
    fn simple_name_lands_next_to_the_source() {
        assert_eq!(path_of("Идея").unwrap(), r"C:\проект\заметки\Идея.md");
    }

    #[test]
    fn extension_is_added_once() {
        assert_eq!(path_of("Идея.md").unwrap(), r"C:\проект\заметки\Идея.md");
        assert_eq!(path_of("Идея.MD").unwrap(), r"C:\проект\заметки\Идея.MD");
    }

    /// Точка в имени — это не расширение: «версия 1.2» вполне себе название.
    #[test]
    fn dot_inside_the_name_is_not_an_extension() {
        assert_eq!(
            path_of("версия 1.2").unwrap(),
            r"C:\проект\заметки\версия 1.2.md"
        );
    }

    #[test]
    fn path_in_target_is_counted_from_the_root() {
        assert_eq!(
            path_of("архив/Старое").unwrap(),
            r"C:\проект\архив\Старое.md"
        );
    }

    /// Обратная косая черта в ссылке встречается — так же, как в `link_key`.
    #[test]
    fn backslash_works_as_a_separator_too() {
        assert_eq!(
            path_of(r"архив\Старое").unwrap(),
            r"C:\проект\архив\Старое.md"
        );
    }

    #[test]
    fn leading_slash_means_the_root() {
        assert_eq!(path_of("/Сверху").unwrap(), r"C:\проект\Сверху.md");
    }

    #[test]
    fn spaces_around_parts_are_trimmed() {
        assert_eq!(
            path_of("  архив / Старое  ").unwrap(),
            r"C:\проект\архив\Старое.md"
        );
    }

    /// Главное, чего нельзя допустить: запись мимо папки пользователя.
    #[test]
    fn parent_directory_is_refused() {
        assert_eq!(path_of("../снаружи"), Err(NoteError::Escapes));
        assert_eq!(path_of(r"..\снаружи"), Err(NoteError::Escapes));
        assert_eq!(path_of("архив/../../снаружи"), Err(NoteError::Escapes));
    }

    #[test]
    fn empty_target_is_refused() {
        assert_eq!(path_of(""), Err(NoteError::Empty));
        assert_eq!(path_of("   "), Err(NoteError::Empty));
        assert_eq!(path_of("///"), Err(NoteError::Empty));
    }

    #[test]
    fn forbidden_characters_are_named() {
        let error = path_of("отчёт: итоги").unwrap_err();
        assert_eq!(
            error,
            NoteError::BadName {
                part: "отчёт: итоги".to_owned(),
                bad: ':'
            }
        );
        // Сообщение показывается пользователю, поэтому проверяем и его.
        assert!(error.to_string().contains("отчёт: итоги"));
    }

    #[test]
    fn control_characters_are_refused() {
        assert!(matches!(
            path_of("имя\u{7}со звонком"),
            Err(NoteError::BadName { .. })
        ));
    }

    /// Ссылка может указывать внутрь `.obsidian`.
    ///
    /// Путь при этом вычисляется — и правильно делает: прятать такую цель
    /// здесь значило бы, что запрет держится на двух местах, знающих друг
    /// о друге. Отказывает сторож инварианта 2 перед записью, а тест следит,
    /// что цель до него доходит в узнаваемом виде.
    #[test]
    fn obsidian_target_reaches_the_guard() {
        let path = note_path(".obsidian/app.json", Path::new(FROM), Path::new(ROOT)).unwrap();

        assert!(crate::fsx::atomic_save::is_inside_obsidian(&path));
    }

    /// Ссылка из файла, лежащего в самом корне.
    #[test]
    fn source_in_the_root_stays_in_the_root() {
        let path = note_path(
            "Идея",
            Path::new(r"C:\проект\Главная.md"),
            Path::new(ROOT),
        )
        .unwrap();
        assert_eq!(path.to_string_lossy(), r"C:\проект\Идея.md");
    }
}
