//! Ежедневная заметка: как её зовут и чем заполняют (задача 90).
//!
//! Имя — `Заметка <дата>.md`, решение владельца; по-английски — `Note
//! <дата>.md` (задача 155), и календарь узнаёт заметки на обоих языках.
//! Дата в виде `2026-09-08`:
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

use crate::l10n::tr_with;

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
            DailyError::BadDate(got) => f.write_str(&tr_with("daily.bad-date", &[("date", got)])),
        }
    }
}

impl std::error::Error for DailyError {}

/// Заголовок заметки: то, из чего делается имя файла.
///
/// Дата проверяется по виду, а не по смыслу: 31 февраля здесь пройдёт,
/// и это правильно — календарь считает окно, а наше дело не пустить в имя
/// файла то, что именем файла не является.
///
/// Слово — на языке окна (задача 155): «Заметка 2026-09-08», «Note
/// 2026-09-08». Свой перевод, давший не имя файла (косая черта, двоеточие),
/// не проходит — берётся английское.
pub fn title(date: &str) -> Result<String, DailyError> {
    if !looks_like_date(date) {
        return Err(DailyError::BadDate(date.to_owned()));
    }
    let title = tr_with("daily.title", &[("date", date)]);
    if is_plain_name(&title) {
        return Ok(title);
    }
    let english = crate::l10n::english("daily.title");
    Ok(english.map_or_else(|| date.to_owned(), |english| english.replace("{date}", date)))
}

/// Имя файла заметки на языке окна.
pub fn file_name(date: &str) -> Result<String, DailyError> {
    Ok(format!("{}.md", title(date)?))
}

/// Имена файла заметки этого дня на всех языках: первым — на языке окна.
///
/// Заметка, созданная по-русски, остаётся заметкой дня и в английском окне:
/// «Заметка на сегодня» откроет её, а не заведёт рядом вторую.
pub fn file_names(date: &str) -> Result<Vec<String>, DailyError> {
    let mut names = vec![file_name(date)?];
    for template in templates() {
        let name = format!("{}.md", template.replace("{date}", date));
        if is_plain_name(&name) && !names.contains(&name) {
            names.push(name);
        }
    }
    Ok(names)
}

/// Дата из имени файла заметки, если это она.
///
/// Обратная сторона `file_name`: календарь спрашивает, за какие дни заметки
/// уже написаны, а знает об этом только папка. Разбор строгий — ровно то имя,
/// которое пишем мы, на любом из языков: чужой файл `Заметка про отпуск.md`
/// днём календаря не станет.
pub fn date_of(file_name: &str) -> Option<String> {
    let stem = file_name.strip_suffix(".md")?;
    templates().iter().find_map(|template| {
        let (prefix, suffix) = template.split_once("{date}")?;
        let date = stem.strip_prefix(prefix)?.strip_suffix(suffix)?;
        looks_like_date(date).then(|| date.to_owned())
    })
}

/// Вид имени на всех языках — текущем и встроенных.
fn templates() -> Vec<String> {
    crate::l10n::every_text("daily.title")
        .into_iter()
        .filter(|template| template.contains("{date}"))
        .collect()
}

/// Годится ли строка именем одного файла — без папок и запретных знаков.
fn is_plain_name(name: &str) -> bool {
    crate::fsx::entry_ops::check_name(name).is_ok_and(|checked| checked == name)
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

    /// Заметка, заведённая в английском окне, — тоже заметка дня, и имена
    /// на всех языках известны «Заметке на сегодня» (задача 155).
    #[test]
    fn daily_names_in_every_language() {
        assert_eq!(date_of("Note 2026-09-09.md").as_deref(), Some("2026-09-09"));
        assert_eq!(
            file_names("2026-09-09").unwrap(),
            ["Заметка 2026-09-09.md", "Note 2026-09-09.md"]
        );
        assert_eq!(date_of("Note about the trip.md"), None);
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
