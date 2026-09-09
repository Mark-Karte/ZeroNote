//! Ежедневная заметка: как её зовут и чем заполняют (задача 90).
//!
//! Имя — `Заметка <дата>.md`, решение владельца. Дата в виде `2026-09-08`:
//! так заметки лежат в дереве по порядку сами, без всякой сортировки, —
//! любой другой порядок частей ставит январь следующего года между январём
//! и февралём этого.
//!
//! **Дату приносит окно, а не ядро.** У `std::time` нет часового пояса:
//! оно знает секунды с начала эпохи, а какой сейчас день у человека —
//! не знает. Спрашивать об этом систему через FFI ради одной строки дороже,
//! чем принять готовую дату от того, кто её и так знает. Ядро при этом
//! обязано ей не верить: из даты получается имя файла, и «..\\..\\чужое»
//! в этом месте создало бы файл где угодно.

/// Из чего складывается заметка: подстановки шаблона.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fields {
    /// Дата в виде `2026-09-08`.
    pub date: String,
    /// Время в виде `21:45`.
    pub time: String,
    /// Имя заметки без расширения — то же, что в заголовке файла.
    pub title: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DailyError {
    /// Дата пришла не в том виде, в каком её ждут.
    BadDate(String),
}

impl std::fmt::Display for DailyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DailyError::BadDate(got) => {
                write!(f, "дата «{got}» не похожа на дату вида 2026-09-08")
            }
        }
    }
}

impl std::error::Error for DailyError {}

/// Заголовок заметки: то, из чего делается имя файла.
///
/// Дата проверяется по виду, а не по смыслу: 31 февраля здесь пройдёт,
/// и это правильно — календарь считает окно, а наше дело не пустить в имя
/// файла то, что именем файла не является.
pub fn title(date: &str) -> Result<String, DailyError> {
    if !looks_like_date(date) {
        return Err(DailyError::BadDate(date.to_owned()));
    }
    Ok(format!("Заметка {date}"))
}

/// Имя файла заметки.
pub fn file_name(date: &str) -> Result<String, DailyError> {
    Ok(format!("{}.md", title(date)?))
}

/// Дата из имени файла заметки, если это она.
///
/// Обратная сторона `file_name`: календарь спрашивает, за какие дни заметки
/// уже написаны, а знает об этом только папка. Разбор строгий — ровно то имя,
/// которое пишем мы: чужой файл `Заметка про отпуск.md` днём календаря
/// не станет.
pub fn date_of(file_name: &str) -> Option<String> {
    let stem = file_name.strip_suffix(".md")?;
    let date = stem.strip_prefix("Заметка ")?;
    if looks_like_date(date) {
        Some(date.to_owned())
    } else {
        None
    }
}

/// Ровно `ГГГГ-ММ-ДД` и ничего больше.
pub fn looks_like_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    if bytes.len() != 10 {
        return false;
    }

    bytes.iter().enumerate().all(|(i, byte)| match i {
        4 | 7 => *byte == b'-',
        _ => byte.is_ascii_digit(),
    })
}

/// Подставить в шаблон дату, время и имя заметки.
///
/// Записи те же, что в Obsidian, — `{{date}}`, `{{time}}`, `{{title}}`:
/// шаблон человек приносит свой, и переучивать его записи ради нашего вкуса
/// незачем. Незнакомая запись остаётся как есть: шаблон может быть просто
/// текстом с двойными скобками, и стирать их — правка чужого файла.
pub fn fill(template: &str, fields: &Fields) -> String {
    template
        .replace("{{date}}", &fields.date)
        .replace("{{time}}", &fields.time)
        .replace("{{title}}", &fields.title)
}

/// Заметка без шаблона: заголовок и пустая строка под ним.
///
/// Не совсем пустой файл — потому что первое, что делает человек в новой
/// заметке, это пишет заголовок. Но и не больше того: всё прочее — дело
/// шаблона, который человек напишет сам.
pub fn blank(fields: &Fields) -> String {
    format!("# {}\n\n", fields.title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_daily_name_gives_its_date() {
        assert_eq!(date_of("Заметка 2026-09-09.md").as_deref(), Some("2026-09-09"));
    }

    /// Чужие файлы днями календаря не становятся: разбор строгий, потому что
    /// по нему решается, помечен день или нет.
    #[test]
    fn other_names_are_not_dates() {
        assert_eq!(date_of("Заметка про отпуск.md"), None);
        assert_eq!(date_of("2026-09-09.md"), None);
        assert_eq!(date_of("Заметка 2026-9-9.md"), None);
        assert_eq!(date_of("Заметка 2026-09-09.txt"), None);
        assert_eq!(date_of("Заметка 2026-09-09"), None);
    }

    fn fields() -> Fields {
        Fields {
            date: "2026-09-08".to_owned(),
            time: "21:45".to_owned(),
            title: "Заметка 2026-09-08".to_owned(),
        }
    }

    #[test]
    fn name_is_the_word_and_the_date() {
        assert_eq!(file_name("2026-09-08").unwrap(), "Заметка 2026-09-08.md");
    }

    /// Дата, из которой вышло бы что угодно, кроме имени файла, отвергается.
    /// Это не придирка: имя файла складывается из неё, и путь с косой чертой
    /// создал бы файл в другом месте.
    #[test]
    fn a_date_that_is_not_a_date_is_refused() {
        for bad in ["", "сегодня", "2026-9-8", "2026-09-08 ", "../../чужое", "2026/09/08"] {
            assert!(title(bad).is_err(), "«{bad}» должно быть отвергнуто");
        }
    }

    #[test]
    fn template_gets_the_date_the_time_and_the_title() {
        let out = fill("# {{title}}\n\n{{date}}, {{time}}\n", &fields());

        assert_eq!(out, "# Заметка 2026-09-08\n\n2026-09-08, 21:45\n");
    }

    /// Незнакомая запись остаётся как есть: шаблон — чужой файл.
    #[test]
    fn unknown_placeholders_are_left_alone() {
        assert_eq!(fill("{{придумал}}", &fields()), "{{придумал}}");
    }

    #[test]
    fn blank_note_starts_with_the_title() {
        assert_eq!(blank(&fields()), "# Заметка 2026-09-08\n\n");
    }
}
