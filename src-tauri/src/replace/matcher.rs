//! Где в тексте лежит искомое.
//!
//! Чистый поиск без файловой системы: сюда приходит раскодированный текст,
//! отсюда уходят смещения. Так его можно проверить тестами, а ошибка
//! в смещении здесь стоит дороже всего — по этим числам потом правится
//! чужой файл.
//!
//! Искать умеет двумя способами — точным текстом (задача 88) и регулярным
//! выражением (задача 89). Способ выбирается один раз, до обхода: выражение
//! разбирается однажды, а не на каждом файле, и ошибка в нём становится
//! известна до того, как прочитан первый файл.
//!
//! Три правила, которые легко нарушить:
//!
//! * **совпадение возвращается вместе со своей длиной**, а не с длиной
//!   запроса. Без учёта регистра найденный кусок может занимать другое число
//!   байт, чем запрос; у выражения он и подавно свой. Заменять надо ровно
//!   то, что нашли;
//! * **совпадения не пересекаются**: поиск «аа» в «ааа» даёт одно
//!   совпадение, а не два. Иначе замена накладывалась бы сама на себя;
//! * **пустое совпадение не считается совпадением**. Выражение `a*`
//!   находит пустоту в каждой позиции текста; замена такого — вставка между
//!   каждой парой букв, чего никто не имеет в виду, а обход по нулевой
//!   длине ещё и не двигается с места.

use regex::{Regex, RegexBuilder};

use crate::model::edit::TextEdit;

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
    /// Запрос — регулярное выражение, а не точный текст.
    pub expression: bool,
}

/// Готовый к работе искатель.
///
/// Собирается один раз на весь обход. Для выражения это существенно: разбор
/// и построение автомата стоят дороже, чем поиск в небольшом файле.
#[derive(Debug, Clone)]
pub enum Matcher {
    /// Точный текст.
    Literal { needle: String, options: Options },
    /// Регулярное выражение.
    Expression(Regex),
}

impl Matcher {
    /// Собрать искатель. Ошибка — текст для человека, а не код.
    ///
    /// Выражение с ошибкой — обычное дело: его пишут в поле по букве.
    /// Поэтому «не разобрано» здесь — ответ, а не сбой.
    pub fn build(query: &str, options: Options) -> Result<Self, String> {
        if !options.expression {
            return Ok(Matcher::Literal {
                needle: query.to_owned(),
                options,
            });
        }

        // «Слово целиком» для выражения — это границы слова вокруг него
        // целиком, а не вокруг каждой ветки: `кот|пёс` иначе превратился бы
        // в «кот целиком или пёс как угодно».
        let source = if options.whole_word {
            format!(r"\b(?:{query})\b")
        } else {
            query.to_owned()
        };

        RegexBuilder::new(&source)
            .case_insensitive(!options.match_case)
            .size_limit(EXPRESSION_LIMIT)
            .build()
            .map(Matcher::Expression)
            .map_err(describe)
    }

    /// Все совпадения по порядку.
    pub fn find_all(&self, text: &str) -> Vec<Found> {
        match self {
            Matcher::Literal { needle, options } => find_literal(text, needle, *options),
            Matcher::Expression(regex) => regex
                .find_iter(text)
                .filter(|found| !found.is_empty())
                .map(|found| Found {
                    offset: found.start(),
                    len: found.len(),
                })
                .collect(),
        }
    }

    /// Правки, заменяющие найденное.
    ///
    /// У выражения подстановки `$1` и `${имя}` раскрываются по своим группам —
    /// затем выражение в замене обычно и нужно. У точного текста замена
    /// подставляется как есть: `$1` там — это доллар и единица.
    pub fn edits(&self, text: &str, replacement: &str) -> Vec<TextEdit> {
        match self {
            Matcher::Literal { .. } => self
                .find_all(text)
                .into_iter()
                .map(|found| TextEdit {
                    offset: found.offset,
                    // Что нашли, то и заменяем: без учёта регистра найденный
                    // кусок не обязан совпадать с запросом ни буквами,
                    // ни длиной.
                    was: text[found.offset..found.offset + found.len].to_owned(),
                    becomes: replacement.to_owned(),
                })
                .collect(),
            Matcher::Expression(regex) => regex
                .captures_iter(text)
                .filter_map(|caps| {
                    let whole = caps.get(0)?;
                    if whole.is_empty() {
                        return None;
                    }
                    let mut becomes = String::new();
                    caps.expand(replacement, &mut becomes);
                    Some(TextEdit {
                        offset: whole.start(),
                        was: whole.as_str().to_owned(),
                        becomes,
                    })
                })
                .collect(),
        }
    }
}

/// Предел на размер разобранного выражения.
///
/// Выражение вроде `(a{1000}){1000}` разворачивается в автомат на сотни
/// мегабайт. Предел превращает это в «не разобрано» — то есть в ответ,
/// а не в съеденную память.
const EXPRESSION_LIMIT: usize = 4 * 1024 * 1024;

/// Ошибку разбора показываем человеку, а не в лог.
///
/// Первая строка сообщения крейта — самая толковая; дальше идёт схема
/// с подчёркиванием, которая в однострочном поле выглядит кашей.
fn describe(error: regex::Error) -> String {
    let text = error.to_string();
    let first = text.lines().next().unwrap_or("выражение не разобрано");
    format!("выражение не разобрано: {}", first.trim_end_matches(':'))
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

/// Все вхождения точного текста по порядку.
///
/// Пустой запрос не находит ничего: «заменить пустоту на что-нибудь» — это
/// вставка в каждую позицию файла, чего никто не имеет в виду.
fn find_literal(text: &str, needle: &str, options: Options) -> Vec<Found> {
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
            text[from..].char_indices().find_map(|(at, _)| {
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

    let body = line_text(text, offset);
    (line, cut(body, limit))
}

/// Строка целиком, без переносов по краям.
pub fn line_text(text: &str, offset: usize) -> &str {
    let start = text[..offset].rfind('\n').map_or(0, |at| at + 1);
    let end = text[offset..].find('\n').map_or(text.len(), |at| offset + at);

    text[start..end].trim_matches(['\r', ' ', '\t'])
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

    fn expression() -> Options {
        Options {
            expression: true,
            ..Options::default()
        }
    }

    fn matcher(query: &str, options: Options) -> Matcher {
        Matcher::build(query, options).expect("выражение не собралось")
    }

    fn offsets(text: &str, query: &str, options: Options) -> Vec<usize> {
        matcher(query, options)
            .find_all(text)
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
        let found = matcher("гдеж", plain()).find_all("абв гдеж");
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
            ..plain()
        };
        assert_eq!(offsets(text, "план", options), vec![text.rfind("план").unwrap()]);
    }

    /// Длина найденного берётся у текста, а не у запроса.
    #[test]
    fn length_comes_from_the_text() {
        let found = matcher("план", plain()).find_all("ПЛАН");
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
            whole_word: true,
            ..plain()
        };
        assert_eq!(offsets("план и планы", "план", options), vec![0]);
    }

    /// Границы слова знают про кириллицу: «планы» — не «план».
    #[test]
    fn whole_word_counts_letters_not_ascii() {
        let options = Options {
            whole_word: true,
            ..plain()
        };
        assert!(offsets("планы", "план", options).is_empty());
        assert_eq!(offsets("(план)", "план", options), vec![1]);
    }

    #[test]
    fn empty_query_finds_nothing() {
        assert!(matcher("", plain()).find_all("текст").is_empty());
    }

    #[test]
    fn expression_finds_by_pattern() {
        let text = "fn первая() {}\nfn вторая() {}\n";
        let found = matcher(r"fn \w+\(\)", expression()).find_all(text);

        assert_eq!(found.len(), 2);
        assert_eq!(&text[found[0].offset..found[0].offset + found[0].len], "fn первая()");
    }

    /// `\w` и `\b` знают про кириллицу: иначе выражение было бы бесполезно
    /// ровно там, где им собираются пользоваться.
    #[test]
    fn expression_knows_cyrillic() {
        assert_eq!(offsets("слово другое", r"\bдругое\b", expression()), vec![11]);
        assert_eq!(offsets("абв", r"^\w+$", expression()), vec![0]);
    }

    /// Регистр у выражения слушается того же переключателя.
    #[test]
    fn expression_respects_case() {
        let strict = Options {
            match_case: true,
            ..expression()
        };
        assert!(offsets("План", "план", strict).is_empty());
        assert_eq!(offsets("План", "план", expression()), vec![0]);
    }

    /// «Слово целиком» оборачивает выражение целиком, а не каждую ветку.
    #[test]
    fn whole_word_wraps_the_whole_expression() {
        let options = Options {
            whole_word: true,
            ..expression()
        };
        assert!(offsets("планы", "план|дело", options).is_empty());
        assert_eq!(offsets("дело", "план|дело", options), vec![0]);
    }

    /// Пустое совпадение не считается совпадением: `a*` находит пустоту
    /// в каждой позиции, и замена такого — вставка между каждой парой букв.
    #[test]
    fn empty_matches_are_skipped() {
        assert!(matcher("a*", expression()).find_all("ббб").is_empty());
        assert_eq!(offsets("ааб", "a*", expression()), Vec::<usize>::new());
        assert_eq!(offsets("aab", "a*", expression()), vec![0]);
    }

    /// Ошибка в выражении — ответ словами, а не паника.
    #[test]
    fn broken_expression_is_explained() {
        let error = Matcher::build("(незакрытая", expression()).unwrap_err();
        assert!(error.starts_with("выражение не разобрано"), "{error}");
    }

    /// Выражение, разворачивающееся в огромный автомат, тоже отвергается.
    #[test]
    fn oversized_expression_is_refused() {
        assert!(Matcher::build("(a{1000}){1000}", expression()).is_err());
    }

    #[test]
    fn literal_replacement_goes_in_as_written() {
        let edits = matcher("план", plain()).edits("план", "$1 и всё");
        assert_eq!(edits[0].becomes, "$1 и всё", "у точного текста $1 — это знаки");
    }

    /// Ради этого выражение в замене обычно и нужно: переставить куски.
    #[test]
    fn expression_replacement_expands_groups() {
        let edits = matcher(r"(\w+)=(\w+)", expression()).edits("ключ=значение", "$2=$1");

        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].was, "ключ=значение");
        assert_eq!(edits[0].becomes, "значение=ключ");
    }

    /// Пустых правок не бывает и в замене: иначе `a*` вставил бы замену
    /// между каждой парой букв файла.
    #[test]
    fn expression_replacement_skips_empty_matches() {
        assert!(matcher("a*", expression()).edits("ббб", "!").is_empty());
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
