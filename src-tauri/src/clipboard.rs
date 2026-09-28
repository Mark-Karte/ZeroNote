//! Чтение буфера обмена.
//!
//! Модуль существует по одной причине, и она измерена, а не предположена:
//! браузерное `navigator.clipboard.readText()` в нашем WebView2 **не отвечает
//! вовсе** — обещание не разрешается и не отвергается (Р-109). Пункт меню
//! «Вставить» из-за этого молча не делал бы ничего.
//!
//! Запись сюда не переехала: `navigator.clipboard.writeText` работает,
//! и гонять её через ядро незачем.

use std::time::Duration;

use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    RegisterClipboardFormatW,
};
use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

/// Формат «текст в UTF-16 с нулём на конце» — единственный, который нам нужен.
///
/// Числом, а не именем из `windows-sys`: константа определена в документации
/// Windows раз и навсегда, а имя её в разных версиях крейта лежит в разных
/// модулях.
const CF_UNICODETEXT: u32 = 13;

/// Текст из буфера обмена.
///
/// Пустая строка — законный ответ: в буфере может лежать картинка или файл,
/// а не текст. Ошибкой это не считается, иначе пользователь получал бы окно
/// с сообщением на каждую такую вставку.
pub fn text() -> Result<String, String> {
    if !open() {
        return Err("буфер обмена занят другой программой".to_owned());
    }

    // Читаем и закрываем в любом случае. Незакрытый буфер обмена — это
    // заблокированная для всей системы вставка, а не наша внутренняя беда.
    let result = read_unicode();
    unsafe { CloseClipboard() };
    result
}

/// Захватить буфер обмена, с несколькими попытками.
///
/// Буфер обмена в Windows один на всю систему, и захватить его можно только
/// одной программе разом. Отказ поэтому — обычное дело, а не сбой: в тот же
/// миг в него мог полезть кто угодно. Одна попытка означала бы «иногда
/// вставка не работает», и объяснить это пользователю было бы нечем.
fn open() -> bool {
    for _ in 0..10 {
        // Аргумент — окно-владелец. Ноль означает «текущая задача»: владение
        // нужно только на время чтения, и настоящее окно для этого не требуется.
        if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

/// Прочитать содержимое захваченного буфера обмена.
///
/// Второй `unsafe` в проекте (первый — `ReplaceFileW` в `fsx/atomic_save.rs`,
/// третий — удаление в корзину в `fsx/recycle.rs`).
/// Что здесь может пойти не так и почему не идёт:
///
/// * Указатель получен из `GlobalLock` и проверен на ноль. Пока не вызван
///   `GlobalUnlock`, память заблокирована и никуда не денется.
/// * Данные буфера обмена принадлежат системе: их нельзя освобождать,
///   и мы этого не делаем — только копируем в свою строку.
/// * Чтение до нуля ограничено настоящим размером блока (`GlobalSize`).
///   По контракту формат оканчивается нулём, но полагаться на чужой контракт
///   там, где ошибка означает выход за границу памяти, не стоит.
/// * `from_utf16_lossy`, а не строгий разбор: в буфер обмена мог попасть
///   непарный суррогат из чужой программы, и падать из-за этого нельзя.
fn read_unicode() -> Result<String, String> {
    // Текста в буфере нет вовсе — там картинка, файл или он пуст.
    if unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT) } == 0 {
        return Ok(String::new());
    }

    let handle = unsafe { GetClipboardData(CF_UNICODETEXT) };
    if handle.is_null() {
        return Err("в буфере обмена нет текста".to_owned());
    }

    let pointer = unsafe { GlobalLock(handle) } as *const u16;
    if pointer.is_null() {
        return Err("не удалось прочитать буфер обмена".to_owned());
    }

    // Размер в байтах, а знаков вдвое меньше: каждый знак UTF-16 — два байта.
    let limit = unsafe { GlobalSize(handle) } / 2;
    let mut length = 0usize;
    while length < limit && unsafe { *pointer.add(length) } != 0 {
        length += 1;
    }

    let text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) });
    unsafe { GlobalUnlock(handle) };

    Ok(text)
}

/// Растр с заголовком `BITMAPINFO` — то, что в памяти у Windows называется
/// DIB. Системный номер формата, как `CF_UNICODETEXT` выше.
const CF_DIB: u32 = 8;

/// Подпись файла PNG: восемь байт, с которых он начинается всегда.
pub const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Картинка из буфера обмена — для пункта «Вставить» в заметку (задача 146).
///
/// Отдаёт файл PNG, если программа положила формат `PNG` (так делают
/// браузеры и «Ножницы»), иначе растр файлом BMP. Сжать растр в PNG ядру
/// нечем — библиотеки PNG в сборке нет, — а вебвью умеет: окно переводит
/// BMP в PNG холстом. Пусто — картинки в буфере нет, и это не ошибка.
///
/// Клавиша `Ctrl+V` сюда не ходит: там картинку отдаёт само событие
/// вставки (Р-108). Сюда — пункт меню и вставка, в которой вебвью
/// картинки не нашёл.
pub fn image() -> Result<Vec<u8>, String> {
    // Имя формата — строкой с нулём на конце: так его ждёт Windows.
    // Номер у зарегистрированного формата свой на каждом сеансе, поэтому
    // спрашивается каждый раз, а не хранится.
    let name: Vec<u16> = "PNG\0".encode_utf16().collect();
    let png = unsafe { RegisterClipboardFormatW(name.as_ptr()) };

    if !open() {
        return Err("буфер обмена занят другой программой".to_owned());
    }
    let result = read_image(png);
    unsafe { CloseClipboard() };
    Ok(result)
}

/// Прочитать картинку из захваченного буфера обмена.
fn read_image(png: u32) -> Vec<u8> {
    if png != 0
        && unsafe { IsClipboardFormatAvailable(png) } != 0
        && let Some(bytes) = read_bytes(png)
        && let Some(end) = png_end(&bytes)
    {
        return bytes[..end].to_vec();
    }

    // Растр Windows даёт в этом формате всегда, если в буфере хоть какая-то
    // картинка: из `CF_BITMAP` и `CF_DIBV5` он делает его сама.
    if unsafe { IsClipboardFormatAvailable(CF_DIB) } != 0
        && let Some(dib) = read_bytes(CF_DIB)
        && let Some(file) = bmp_file(&dib)
    {
        return file;
    }

    Vec::new()
}

/// Скопировать блок данных формата из захваченного буфера обмена.
///
/// Тот же порядок и те же доводы, что у `read_unicode`: указатель
/// из `GlobalLock` проверен на ноль, длина — настоящий размер блока
/// (`GlobalSize`), память системы только копируется и не освобождается.
fn read_bytes(format: u32) -> Option<Vec<u8>> {
    let handle = unsafe { GetClipboardData(format) };
    if handle.is_null() {
        return None;
    }
    let pointer = unsafe { GlobalLock(handle) } as *const u8;
    if pointer.is_null() {
        return None;
    }
    let size = unsafe { GlobalSize(handle) };
    let bytes = unsafe { std::slice::from_raw_parts(pointer, size) }.to_vec();
    unsafe { GlobalUnlock(handle) };
    Some(bytes)
}

/// Где кончается файл PNG — сразу за блоком `IEND`.
///
/// Блок памяти буфера обмена бывает длиннее данных: Windows округляет
/// размер. Хвост за `IEND` читатели картинок пропускают, но в файл
/// человека ему незачем. `None` — это не PNG или он оборван.
pub fn png_end(bytes: &[u8]) -> Option<usize> {
    if !bytes.starts_with(PNG_SIGNATURE) {
        return None;
    }
    // Блок PNG: длина данных (4 байта, старший вперёд), имя (4), данные,
    // контрольная сумма (4).
    let mut at = PNG_SIGNATURE.len();
    loop {
        let length = u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize;
        let kind = bytes.get(at + 4..at + 8)?;
        let next = at.checked_add(12)?.checked_add(length)?;
        if next > bytes.len() {
            return None;
        }
        if kind == b"IEND" {
            return Some(next);
        }
        at = next;
    }
}

/// Растр из буфера обмена файлом BMP.
///
/// `CF_DIB` — это заголовок `BITMAPINFO` и за ним точки. Файл BMP — то же
/// самое с четырнадцатью байтами спереди: подпись `BM`, размер файла и где
/// начинаются точки. Последнее и надо посчитать: за заголовком могут идти
/// маски цветов и палитра. `None` — заголовок не тот, какой бывает у DIB.
pub fn bmp_file(dib: &[u8]) -> Option<Vec<u8>> {
    let word = |at: usize| -> Option<u32> { Some(u32::from_le_bytes(dib.get(at..at + 4)?.try_into().ok()?)) };

    // Размер заголовка: 40 — `BITMAPINFOHEADER`, 108 и 124 — версии 4 и 5.
    // Старый заголовок на 12 байт в буфере обмена не встречается.
    let header = word(0)? as usize;
    if header < 40 || header > dib.len() {
        return None;
    }
    let bit_count = u16::from_le_bytes(dib.get(14..16)?.try_into().ok()?);
    let compression = word(16)?;
    let colors_used = word(32)? as usize;

    // Маски цветов у заголовка на 40 байт идут следом за ним: три слова
    // при `BI_BITFIELDS` (3), четыре при `BI_ALPHABITFIELDS` (6). У версий
    // 4 и 5 они внутри заголовка.
    let masks = match (header, compression) {
        (40, 3) => 12,
        (40, 6) => 16,
        _ => 0,
    };
    // Палитра — у растров до восьми бит на точку; её длину заголовок
    // называет сам, ноль значит «полная».
    let palette = match (colors_used, bit_count) {
        (0, 1..=8) => 1usize << bit_count,
        (0, _) => 0,
        (used, _) => used,
    };
    let offset = 14 + header + masks + palette.checked_mul(4)?;
    if offset - 14 > dib.len() {
        return None;
    }

    let mut file = Vec::with_capacity(14 + dib.len());
    file.extend_from_slice(b"BM");
    file.extend_from_slice(&u32::try_from(14 + dib.len()).ok()?.to_le_bytes());
    file.extend_from_slice(&[0; 4]);
    file.extend_from_slice(&u32::try_from(offset).ok()?.to_le_bytes());
    file.extend_from_slice(dib);
    Some(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Прочитать буфер обмена на сборочной машине можно не всегда — его мог
    /// занять кто-то другой, а в нём самом может не быть текста. А вот упасть
    /// при этом нельзя ни при каких условиях: вставка обязана либо вернуть
    /// текст, либо сказать, почему не может.
    #[test]
    fn reading_never_panics() {
        match text() {
            Ok(_) => {}
            Err(message) => assert!(!message.is_empty(), "отказ обязан быть объяснён"),
        }
        match image() {
            Ok(_) => {}
            Err(message) => assert!(!message.is_empty(), "отказ обязан быть объяснён"),
        }
    }

    /// Блок PNG: длина, имя, данные, контрольная сумма (здесь нули —
    /// её проверяет читатель картинки, а не мы).
    fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut out = (data.len() as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(data);
        out.extend_from_slice(&[0; 4]);
        out
    }

    /// Хвост блока памяти за `IEND` в файл не идёт; оборванный PNG — не PNG.
    #[test]
    fn png_ends_after_iend() {
        let mut png = PNG_SIGNATURE.to_vec();
        png.extend(chunk(b"IHDR", &[0; 13]));
        png.extend(chunk(b"IDAT", &[1, 2, 3]));
        png.extend(chunk(b"IEND", &[]));
        let length = png.len();
        png.extend_from_slice(&[0xAB; 16]);

        assert_eq!(png_end(&png), Some(length));
        assert_eq!(png_end(&png[..length - 3]), None);
        assert_eq!(png_end(b"BM not png"), None);
    }

    /// Заголовок DIB на 40 байт с нужными полями; остальное — нули.
    fn dib(bit_count: u16, compression: u32, colors_used: u32, tail: usize) -> Vec<u8> {
        let mut out = vec![0u8; 40];
        out[0..4].copy_from_slice(&40u32.to_le_bytes());
        out[14..16].copy_from_slice(&bit_count.to_le_bytes());
        out[16..20].copy_from_slice(&compression.to_le_bytes());
        out[32..36].copy_from_slice(&colors_used.to_le_bytes());
        out.extend(std::iter::repeat_n(0u8, tail));
        out
    }

    fn offset(file: &[u8]) -> u32 {
        u32::from_le_bytes(file[10..14].try_into().unwrap())
    }

    /// Где начинаются точки: сразу за заголовком, за масками цветов,
    /// за палитрой.
    #[test]
    fn bmp_header_points_at_the_pixels() {
        let plain = bmp_file(&dib(24, 0, 0, 12)).unwrap();
        assert_eq!(&plain[..2], b"BM");
        assert_eq!(u32::from_le_bytes(plain[2..6].try_into().unwrap()), 14 + 52);
        assert_eq!(offset(&plain), 14 + 40);

        assert_eq!(offset(&bmp_file(&dib(32, 3, 0, 16)).unwrap()), 14 + 40 + 12);
        assert_eq!(offset(&bmp_file(&dib(8, 0, 0, 1024)).unwrap()), 14 + 40 + 256 * 4);
        assert_eq!(offset(&bmp_file(&dib(8, 0, 16, 64)).unwrap()), 14 + 40 + 16 * 4);
    }

    /// Мусор вместо заголовка — не картинка, и паники из-за него нет.
    #[test]
    fn broken_dib_is_refused() {
        assert_eq!(bmp_file(&[]), None);
        assert_eq!(bmp_file(&[1, 2, 3]), None);
        assert_eq!(bmp_file(&12u32.to_le_bytes()), None);
        // Палитра на 256 цветов обещана, а байтов нет.
        assert_eq!(bmp_file(&dib(8, 0, 0, 0)), None);
    }
}
