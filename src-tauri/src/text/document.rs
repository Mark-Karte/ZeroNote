//! Модель прочитанного документа: байты в текст и обратно.
//!
//! Здесь сходятся инварианты 1 и 5. Главное свойство, которое обязано
//! выполняться и проверяется тестами: **прочитать и записать обратно —
//! получить те же самые байты**, если содержимое не менялось.

use super::detect::{self, DetectError};
use super::encoding::{self, EncodeError, Encoding};
use super::eol::{self, Eol, EolInfo};

/// Раскодированный документ вместе со всем, что нужно, чтобы записать его
/// обратно без изменений.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextDocument {
    /// Текст с переводами строк `\n` — внутреннее представление буфера.
    pub text: String,
    pub encoding: Encoding,
    /// В исходном файле была метка порядка байтов.
    pub bom: bool,
    pub eol: EolInfo,
    /// Кодировка определена по метке или строгой проверкой, а не эвристикой.
    pub encoding_confident: bool,
    /// В байтах были последовательности, недопустимые в этой кодировке.
    ///
    /// Запись такого документа исходной кодировкой уже не восстановит байты.
    /// Пользователь обязан об этом узнать до сохранения — иначе мы молча
    /// испортим чужой файл.
    pub lossy: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    Detect(DetectError),
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReadError::Detect(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ReadError {}

/// Прочитать байты, определив кодировку.
pub fn read(bytes: &[u8]) -> Result<TextDocument, ReadError> {
    let detection = detect::detect(bytes).map_err(ReadError::Detect)?;
    Ok(decode_with(
        bytes,
        detection.encoding,
        detection.bom,
        detection.confident,
    ))
}

/// Прочитать те же байты другой кодировкой — операция «интерпретировать как».
///
/// Это одна из двух разных операций со сменой кодировки. Вторая — «преобразовать
/// в», она текст не трогает, а меняет только кодировку записи, и делается просто
/// подменой поля `encoding`. Путать их нельзя: первая лечит крякозябры и
/// оставляет буфер чистым, вторая меняет файл и делает буфер изменённым.
pub fn reinterpret(bytes: &[u8], encoding: Encoding) -> TextDocument {
    // Метка порядка байтов имеет смысл только у тех кодировок, у которых
    // она бывает, и только если она действительно есть в этих байтах.
    let bom_bytes = encoding.bom_bytes();
    let bom = !bom_bytes.is_empty() && bytes.starts_with(bom_bytes);

    decode_with(bytes, encoding, bom, true)
}

fn decode_with(bytes: &[u8], encoding: Encoding, bom: bool, confident: bool) -> TextDocument {
    let body = if bom {
        &bytes[encoding.bom_bytes().len()..]
    } else {
        bytes
    };

    let decoded = encoding::decode(body, encoding);

    // Переносы считаем по раскодированному тексту, до приведения к `\n`.
    let eol = eol::detect(&decoded.text);
    let text = eol::to_lf(&decoded.text);

    TextDocument {
        text,
        encoding,
        bom,
        eol,
        encoding_confident: confident,
        lossy: decoded.lossy,
    }
}

/// Собрать байты для записи.
///
/// Тип переноса передаётся отдельно, а не берётся из `EolInfo`, намеренно:
/// у файла со смешанными переносами единственно верного ответа нет, и выбор
/// обязан быть сделан явно — вызывающим кодом или пользователем.
pub fn to_bytes(
    text: &str,
    encoding: Encoding,
    bom: bool,
    line_ending: Eol,
) -> Result<Vec<u8>, EncodeError> {
    let unfolded = eol::from_lf(text, line_ending);
    let body = encoding::encode(&unfolded, encoding)?;

    if !bom {
        return Ok(body);
    }

    let prefix = encoding.bom_bytes();
    let mut out = Vec::with_capacity(prefix.len() + body.len());
    out.extend_from_slice(prefix);
    out.extend_from_slice(&body);
    Ok(out)
}

/// Записать документ обратно ровно так, как он был прочитан.
///
/// Работает только для файлов без смешанных переносов: для смешанных
/// однозначного ответа нет, см. `to_bytes`.
pub fn to_bytes_as_read(document: &TextDocument) -> Result<Vec<u8>, EncodeError> {
    to_bytes(
        &document.text,
        document.encoding,
        document.bom,
        document.eol.dominant,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUSSIAN: &str = "Съешь же ещё этих мягких французских булок.";

    /// Набор образцов, покрывающий инвариант 1: кодировка, метка порядка
    /// байтов, тип переносов, наличие финального перевода строки.
    fn samples() -> Vec<(String, Vec<u8>)> {
        let mut out = Vec::new();

        for encoding in [
            Encoding::Utf8,
            Encoding::Utf16Le,
            Encoding::Utf16Be,
            Encoding::Windows1251,
            Encoding::Ibm866,
            Encoding::Koi8R,
        ] {
            for bom in [false, true] {
                if bom && encoding.bom_bytes().is_empty() {
                    continue;
                }
                for (eol_name, eol_str) in [("CRLF", "\r\n"), ("LF", "\n"), ("CR", "\r")] {
                    for final_newline in [false, true] {
                        let mut text =
                            format!("{RUSSIAN}{eol_str}вторая строка{eol_str}третья");
                        if final_newline {
                            text.push_str(eol_str);
                        }

                        let mut bytes = encoding.bom_bytes().to_vec();
                        if !bom {
                            bytes.clear();
                        }
                        bytes.extend_from_slice(
                            &encoding::encode(&text, encoding).expect("образец должен кодироваться"),
                        );

                        let name = format!(
                            "{} bom={bom} {eol_name} финальный-перевод={final_newline}",
                            encoding.label()
                        );
                        out.push((name, bytes));
                    }
                }
            }
        }

        out
    }

    /// Главный тест инварианта 1: прочитали — записали — байты те же.
    #[test]
    fn read_then_write_is_byte_identical() {
        for (name, original) in samples() {
            let document = read(&original).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert!(!document.lossy, "{name}: чтение оказалось с потерями");
            assert!(
                !document.eol.mixed,
                "{name}: образец не должен быть смешанным"
            );

            let written =
                to_bytes_as_read(&document).unwrap_or_else(|e| panic!("{name}: {e}"));

            assert_eq!(written, original, "{name}: байты разошлись");
        }
    }

    /// Frontmatter — обычный текст, и он обязан пережить обход без изменений.
    /// Отдельным тестом, потому что это названо в инварианте 1 явно.
    #[test]
    fn frontmatter_is_untouched() {
        let source = "---\r\ntitle: Заметка\r\ntags: [дом, дела]\r\n---\r\n\r\nТекст.\r\n";
        let original = source.as_bytes().to_vec();

        let document = read(&original).unwrap();
        assert_eq!(document.text, source.replace("\r\n", "\n"));

        assert_eq!(to_bytes_as_read(&document).unwrap(), original);
    }

    /// Отсутствие финального перевода строки не должно «чиниться» само.
    #[test]
    fn missing_final_newline_is_not_added() {
        let original = "последняя строка без перевода".as_bytes().to_vec();

        let document = read(&original).unwrap();
        assert!(!document.text.ends_with('\n'));
        assert_eq!(to_bytes_as_read(&document).unwrap(), original);
    }

    /// И наоборот: лишний пустой хвост не должен обрезаться.
    #[test]
    fn trailing_blank_line_is_not_trimmed() {
        let original = "строка\r\n\r\n".as_bytes().to_vec();

        let document = read(&original).unwrap();
        assert_eq!(to_bytes_as_read(&document).unwrap(), original);
    }

    /// Пустой файл остаётся пустым, а не приобретает перевод строки.
    #[test]
    fn empty_file_stays_empty() {
        let document = read(b"").unwrap();
        assert_eq!(document.text, "");
        assert_eq!(to_bytes_as_read(&document).unwrap(), Vec::<u8>::new());
    }

    /// Файл только с меткой порядка байтов и без содержимого.
    #[test]
    fn bom_only_file_keeps_its_bom() {
        let original = Encoding::Utf8.bom_bytes().to_vec();

        let document = read(&original).unwrap();
        assert!(document.bom);
        assert_eq!(document.text, "");
        assert_eq!(to_bytes_as_read(&document).unwrap(), original);
    }

    /// Смешанные переносы: файл читается, факт смешения виден, а решение
    /// о приведении к одному типу остаётся снаружи.
    #[test]
    fn mixed_line_endings_are_reported_not_silently_normalized() {
        let document = read("a\r\nb\nc\r\nd\n".as_bytes()).unwrap();

        assert!(document.eol.mixed);
        assert_eq!(document.eol.dominant, Eol::CrLf);
        assert_eq!(document.eol.crlf, 2);
        assert_eq!(document.eol.lf, 2);
    }

    /// «Интерпретировать как»: те же байты, другая кодировка, буфер чистый.
    #[test]
    fn reinterpret_reads_same_bytes_differently() {
        let bytes = encoding::encode(RUSSIAN, Encoding::Windows1251).unwrap();

        // Прочитанное как KOI8-R даст не тот текст — и это правильно,
        // ровно так пользователь и увидит, что кодировка выбрана неверно.
        let wrong = reinterpret(&bytes, Encoding::Koi8R);
        assert_ne!(wrong.text, RUSSIAN);

        // А обратный выбор возвращает исходный текст.
        let right = reinterpret(&bytes, Encoding::Windows1251);
        assert_eq!(right.text, RUSSIAN);
    }

    /// «Преобразовать в»: текст тот же, байты другие, обратное чтение сходится.
    #[test]
    fn convert_to_another_encoding_keeps_text() {
        let original = encoding::encode(RUSSIAN, Encoding::Windows1251).unwrap();
        let document = read(&original).unwrap();

        let converted = to_bytes(&document.text, Encoding::Utf8, false, Eol::CrLf).unwrap();
        assert_ne!(converted, original);

        assert_eq!(read(&converted).unwrap().text, RUSSIAN);
    }

    /// Метка порядка байтов не должна попадать в текст как символ U+FEFF.
    #[test]
    fn bom_does_not_leak_into_text() {
        let mut bytes = Encoding::Utf8.bom_bytes().to_vec();
        bytes.extend_from_slice(RUSSIAN.as_bytes());

        let document = read(&bytes).unwrap();
        assert_eq!(document.text, RUSSIAN);
        assert!(!document.text.starts_with('\u{FEFF}'));
    }
}
