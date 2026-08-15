//! Кодировки как часть модели буфера (инвариант 5).
//!
//! Файл читается как байты. Кодировка определяется, запоминается на буфере
//! и используется при записи. Ни одно преобразование не происходит само:
//! что прочитали в такой-то кодировке, то в ней же и запишем.

/// Кодировки, которые приложение умеет читать и писать.
///
/// Набор намеренно небольшой: это то, что реально встречается в файлах
/// русскоязычного разработчика на Windows. Расширять — по мере надобности,
/// добавление сводится к строке здесь и строке в таблице ниже.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
    Windows1251,
    Windows1252,
    Ibm866,
    Koi8R,
}

impl Encoding {
    /// Соответствующая реализация из `encoding_rs`.
    fn codec(self) -> &'static encoding_rs::Encoding {
        match self {
            Encoding::Utf8 => encoding_rs::UTF_8,
            Encoding::Utf16Le => encoding_rs::UTF_16LE,
            Encoding::Utf16Be => encoding_rs::UTF_16BE,
            Encoding::Windows1251 => encoding_rs::WINDOWS_1251,
            Encoding::Windows1252 => encoding_rs::WINDOWS_1252,
            Encoding::Ibm866 => encoding_rs::IBM866,
            Encoding::Koi8R => encoding_rs::KOI8_R,
        }
    }

    /// Имя для строки состояния и для файла сессии.
    pub fn label(self) -> &'static str {
        match self {
            Encoding::Utf8 => "UTF-8",
            Encoding::Utf16Le => "UTF-16 LE",
            Encoding::Utf16Be => "UTF-16 BE",
            Encoding::Windows1251 => "windows-1251",
            Encoding::Windows1252 => "windows-1252",
            Encoding::Ibm866 => "IBM866",
            Encoding::Koi8R => "KOI8-R",
        }
    }

    /// Все кодировки — для меню ручной смены.
    pub fn all() -> &'static [Encoding] {
        &[
            Encoding::Utf8,
            Encoding::Utf16Le,
            Encoding::Utf16Be,
            Encoding::Windows1251,
            Encoding::Windows1252,
            Encoding::Ibm866,
            Encoding::Koi8R,
        ]
    }

    /// Байты метки порядка байтов для этой кодировки.
    pub fn bom_bytes(self) -> &'static [u8] {
        match self {
            Encoding::Utf8 => &[0xEF, 0xBB, 0xBF],
            Encoding::Utf16Le => &[0xFF, 0xFE],
            Encoding::Utf16Be => &[0xFE, 0xFF],
            // У однобайтовых кодировок метки не бывает.
            _ => &[],
        }
    }
}

/// Результат раскодирования.
pub struct Decoded {
    pub text: String,
    /// `true` — во входных байтах были последовательности, недопустимые в этой
    /// кодировке, и они заменены на U+FFFD. Обратная запись байт в байт уже
    /// невозможна, и об этом обязан узнать пользователь: молча испортить чужой
    /// файл — прямое нарушение инварианта 1.
    pub lossy: bool,
}

/// Раскодировать байты заданной кодировкой.
///
/// Метка порядка байтов, если она есть, должна быть срезана вызывающим кодом:
/// эта функция работает ровно с тем, что ей дали.
pub fn decode(bytes: &[u8], encoding: Encoding) -> Decoded {
    let (text, lossy) = encoding
        .codec()
        .decode_without_bom_handling(bytes);

    Decoded {
        text: text.into_owned(),
        lossy,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncodeError {
    /// В тексте есть символы, которых нет в целевой кодировке.
    /// Записывать с потерями молча нельзя — пользователь должен решить сам.
    Unmappable { encoding: Encoding, sample: String },
}

impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EncodeError::Unmappable { encoding, sample } => write!(
                f,
                "текст не записывается в {}: нет символа {sample}",
                encoding.label()
            ),
        }
    }
}

impl std::error::Error for EncodeError {}

/// Закодировать текст в заданную кодировку.
///
/// Метка порядка байтов не добавляется — этим занимается `document.rs`,
/// который знает, была ли она в исходном файле.
pub fn encode(text: &str, encoding: Encoding) -> Result<Vec<u8>, EncodeError> {
    // UTF-16 в encoding_rs кодировать нельзя (стандарт кодирования этого
    // не предусматривает), поэтому делаем это вручную. Заодно это проще,
    // чем кажется: UTF-16 — это просто последовательность 16-битных единиц.
    match encoding {
        Encoding::Utf16Le | Encoding::Utf16Be => {
            let mut out = Vec::with_capacity(text.len() * 2);
            for unit in text.encode_utf16() {
                let pair = if encoding == Encoding::Utf16Le {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                };
                out.extend_from_slice(&pair);
            }
            Ok(out)
        }
        _ => {
            let (bytes, _, had_unmappable) = encoding.codec().encode(text);
            if had_unmappable {
                // Найдём первый непереводимый символ, чтобы сообщение было
                // предметным, а не «что-то не так».
                let sample = text
                    .chars()
                    .find(|c| {
                        let (_, _, bad) = encoding.codec().encode(&c.to_string());
                        bad
                    })
                    .map(|c| format!("«{c}» (U+{:04X})", c as u32))
                    .unwrap_or_else(|| "неизвестный".to_owned());

                return Err(EncodeError::Unmappable { encoding, sample });
            }
            Ok(bytes.into_owned())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUSSIAN: &str = "Съешь же ещё этих мягких французских булок, да выпей чаю.";

    /// Основное свойство: что закодировали, то и раскодируем обратно.
    #[test]
    fn round_trip_through_every_encoding() {
        for &encoding in Encoding::all() {
            let text = match encoding {
                // В западноевропейской кодировке русского текста быть не может.
                Encoding::Windows1252 => "Voilà, ça marche — déjà vu!",
                _ => RUSSIAN,
            };

            let bytes = encode(text, encoding)
                .unwrap_or_else(|e| panic!("{}: {e}", encoding.label()));
            let decoded = decode(&bytes, encoding);

            assert_eq!(decoded.text, text, "кодировка {}", encoding.label());
            assert!(!decoded.lossy, "кодировка {}", encoding.label());
        }
    }

    /// Однобайтовые кодировки обязаны укладываться в один байт на букву —
    /// иначе мы что-то перепутали с кодеком.
    #[test]
    fn single_byte_encodings_are_single_byte() {
        for &encoding in &[
            Encoding::Windows1251,
            Encoding::Ibm866,
            Encoding::Koi8R,
        ] {
            let bytes = encode(RUSSIAN, encoding).unwrap();
            assert_eq!(
                bytes.len(),
                RUSSIAN.chars().count(),
                "кодировка {}",
                encoding.label()
            );
        }
    }

    /// Символ, которого нет в целевой кодировке, — это ошибка с внятным
    /// сообщением, а не тихая замена на вопросительный знак.
    #[test]
    fn unmappable_character_is_an_error_not_a_silent_loss() {
        let error = encode("температура 20 ℃ и эмодзи 🙂", Encoding::Windows1251)
            .expect_err("должна быть ошибка");

        let message = error.to_string();
        assert!(
            message.contains("windows-1251"),
            "сообщение должно называть кодировку: {message}"
        );
    }

    /// Непонятные байты не роняют чтение, но помечают результат как испорченный.
    #[test]
    fn invalid_bytes_are_flagged_as_lossy() {
        // 0xFF недопустим в UTF-8 ни в какой позиции.
        let decoded = decode(&[0xD0, 0x9F, 0xFF, 0xD1, 0x80], Encoding::Utf8);

        assert!(decoded.lossy, "порча должна быть замечена");
        assert!(decoded.text.contains('\u{FFFD}'));
    }

    /// UTF-16 кодируется руками, поэтому порядок байтов проверяем явно.
    #[test]
    fn utf16_byte_order_is_correct() {
        assert_eq!(encode("A", Encoding::Utf16Le).unwrap(), vec![0x41, 0x00]);
        assert_eq!(encode("A", Encoding::Utf16Be).unwrap(), vec![0x00, 0x41]);
    }

    /// Символы за пределами основной плоскости кодируются суррогатной парой.
    #[test]
    fn utf16_handles_surrogate_pairs() {
        let emoji = "🙂";
        let bytes = encode(emoji, Encoding::Utf16Le).unwrap();

        assert_eq!(bytes.len(), 4, "нужна суррогатная пара");
        assert_eq!(decode(&bytes, Encoding::Utf16Le).text, emoji);
    }
}
