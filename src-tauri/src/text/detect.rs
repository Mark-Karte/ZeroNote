//! Определение кодировки.
//!
//! Своя реализация вместо крейта `chardetng` — сознательное решение (см.
//! DESIGN.md, раздел «Зависимости»). Задача уже: не «любая письменность мира»,
//! а «то, что лежит на диске у русскоязычного разработчика под Windows».
//!
//! Порядок ровно такой и никакой другой:
//!
//! 1. **Метка порядка байтов.** Если она есть — вопрос закрыт, гадать нельзя.
//! 2. **Годный UTF-8.** Проверяется строго; случайный однобайтовый текст
//!    почти никогда не оказывается годным UTF-8, так что ложных срабатываний
//!    практически нет.
//! 3. **UTF-16 без метки.** Узнаётся по нулевым байтам через один.
//! 4. **Однобайтовые.** Кандидаты раскодируются и оцениваются по тому,
//!    насколько результат похож на осмысленный текст.

use super::encoding::{decode, Encoding};

/// Сколько байтов от начала файла достаточно для решения.
///
/// Смотреть весь файл незачем: 256 КиБ — это тысячи строк текста, а на файле
/// в 50 МБ полный проход был бы заметен на глаз при открытии.
const SAMPLE_LIMIT: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Detection {
    pub encoding: Encoding,
    /// В файле была метка порядка байтов. При записи её надо вернуть на место.
    pub bom: bool,
    /// `false` — кодировка выбрана эвристикой и может быть неверной.
    /// Повод показать её в строке состояния поспокойнее и не удивляться,
    /// если пользователь переключит вручную.
    pub confident: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectError {
    /// UTF-32 распознан по метке, но не поддерживается. Молчать нельзя:
    /// без метки эти байты были бы приняты за UTF-16 и превратились в кашу.
    Utf32NotSupported,
}

impl std::fmt::Display for DetectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DetectError::Utf32NotSupported => {
                write!(f, "кодировка UTF-32 пока не поддерживается")
            }
        }
    }
}

impl std::error::Error for DetectError {}

pub fn detect(bytes: &[u8]) -> Result<Detection, DetectError> {
    if let Some(detection) = detect_by_bom(bytes)? {
        return Ok(detection);
    }

    let sample = &bytes[..bytes.len().min(SAMPLE_LIMIT)];

    // UTF-16 без метки проверяется ДО всего остального, и это не мелочь.
    // Кириллица в UTF-16LE — это байты вида 0x21 0x04, оба меньше 0x80.
    // Проверь мы сначала «весь файл в пределах ASCII», такой файл прошёл бы
    // за UTF-8 и превратился в кашу из управляющих символов.
    if let Some(encoding) = detect_utf16_without_bom(sample) {
        return Ok(Detection {
            encoding,
            bom: false,
            confident: false,
        });
    }

    // Пустой файл или чистый ASCII — записываем как UTF-8. Для чистого ASCII
    // это байт в байт то же самое, так что инвариант 1 не страдает.
    if sample.iter().all(|b| *b < 0x80) {
        return Ok(Detection {
            encoding: Encoding::Utf8,
            bom: false,
            confident: true,
        });
    }

    if is_valid_utf8(sample, bytes.len() > SAMPLE_LIMIT) {
        return Ok(Detection {
            encoding: Encoding::Utf8,
            bom: false,
            confident: true,
        });
    }

    Ok(Detection {
        encoding: pick_single_byte(sample),
        bom: false,
        confident: false,
    })
}

fn detect_by_bom(bytes: &[u8]) -> Result<Option<Detection>, DetectError> {
    // Порядок проверок важен: метка UTF-32LE начинается с метки UTF-16LE,
    // и если проверить UTF-16 первым, файл UTF-32 превратится в мусор.
    if bytes.starts_with(&[0xFF, 0xFE, 0x00, 0x00]) || bytes.starts_with(&[0x00, 0x00, 0xFE, 0xFF])
    {
        return Err(DetectError::Utf32NotSupported);
    }

    let found = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        Some(Encoding::Utf8)
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        Some(Encoding::Utf16Le)
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        Some(Encoding::Utf16Be)
    } else {
        None
    };

    Ok(found.map(|encoding| Detection {
        encoding,
        bom: true,
        confident: true,
    }))
}

/// Проверка на годный UTF-8.
///
/// `truncated` говорит, что образец обрезан по размеру: тогда оборванная
/// многобайтовая последовательность в самом конце — не порча файла, а край
/// образца, и ошибкой считаться не должна.
fn is_valid_utf8(sample: &[u8], truncated: bool) -> bool {
    match std::str::from_utf8(sample) {
        Ok(_) => true,
        Err(e) => {
            if !truncated || e.error_len().is_some() {
                // error_len() = Some означает настоящую ошибку, а не обрыв.
                return false;
            }
            // Обрыв на границе образца: всё до него годное — этого достаточно.
            e.valid_up_to() + 4 >= sample.len()
        }
    }
}

/// Старший байт кодовой единицы UTF-16 для письменностей, которые нас
/// интересуют. U+0000..U+07FF — это латиница, кириллица, греческий, иврит,
/// арабский, то есть всё, что реально встретится. Старший байт там 0x00..0x07.
const UTF16_HIGH_BYTE_LIMIT: u8 = 0x08;

/// UTF-16 без метки.
///
/// Наивная проверка «много нулевых байтов через один» работает только для
/// латиницы: у кириллицы старший байт равен 0x04, а не нулю. Поэтому смотрим
/// шире — не на нули, а на то, что байты одной чётности почти все мелкие
/// (это старшие байты кодовых единиц), а другой чётности разнообразны.
///
/// Ограничение, принятое сознательно: файл в UTF-16 без метки, состоящий
/// в основном из иероглифов или эмодзи, так не опознается. Такие файлы почти
/// всегда идут с меткой, а без неё кодировку всегда можно выбрать вручную.
fn detect_utf16_without_bom(sample: &[u8]) -> Option<Encoding> {
    // На коротком образце такая статистика ничего не значит.
    if sample.len() < 16 {
        return None;
    }

    let pairs = sample.len() / 2;
    let mut low_at_even = 0usize;
    let mut low_at_odd = 0usize;

    for i in 0..pairs {
        if sample[i * 2] < UTF16_HIGH_BYTE_LIMIT {
            low_at_even += 1;
        }
        if sample[i * 2 + 1] < UTF16_HIGH_BYTE_LIMIT {
            low_at_odd += 1;
        }
    }

    // Почти все старшие байты мелкие, почти все младшие — нет.
    // Обычный однобайтовый текст под это не подходит: там мелких байтов
    // почти нет вовсе, ведь даже перевод строки это 0x0A.
    let mostly = pairs * 9 / 10;
    let rarely = pairs * 3 / 10;

    if low_at_odd >= mostly && low_at_even <= rarely {
        Some(Encoding::Utf16Le)
    } else if low_at_even >= mostly && low_at_odd <= rarely {
        Some(Encoding::Utf16Be)
    } else {
        None
    }
}

/// К какому разряду относится символ при оценке правдоподобия.
enum Kind {
    CyrillicLower,
    CyrillicUpper,
    LatinLetter,
    Punctuation,
    /// Псевдографика, управляющие символы диапазона C1 и прочее, чего
    /// в осмысленном тексте не бывает. Главный признак неверной догадки.
    Junk,
}

fn classify(c: char) -> Kind {
    match c {
        'а'..='я' | 'ё' => Kind::CyrillicLower,
        'А'..='Я' | 'Ё' => Kind::CyrillicUpper,
        // Управляющие C1: в тексте их не бывает, зато они щедро появляются
        // при неверно угаданной кодировке.
        '\u{80}'..='\u{9F}' => Kind::Junk,
        // Псевдографика и блочные элементы: подпись cp866, прочитанной
        // как что-то другое, и наоборот.
        '\u{2500}'..='\u{259F}' => Kind::Junk,
        '«' | '»' | '—' | '–' | '…' | '№' | '°' | '„' | '“' | '”' | '‘' | '’' | '·' | '€'
        | '§' | '©' | '®' | '±' | '\u{A0}' => Kind::Punctuation,
        _ if c.is_alphabetic() => Kind::LatinLetter,
        _ => Kind::Junk,
    }
}

/// Насколько правдоподобно, что байты записаны именно этой кодировкой.
fn score(sample: &[u8], encoding: Encoding) -> i64 {
    let decoded = decode(sample, encoding);
    if decoded.lossy {
        // В байтах есть то, чего в этой кодировке быть не может.
        return i64::MIN / 2;
    }

    let mut score = 0i64;
    let mut lower = 0i64;
    let mut upper = 0i64;

    for c in decoded.text.chars() {
        if c.is_ascii() {
            continue;
        }
        match classify(c) {
            Kind::CyrillicLower => {
                lower += 1;
                score += 3;
            }
            Kind::CyrillicUpper => {
                upper += 1;
                score += 1;
            }
            Kind::LatinLetter => score += 3,
            Kind::Punctuation => score += 1,
            Kind::Junk => score -= 8,
        }
    }

    // Настоящий текст в основном строчный. Перевес заглавных — почти верный
    // признак перепутанной кодировки: именно так выглядит KOI8-R, прочитанный
    // как windows-1251, и наоборот, потому что у них регистры зеркальны.
    if upper > lower {
        score -= (upper - lower) * 4;
    }

    score
}

fn pick_single_byte(sample: &[u8]) -> Encoding {
    const CANDIDATES: [Encoding; 4] = [
        Encoding::Windows1251,
        Encoding::Ibm866,
        Encoding::Koi8R,
        Encoding::Windows1252,
    ];

    // max_by_key берёт последний из равных, поэтому при ничьей побеждает
    // windows-1252. Нам нужно наоборот: при прочих равных на машине
    // русскоязычного пользователя вероятнее windows-1251, и она стоит первой.
    let mut best = CANDIDATES[0];
    let mut best_score = score(sample, CANDIDATES[0]);

    for &candidate in &CANDIDATES[1..] {
        let value = score(sample, candidate);
        if value > best_score {
            best = candidate;
            best_score = value;
        }
    }

    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::encoding::encode;

    const RUSSIAN: &str = concat!(
        "Съешь же ещё этих мягких французских булок, да выпей чаю. ",
        "Определение кодировки должно работать на обычном связном тексте, ",
        "а не только на подобранных примерах, поэтому здесь несколько строк ",
        "самого обыкновенного содержания про файлы, папки и переносы строк."
    );

    fn detected(bytes: &[u8]) -> Encoding {
        detect(bytes).expect("определение не должно падать").encoding
    }

    /// Метка порядка байтов — окончательный ответ, гадать поверх неё нельзя.
    #[test]
    fn bom_wins_over_everything() {
        let mut utf8 = Encoding::Utf8.bom_bytes().to_vec();
        utf8.extend_from_slice(RUSSIAN.as_bytes());
        let d = detect(&utf8).unwrap();
        assert_eq!(d.encoding, Encoding::Utf8);
        assert!(d.bom);
        assert!(d.confident);

        for encoding in [Encoding::Utf16Le, Encoding::Utf16Be] {
            let mut bytes = encoding.bom_bytes().to_vec();
            bytes.extend_from_slice(&encode(RUSSIAN, encoding).unwrap());
            let d = detect(&bytes).unwrap();
            assert_eq!(d.encoding, encoding);
            assert!(d.bom);
        }
    }

    /// UTF-8 без метки — самый частый случай, и он должен определяться уверенно.
    #[test]
    fn utf8_without_bom() {
        let d = detect(RUSSIAN.as_bytes()).unwrap();
        assert_eq!(d.encoding, Encoding::Utf8);
        assert!(!d.bom);
        assert!(d.confident);
    }

    /// Чистая латиница — это тоже UTF-8: обратная запись даст те же байты.
    #[test]
    fn pure_ascii_is_utf8() {
        let d = detect(b"fn main() {\r\n    println!(\"hi\");\r\n}\r\n").unwrap();
        assert_eq!(d.encoding, Encoding::Utf8);
        assert!(d.confident);
    }

    #[test]
    fn empty_file_is_utf8() {
        assert_eq!(detected(b""), Encoding::Utf8);
    }

    /// Главное, ради чего написана эвристика: русский текст в однобайтовых
    /// кодировках, каждый должен опознаваться в свою.
    #[test]
    fn russian_single_byte_encodings() {
        for encoding in [
            Encoding::Windows1251,
            Encoding::Ibm866,
            Encoding::Koi8R,
        ] {
            let bytes = encode(RUSSIAN, encoding).unwrap();
            assert_eq!(
                detected(&bytes),
                encoding,
                "текст в {} опознан неверно",
                encoding.label()
            );
        }
    }

    /// Западноевропейский текст не должен приниматься за русский.
    #[test]
    fn western_european_is_not_mistaken_for_russian() {
        let text = "Voilà, ça marche déjà! Über den Größen, año pasado, cañón.";
        let bytes = encode(text, Encoding::Windows1252).unwrap();
        assert_eq!(detected(&bytes), Encoding::Windows1252);
    }

    /// UTF-16 без метки: обычная ситуация для файлов из системных утилит.
    ///
    /// Кириллица здесь принципиальна: её кодовые единицы в UTF-16 состоят
    /// из байтов, каждый из которых меньше 0x80, и наивная проверка приняла бы
    /// такой файл за чистый ASCII.
    #[test]
    fn utf16_without_bom() {
        for encoding in [Encoding::Utf16Le, Encoding::Utf16Be] {
            for text in [RUSSIAN, "plain latin text without any cyrillic at all here"] {
                let bytes = encode(text, encoding).unwrap();
                assert_eq!(
                    detected(&bytes),
                    encoding,
                    "UTF-16 без метки опознан неверно: {} на тексте «{}…»",
                    encoding.label(),
                    &text[..20.min(text.len())]
                );
            }
        }
    }

    /// Обратная сторона той же проверки: обычные однобайтовые и UTF-8 файлы
    /// не должны приниматься за UTF-16.
    #[test]
    fn ordinary_text_is_not_mistaken_for_utf16() {
        let candidates: Vec<Vec<u8>> = vec![
            RUSSIAN.as_bytes().to_vec(),
            encode(RUSSIAN, Encoding::Windows1251).unwrap(),
            encode(RUSSIAN, Encoding::Ibm866).unwrap(),
            encode(RUSSIAN, Encoding::Koi8R).unwrap(),
            b"fn main() {\r\n    let x = 1;\r\n    println!(\"{x}\");\r\n}\r\n".to_vec(),
            // Файл из одних переводов строк — крайний случай для статистики.
            b"\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n".to_vec(),
        ];

        for bytes in candidates {
            let encoding = detected(&bytes);
            assert!(
                encoding != Encoding::Utf16Le && encoding != Encoding::Utf16Be,
                "обычный текст принят за {}",
                encoding.label()
            );
        }
    }

    /// UTF-32 не поддерживается, но обязан быть назван, а не принят за UTF-16.
    #[test]
    fn utf32_is_refused_not_mangled() {
        let mut le = vec![0xFF, 0xFE, 0x00, 0x00];
        le.extend_from_slice(&[0x41, 0x00, 0x00, 0x00]);
        assert_eq!(detect(&le), Err(DetectError::Utf32NotSupported));

        let mut be = vec![0x00, 0x00, 0xFE, 0xFF];
        be.extend_from_slice(&[0x00, 0x00, 0x00, 0x41]);
        assert_eq!(detect(&be), Err(DetectError::Utf32NotSupported));
    }

    /// Обрыв многобайтовой последовательности ровно на границе образца —
    /// не повод объявлять файл однобайтовым.
    #[test]
    fn truncated_multibyte_at_sample_edge_is_not_an_error() {
        let mut big = String::new();
        while big.len() < SAMPLE_LIMIT + 1024 {
            big.push_str(RUSSIAN);
        }
        assert_eq!(detected(big.as_bytes()), Encoding::Utf8);
    }

    /// Определение не должно зависеть от того, чем кончается строка.
    #[test]
    fn line_endings_do_not_affect_detection() {
        for separator in ["\r\n", "\n", "\r"] {
            let text = RUSSIAN.replace(". ", &format!(".{separator}"));
            let bytes = encode(&text, Encoding::Windows1251).unwrap();
            assert_eq!(detected(&bytes), Encoding::Windows1251);
        }
    }
}
