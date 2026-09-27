//! Чтение наших конфигов из папки данных: `settings.toml`, `keymap.toml`,
//! `callouts.toml`.
//!
//! Одно правило на все три (задача 137, находка Я2 ревизии): **«файла нет»
//! и «файл не читается» — разные случаи.** Нет файла — первый запуск,
//! действуют умолчания, а правка из окна начинается с образца. Файл есть,
//! но не читается — занят, не в UTF-8, нет прав, — это ошибка, и она
//! обязана дойти до человека. До задачи 137 все три читали любую ошибку как
//! отсутствие: человек молча получал умолчания, а первая же правка из окна
//! параметров писала образец поверх его файла — против Р-089, по которому
//! непонятный файл не переписывается вовсе.

use std::io::ErrorKind;
use std::path::Path;

/// Прочитать конфиг. `Ok(None)` — файла нет. `Err` — файл есть, но прочитать
/// его нельзя; текст ошибки годен для показа человеку.
pub fn read(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(source) => Ok(Some(source)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        // `read_to_string` отвечает так на байты, которые не UTF-8. Чаще
        // всего это запись из Windows PowerShell 5.1 или «Блокнота»
        // в UTF-16 либо в ANSI — и человеку полезнее знать, что именно
        // не так, чем прочитать «stream did not contain valid UTF-8».
        Err(e) if e.kind() == ErrorKind::InvalidData => Err(format!(
            "{} не в кодировке UTF-8 — сохраните его в UTF-8",
            name_of(path)
        )),
        Err(e) => Err(format!("не удалось прочитать {}: {e}", name_of(path))),
    }
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// Текст в UTF-16LE с меткой — так пишет `>>` в Windows PowerShell 5.1.
#[cfg(test)]
pub fn utf16_for_tests(text: &str) -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xFE];
    for unit in text.encode_utf16() {
        bytes.extend(unit.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-config-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_is_none() {
        let dir = temp_dir("missing");
        assert_eq!(read(&dir.join("settings.toml")), Ok(None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn utf8_file_is_read() {
        let dir = temp_dir("utf8");
        let path = dir.join("settings.toml");
        std::fs::write(&path, "# Настройки\nschema = 1\n").unwrap();
        assert_eq!(read(&path), Ok(Some("# Настройки\nschema = 1\n".to_owned())));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn utf16_file_is_an_error_that_names_the_encoding() {
        let dir = temp_dir("utf16");
        let path = dir.join("keymap.toml");
        std::fs::write(&path, utf16_for_tests("schema = 1\n")).unwrap();

        let error = read(&path).unwrap_err();
        assert!(error.contains("keymap.toml"), "{error}");
        assert!(error.contains("UTF-8"), "{error}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Папка на месте файла — тоже «не читается», а не «нет».
    #[test]
    fn folder_in_place_of_file_is_an_error() {
        let dir = temp_dir("folder");
        let path = dir.join("callouts.toml");
        std::fs::create_dir_all(&path).unwrap();
        assert!(read(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
