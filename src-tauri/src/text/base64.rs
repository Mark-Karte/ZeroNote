//! Кодирование в base64.
//!
//! Нужно ровно для одного: отдать картинку окну адресом `data:` (Р-182).
//! Политика безопасности окна не менялась с первого этапа, `img-src` в ней
//! разрешает `'self'` и `data:` — значит, байты доезжают до `<img>` строкой,
//! а строка эта по определению base64.
//!
//! Своими руками, а не крейтом: здесь двадцать строк и полторы операции,
//! а у любой библиотеки base64 — ещё и декодирование, потоковый режим,
//! четыре алфавита и `no_std`. Это ровно тот случай, о котором сказано
//! в правилах: библиотека решает малую часть задачи, а весит как целая.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Классический base64 с выравниванием `=` — тот, который понимает `data:`.
pub fn encode(bytes: &[u8]) -> String {
    // Ёмкость считаем сразу: перевыделение на десяти мегабайтах — это
    // несколько лишних копирований всего буфера.
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        // Три байта укладываются в 24 бита и режутся на четыре шестёрки.
        // Недостающие байты считаются нулями, а их места в выводе занимает
        // знак выравнивания.
        let first = u32::from(chunk[0]);
        let second = u32::from(chunk.get(1).copied().unwrap_or(0));
        let third = u32::from(chunk.get(2).copied().unwrap_or(0));
        let triple = (first << 16) | (second << 8) | third;

        out.push(ALPHABET[((triple >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[((triple >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(triple & 63) as usize] as char
        } else {
            '='
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Примеры из RFC 4648: они закрывают все три остатка от деления на три.
    #[test]
    fn matches_the_standard_examples() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert_eq!(encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
    }

    /// Двоичные байты, а не текст: у картинки их и не бывает текстом.
    /// Проверяются края алфавита — `+` и `/` получаются только здесь.
    #[test]
    fn encodes_raw_bytes() {
        assert_eq!(encode(&[0x00, 0x00, 0x00]), "AAAA");
        assert_eq!(encode(&[0xff, 0xff, 0xff]), "////");
        assert_eq!(encode(&[0xfb, 0xff, 0xbf]), "+/+/");
        // Первые восемь байт файла PNG — его подпись.
        assert_eq!(
            encode(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            "iVBORw0KGgo="
        );
    }

    /// Длина вывода — четыре знака на каждые три байта, вверх до целого.
    #[test]
    fn length_is_predictable() {
        for len in 0..64usize {
            let bytes = vec![0xa5; len];
            assert_eq!(encode(&bytes).len(), len.div_ceil(3) * 4, "длина {len}");
        }
    }
}
