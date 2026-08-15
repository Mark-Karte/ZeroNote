//! Файловый слой поверх текстового ядра: путь на диске → документ и обратно.
//!
//! `text/` работает только с байтами и не знает про файловую систему.
//! Здесь эти две половины соединяются: чтение, отметка состояния файла на
//! момент чтения (понадобится для отслеживания внешних изменений) и запись
//! через атомарное сохранение.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::atomic_save::{self, SaveError};
use crate::text::document::{self, ReadError, TextDocument};
use crate::text::encoding::{EncodeError, Encoding};
use crate::text::eol::Eol;

/// Порог упрощённого режима.
///
/// Свыше него файл открывается только для чтения, без подсветки и индексации.
/// Это записано в спецификации производительности; здесь только само число
/// и его единственное место в коде.
pub const LARGE_FILE_THRESHOLD: u64 = 50 * 1024 * 1024;

/// Состояние файла на диске в момент чтения.
///
/// Нужно, чтобы заметить правку файла снаружи. Размер хранится вместе со
/// временем: файловые системы Windows держат время с грубым шагом, и быстрая
/// правка может не сдвинуть отметку.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskState {
    /// Миллисекунды с начала эпохи. `None` — файловая система не сообщила
    /// время; тогда полагаемся на размер.
    pub modified_ms: Option<u64>,
    pub size: u64,
}

impl DiskState {
    pub fn of(path: &Path) -> std::io::Result<DiskState> {
        let meta = std::fs::metadata(path)?;
        Ok(DiskState {
            modified_ms: meta.modified().ok().and_then(to_millis),
            size: meta.len(),
        })
    }
}

fn to_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

#[derive(Debug)]
pub struct OpenedFile {
    pub path: PathBuf,
    pub document: TextDocument,
    pub disk: DiskState,
    /// У файла установлен признак «только для чтения».
    pub read_only: bool,
    /// Файл больше порога: упрощённый режим.
    pub large: bool,
}

#[derive(Debug)]
pub enum OpenError {
    Io { path: PathBuf, source: std::io::Error },
    Read { path: PathBuf, source: ReadError },
    /// Файл слишком велик, чтобы держать его в памяти целиком.
    ///
    /// Упрощённый режим для таких файлов — постраничное чтение, и это работа
    /// этапа 2. Пока честный отказ лучше, чем съеденная память.
    TooLargeToLoad { path: PathBuf, size: u64 },
}

/// Предел, выше которого файл не грузится вовсе.
///
/// Отделён от `LARGE_FILE_THRESHOLD` намеренно: между ними лежит упрощённый
/// режим — файл читается целиком, но правка запрещена.
pub const REFUSE_TO_LOAD_THRESHOLD: u64 = 512 * 1024 * 1024;

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::Io { path, source } => write!(f, "{}: {source}", path.display()),
            OpenError::Read { path, source } => write!(f, "{}: {source}", path.display()),
            OpenError::TooLargeToLoad { path, size } => write!(
                f,
                "{}: файл {} МиБ — слишком велик для открытия",
                path.display(),
                size / (1024 * 1024)
            ),
        }
    }
}

impl std::error::Error for OpenError {}

pub fn open(path: &Path) -> Result<OpenedFile, OpenError> {
    let meta = std::fs::metadata(path).map_err(|source| OpenError::Io {
        path: path.to_path_buf(),
        source,
    })?;

    if meta.len() > REFUSE_TO_LOAD_THRESHOLD {
        return Err(OpenError::TooLargeToLoad {
            path: path.to_path_buf(),
            size: meta.len(),
        });
    }

    let bytes = std::fs::read(path).map_err(|source| OpenError::Io {
        path: path.to_path_buf(),
        source,
    })?;

    let document = document::read(&bytes).map_err(|source| OpenError::Read {
        path: path.to_path_buf(),
        source,
    })?;

    Ok(OpenedFile {
        path: path.to_path_buf(),
        document,
        disk: DiskState {
            modified_ms: meta.modified().ok().and_then(to_millis),
            size: meta.len(),
        },
        read_only: meta.permissions().readonly(),
        large: meta.len() > LARGE_FILE_THRESHOLD,
    })
}

#[derive(Debug)]
pub enum WriteError {
    Encode(EncodeError),
    Save(SaveError),
    Io { path: PathBuf, source: std::io::Error },
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WriteError::Encode(e) => write!(f, "{e}"),
            WriteError::Save(e) => write!(f, "{e}"),
            WriteError::Io { path, source } => write!(f, "{}: {source}", path.display()),
        }
    }
}

impl std::error::Error for WriteError {}

/// Записать текст буфера в файл и вернуть новое состояние файла на диске.
///
/// Текст приходит с переводами строк `\n` — таково внутреннее представление
/// буфера. Тип переноса, кодировка и метка порядка байтов передаются явно:
/// это свойства буфера, а не догадки этой функции.
pub fn write(
    path: &Path,
    text: &str,
    encoding: Encoding,
    bom: bool,
    line_ending: Eol,
) -> Result<DiskState, WriteError> {
    let bytes = document::to_bytes(text, encoding, bom, line_ending).map_err(WriteError::Encode)?;

    atomic_save::save(path, &bytes).map_err(WriteError::Save)?;

    DiskState::of(path).map_err(|source| WriteError::Io {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-textfile-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_reports_disk_state() {
        let dir = temp_dir("disk");
        let path = dir.join("файл.txt");
        std::fs::write(&path, "привет\r\n").unwrap();

        let opened = open(&path).unwrap();

        assert_eq!(opened.disk.size, "привет\r\n".len() as u64);
        assert!(!opened.large);
        assert!(!opened.read_only);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Признак «только для чтения» должен доезжать до интерфейса, иначе
    /// пользователь узнает о нём только при неудачном сохранении.
    #[test]
    fn read_only_attribute_is_reported() {
        let dir = temp_dir("readonly");
        let path = dir.join("защищённый.txt");
        std::fs::write(&path, "текст").unwrap();

        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&path, perms.clone()).unwrap();

        assert!(open(&path).unwrap().read_only);

        // Убираем признак, иначе папка не удалится.
        perms.set_readonly(false);
        std::fs::set_permissions(&path, perms).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Обход «открыть — записать — открыть» не меняет ни байта.
    #[test]
    fn write_preserves_everything_open_reported() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("файл.txt");
        let original = "первая\r\nвторая\r\n".as_bytes();
        std::fs::write(&path, original).unwrap();

        let opened = open(&path).unwrap();
        write(
            &path,
            &opened.document.text,
            opened.document.encoding,
            opened.document.bom,
            opened.document.eol.dominant,
        )
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), original);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Состояние на диске после записи должно отличаться от прежнего,
    /// иначе отслеживание внешних правок примет наше же сохранение за чужое.
    #[test]
    fn write_returns_fresh_disk_state() {
        let dir = temp_dir("fresh");
        let path = dir.join("файл.txt");
        std::fs::write(&path, "коротко").unwrap();

        let before = open(&path).unwrap().disk;
        let after = write(
            &path,
            "заметно длиннее прежнего текста",
            Encoding::Utf8,
            false,
            Eol::Lf,
        )
        .unwrap();

        assert_ne!(before.size, after.size);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_file_is_an_error_not_a_panic() {
        let path = temp_dir("missing").join("нет-такого.txt");
        assert!(matches!(open(&path), Err(OpenError::Io { .. })));
    }
}
