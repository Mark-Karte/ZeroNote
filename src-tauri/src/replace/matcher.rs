//! Где в тексте лежит искомое.
//!
//! Чистый поиск без файловой системы: сюда приходит раскодированный текст,
//! отсюда уходят смещения. Так его можно проверить тестами, а ошибка
//! в смещении здесь стоит дороже всего — по этим числам потом правится
//! чужой файл.
//!
//! Три правила, которые легко нарушить:
//!
//! * **совпадение возвращается вместе со своей длиной**, а не с длиной
//!   запроса. Без учёта регистра найденный кусок может занимать другое число
//!   байт, чем запрос: «ПЛАН» — восемь байт, «план» — тоже восемь, а вот
//!   «İ» и «i» уже расходятся. Заменять надо ровно то, что нашли;
//! * **совпадения не пересекаются**: поиск «аа» в «ааа» даёт одно
//!   совпадение, а не два. Иначе замена накладывалась бы сама на себя;
//! * **границы слова считаются по буквам и цифрам**, включая кириллицу:
//!   `is_alphanumeric`, а не список ASCII.

/// Найденный кусок текста.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Found {
    /// Смещение в байтах от начала текста.
    pub offset: usize,
    /// Длина найденного в байтах. Не обязана равняться длине запроса.
    pub len: usize,
}

/// Как искать.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Options {
    pub match_case: bool,
    pub whole_word: bool,
}

/// Часть слова: буква, цифра или подчёркивание.
///
/// `is_alphanumeric`, а не `is_ascii_alphanumeric`: «слово целиком» для
/// «план» в «планы» обязано работать так же, как для «plan» в «plans».
fn word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Стоит ли найденное отдельным словом.
fn whole_word_at(text: &str, start: usize, end: usize) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[end..].chars().next();

    !before.is_some_and(word_char) && !after.is_some_and(word_char)
}

/// Совпадают ли знаки. Без учёта регистра — по приведению обоих к нижнему.
fn same_char(a: char, b: char, match_case: bool) -> bool {
    if match_case || a == b {
        return a == b;
    }
    a.to_lowercase().eq(b.to_lowercase())
}

/// Начинается ли по этому смещению запрос. Возвращает длину найденного.
fn match_at(text: &str, start: usize, needle: &str, match_case: bool) -> Option<usize> {
    let mut chars = text[start..].chars();
    let mut len = 0;

    for wanted in needle.chars() {
        let got = chars.next()?;
        if !same_char(got, wanted, match_case) {
            return None;
        }
        len += got.len_utf8();
    }

    Some(len)
}

/// Все совпадения по порядку.
///
/// Пустой запрос не находит ничего: «заменить пустоту на что-нибудь» — это
/// вставка в каждую позицию файла, чего никто не имеет в виду.
pub fn find_all(text: &str, needle: &str, options: Options) -> Vec<Found> {
    if needle.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut from = 0;

    while from < text.len() {
        // С учётом регистра ищет стандартная библиотека — она делает это
        // быстрее любого посимвольного обхода. Без учёта регистра приходится
        // идти по знакам: приведение всего текста к нижнему регистру
        // сдвинуло бы смещения, а они здесь и есть ответ.
        let found = if options.match_case {
            text[from..].find(needle).map(|at| (from + at, needle.len()))
        } else {
            text[from..]
                .char_indices()
                .find_map(|(at, _)| {
                    match_at(text, from + at, needle, false).map(|len| (from + at, len))
                })
        };

        let Some((offset, len)) = found else {
            break;
        };

        if !options.whole_word || whole_word_at(text, offset, offset + len) {
            out.push(Found { offset, len });
        }

        // Дальше ищем за концом найденного — совпадения не пересекаются.
        // Пустым найденное быть не может: пустой запрос отсеян выше.
        from = offset + len;
    }

    out
}

/// Строка текста, в которой лежит смещение: номер (с единицы) и содержимое.
///
/// Содержимое обрезается: строка бывает длиной в файл (минифицированный
/// JavaScript — один такой файл целиком), и показывать её в диалоге целиком
/// нельзя.
pub fn line_at(text: &str, offset: usize, limit: usize) -> (u32, String) {
    let line = text[..offset].matches('\n').count() as u32 + 1;

    let start = text[..offset].rfind('\n').map_or(0, |at| at + 1);
    let end = text[offset..].find('\n').map_or(text.len(), |at| offset + at);

    let body = text[start..end].trim_matches(['\r', ' ', '\t']);
    (line, cut(body, limit))
}

/// Обрезать по знакам, а не по байтам: срез посреди буквы уронил бы процесс.
fn cut(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain() -> Options {
        Options::default()
    }

    fn offsets(text: &str, needle: &str, options: Options) -> Vec<usize> {
        find_all(text, needle, options)
            .iter()
            .map(|found| found.offset)
            .collect()
    }

    #[test]
    fn finds_every_occurrence() {
        let text = "план, потом ещё план";
        let second = text.rfind("план").unwrap();
        assert_eq!(offsets(text, "план", plain()), vec![0, second]);
    }

    /// Смещения байтовые, и кириллица занимает по два байта на букву.
    #[test]
    fn offsets_are_in_bytes() {
        let found = find_all("абв гдеж", "гдеж", plain());
        assert_eq!(found, vec![Found { offset: 7, len: 8 }]);
    }

    #[test]
    fn ignores_case_by_default() {
        let text = "План и план";
        let second = text.rfind("план").unwrap();
        assert_eq!(offsets(text, "план", plain()), vec![0, second]);
    }

    #[test]
    fn respects_case_when_asked() {
        let text = "План и план";
        let options = Options {
            match_case: true,
            whole_word: false,
        };
        assert_eq!(offsets(text, "план", options), vec![text.rfind("план").unwrap()]);
    }

    /// Длина найденного берётся у текста, а не у запроса.
    #[test]
    fn length_comes_from_the_text() {
        let found = find_all("ПЛАН", "план", plain());
        assert_eq!(found, vec![Found { offset: 0, len: 8 }]);
    }

    /// Совпадения не пересекаются: «аа» в «ааа» — одно, а не два.
    #[test]
    fn matches_do_not_overlap() {
        assert_eq!(offsets("ааа", "аа", plain()), vec![0]);
    }

    #[test]
    fn whole_word_skips_parts_of_words() {
        let options = Options {
            match_case: false,
            whole_word: true,
        };
        assert_eq!(offsets("план и планы", "план", options), vec![0]);
    }

    /// Границы слова знают про кириллицу: «планы» — не «план».
    #[test]
    fn whole_word_counts_letters_not_ascii() {
        let options = Options {
            match_case: false,
            whole_word: true,
        };
        assert!(offsets("планы", "план", options).is_empty());
        assert_eq!(offsets("(план)", "план", options), vec![1]);
    }

    #[test]
    fn empty_query_finds_nothing() {
        assert!(find_all("текст", "", plain()).is_empty());
    }

    #[test]
    fn line_number_starts_at_one() {
        let text = "первая\nвторая\nтретья";
        let offset = text.find("третья").unwrap();
        assert_eq!(line_at(text, offset, 80), (3, "третья".to_owned()));
    }

    /// Возврат каретки в содержимое строки не попадает: файл может быть
    /// с переносами Windows, а в диалоге такой знак виден пустотой.
    #[test]
    fn line_text_has_no_carriage_return() {
        let text = "первая\r\nвторая\r\n";
        let offset = text.find("вторая").unwrap();
        assert_eq!(line_at(text, offset, 80), (2, "вторая".to_owned()));
    }

    #[test]
    fn long_line_is_cut() {
        let text = "я".repeat(500);
        let (_, shown) = line_at(&text, 0, 10);
        assert_eq!(shown.chars().count(), 11, "десять знаков и многоточие");
    }
}
