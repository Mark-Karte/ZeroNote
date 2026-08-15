//! Тип переноса строк — часть модели буфера, наравне с кодировкой.
//!
//! Внутри буфера текст всегда с одним переводом строки (`\n`): этого требует
//! CodeMirror, да и любая работа с текстом от этого проще. Исходный тип
//! запоминается и возвращается на место при записи, поэтому для файла ничего
//! не меняется.

/// Тип переноса строк.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Eol {
    /// `\n` — Unix, и внутреннее представление буфера.
    Lf,
    /// `\r\n` — Windows.
    CrLf,
    /// `\r` — классическая Mac OS. Встречается редко, но встречается.
    Cr,
}

impl Eol {
    pub fn as_str(self) -> &'static str {
        match self {
            Eol::Lf => "\n",
            Eol::CrLf => "\r\n",
            Eol::Cr => "\r",
        }
    }

    /// Имя для строки состояния.
    pub fn label(self) -> &'static str {
        match self {
            Eol::Lf => "LF",
            Eol::CrLf => "CRLF",
            Eol::Cr => "CR",
        }
    }
}

/// Что нашлось в файле.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EolInfo {
    /// Преобладающий тип. Им же записывается файл обратно.
    pub dominant: Eol,
    /// В файле больше одного типа переносов.
    ///
    /// Это важный признак: такой файл нельзя переписать байт в байт после
    /// правки, потому что внутри буфера все переносы одинаковы. Поэтому
    /// смешанные переносы показываются пользователю, а решение о приведении
    /// к одному типу остаётся за ним (см. DESIGN.md, решение Р-018).
    pub mixed: bool,
    pub crlf: usize,
    pub lf: usize,
    pub cr: usize,
}

/// Тип переноса для нового пустого буфера.
///
/// Приложение под Windows, значит CRLF. К уже существующим файлам это
/// отношения не имеет: у них тип берётся из содержимого.
pub const DEFAULT: Eol = Eol::CrLf;

/// Подсчитать переносы в раскодированном тексте.
///
/// Считать надо именно по тексту, а не по байтам: в UTF-16 перевод строки
/// занимает два байта, и побайтовый поиск `\n` нашёл бы его не там.
pub fn detect(text: &str) -> EolInfo {
    let mut crlf = 0usize;
    let mut lf = 0usize;
    let mut cr = 0usize;

    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' => {
                if bytes.get(i + 1) == Some(&b'\n') {
                    crlf += 1;
                    i += 2;
                    continue;
                }
                cr += 1;
            }
            b'\n' => lf += 1,
            _ => {}
        }
        i += 1;
    }

    // Переносов может не быть вовсе — тогда сохранять нечего и берётся
    // умолчание платформы.
    let dominant = if crlf == 0 && lf == 0 && cr == 0 {
        DEFAULT
    } else if crlf >= lf && crlf >= cr {
        Eol::CrLf
    } else if lf >= cr {
        Eol::Lf
    } else {
        Eol::Cr
    };

    let kinds = usize::from(crlf > 0) + usize::from(lf > 0) + usize::from(cr > 0);

    EolInfo {
        dominant,
        mixed: kinds > 1,
        crlf,
        lf,
        cr,
    }
}

/// Привести все переносы к `\n` — внутреннее представление буфера.
pub fn to_lf(text: &str) -> String {
    // Порядок важен: сначала пары, иначе `\r\n` превратится в два перевода.
    if !text.contains('\r') {
        // Самый частый случай: копировать строку незачем.
        return text.to_owned();
    }
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// Развернуть обратно: из внутреннего `\n` в тип файла.
///
/// Текст обязан быть уже приведён к `\n` — иначе получится `\r\r\n`.
pub fn from_lf(text: &str, eol: Eol) -> String {
    match eol {
        Eol::Lf => text.to_owned(),
        Eol::CrLf => text.replace('\n', "\r\n"),
        Eol::Cr => text.replace('\n', "\r"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_each_kind() {
        assert_eq!(detect("а\r\nб\r\nв").dominant, Eol::CrLf);
        assert_eq!(detect("а\nб\nв").dominant, Eol::Lf);
        assert_eq!(detect("а\rб\rв").dominant, Eol::Cr);
    }

    #[test]
    fn counts_are_exact() {
        let info = detect("a\r\nb\nc\rd\r\n");
        assert_eq!(info.crlf, 2);
        assert_eq!(info.lf, 1);
        assert_eq!(info.cr, 1);
        assert!(info.mixed);
    }

    /// Один тип переносов — это не «смешанные», сколько бы их ни было.
    #[test]
    fn single_kind_is_not_mixed() {
        assert!(!detect("a\r\nb\r\nc\r\n").mixed);
        assert!(!detect("a\nb\nc\n").mixed);
    }

    /// Файл без переносов: сохранять нечего, берётся умолчание платформы.
    #[test]
    fn file_without_line_breaks_uses_platform_default() {
        let info = detect("одна строка без перевода");
        assert_eq!(info.dominant, DEFAULT);
        assert!(!info.mixed);
    }

    /// Одинокий `\r` в самом конце — это CR, а не половина CRLF.
    #[test]
    fn trailing_cr_is_not_half_of_crlf() {
        let info = detect("a\r");
        assert_eq!(info.cr, 1);
        assert_eq!(info.crlf, 0);
    }

    /// Основное свойство: развернуть и свернуть обратно — получить исходное.
    #[test]
    fn round_trip_through_internal_form() {
        for (source, eol) in [
            ("а\r\nб\r\nв\r\n", Eol::CrLf),
            ("а\nб\nв\n", Eol::Lf),
            ("а\rб\rв\r", Eol::Cr),
            ("", Eol::CrLf),
            ("без переносов", Eol::Lf),
        ] {
            assert_eq!(from_lf(&to_lf(source), eol), source, "тип {}", eol.label());
        }
    }

    /// Свёртка не должна порождать `\r\r\n` из уже готового CRLF.
    #[test]
    fn crlf_does_not_become_cr_cr_lf() {
        assert_eq!(to_lf("a\r\nb"), "a\nb");
        assert_eq!(from_lf("a\nb", Eol::CrLf), "a\r\nb");
    }

    /// Финальный перевод строки — часть текста, и он не теряется и не
    /// добавляется сам. Это прямая часть инварианта 1.
    #[test]
    fn final_newline_is_preserved_both_ways() {
        assert_eq!(from_lf(&to_lf("a\r\n"), Eol::CrLf), "a\r\n");
        assert_eq!(from_lf(&to_lf("a"), Eol::CrLf), "a");
        assert!(!from_lf(&to_lf("a"), Eol::CrLf).ends_with('\n'));
    }
}
