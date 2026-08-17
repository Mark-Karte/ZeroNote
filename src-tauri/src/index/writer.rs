//! Запись в индекс: файл на диске → строка в базе.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension};

use crate::model::root::RootId;
use crate::text::document;

/// Сколько байтов от начала файла смотреть, решая, двоичный ли он.
///
/// Столько же смотрит git. Управляющий ноль в тексте не встречается, а в любом
/// двоичном формате попадается почти сразу.
const BINARY_PROBE: usize = 8 * 1024;

/// Что стало с файлом при попытке его проиндексировать.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Indexed {
    /// Содержимое записано в индекс.
    Stored,
    /// Файл не изменился с прошлого раза — перечитывать было незачем.
    Unchanged,
    /// Двоичный, слишком большой или нечитаемый: в индекс не попадает.
    Skipped,
}

#[derive(Debug)]
pub enum IndexError {
    Db(rusqlite::Error),
    Io(std::io::Error),
}

impl std::fmt::Display for IndexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IndexError::Db(e) => write!(f, "индекс: {e}"),
            IndexError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for IndexError {}

impl From<rusqlite::Error> for IndexError {
    fn from(e: rusqlite::Error) -> Self {
        IndexError::Db(e)
    }
}

/// Похоже ли содержимое на двоичное.
///
/// Список расширений сознательно не заводим (В25): его пришлось бы вечно
/// дополнять, и он молча терял бы чужие текстовые форматы.
pub fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_PROBE)].contains(&0)
}

fn millis(time: std::time::SystemTime) -> Option<i64> {
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

fn now_ms() -> i64 {
    millis(std::time::SystemTime::now()).unwrap_or(0)
}

/// Записать файл в индекс.
///
/// `max_size` — предел из настроек проекта. Файл крупнее в индекс не попадает:
/// поиск по журналу на сто мегабайт не нужен никому, а память и время он съест.
pub fn index_file(
    connection: &Connection,
    root_id: RootId,
    path: &Path,
    max_size: u64,
) -> Result<Indexed, IndexError> {
    let meta = std::fs::metadata(path).map_err(IndexError::Io)?;
    let size = meta.len();
    let mtime = meta.modified().ok().and_then(millis);
    let text_path = path.to_string_lossy();

    // Уже записанное состояние. Совпало время и размер — содержимое не менялось,
    // и перечитывать мегабайт с диска незачем.
    let known: Option<(Option<i64>, i64)> = connection
        .query_row(
            "SELECT mtime_ms, size FROM files WHERE path = ?1",
            [text_path.as_ref()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    if let Some((known_mtime, known_size)) = known
        && known_mtime == mtime
        && known_size == size as i64
    {
        return Ok(Indexed::Unchanged);
    }

    if size > max_size {
        forget_file(connection, path)?;
        return Ok(Indexed::Skipped);
    }

    let bytes = std::fs::read(path).map_err(IndexError::Io)?;
    if looks_binary(&bytes) {
        forget_file(connection, path)?;
        return Ok(Indexed::Skipped);
    }

    // Кодировку определяем тем же кодом, что и при открытии файла: индекс
    // и редактор обязаны видеть один и тот же текст.
    let Ok(document) = document::read(&bytes) else {
        forget_file(connection, path)?;
        return Ok(Indexed::Skipped);
    };

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    // Старую запись убираем целиком: у FTS5 нет обновления на месте,
    // а два вхождения одного файла давали бы его дважды в выдаче.
    forget_file(connection, path)?;

    connection.execute(
        "INSERT INTO files (root_id, path, name, mtime_ms, size, indexed_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            root_id as i64,
            text_path.as_ref(),
            name,
            mtime,
            size as i64,
            now_ms()
        ],
    )?;

    let id = connection.last_insert_rowid();
    connection.execute(
        "INSERT INTO content (rowid, text) VALUES (?1, ?2)",
        rusqlite::params![id, document.text],
    )?;

    Ok(Indexed::Stored)
}

/// Убрать файл из индекса: удалён, переименован, стал двоичным или слишком
/// большим.
pub fn forget_file(connection: &Connection, path: &Path) -> Result<(), IndexError> {
    let text_path = path.to_string_lossy();

    let id: Option<i64> = connection
        .query_row(
            "SELECT id FROM files WHERE path = ?1",
            [text_path.as_ref()],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(id) = id {
        connection.execute("DELETE FROM content WHERE rowid = ?1", [id])?;
        connection.execute("DELETE FROM files WHERE id = ?1", [id])?;
    }
    Ok(())
}

/// Убрать из индекса весь корень: его убрали из рабочего пространства.
pub fn forget_root(connection: &Connection, root_id: RootId) -> Result<(), IndexError> {
    connection.execute(
        "DELETE FROM content WHERE rowid IN (SELECT id FROM files WHERE root_id = ?1)",
        [root_id as i64],
    )?;
    connection.execute("DELETE FROM files WHERE root_id = ?1", [root_id as i64])?;
    Ok(())
}

/// Пути корня, записанные в индексе, — для сверки с тем, что осталось на диске.
pub fn known_paths(
    connection: &Connection,
    root_id: RootId,
) -> Result<Vec<String>, IndexError> {
    let mut statement = connection.prepare("SELECT path FROM files WHERE root_id = ?1")?;
    let rows = statement.query_map([root_id as i64], |row| row.get::<_, String>(0))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Все файлы в индексе: номер корня, путь, имя.
///
/// Нужно быстрому открытию. Отдельного списка имён специально для него нет
/// намеренно: второй список пришлось бы согласовывать с индексом, а проход
/// по десяти тысячам строк стоит доли миллисекунды.
pub fn all_files(
    connection: &Connection,
) -> Result<Vec<(RootId, String, String)>, IndexError> {
    let mut statement = connection.prepare("SELECT root_id, path, name FROM files")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)? as RootId,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Сколько файлов корня в индексе.
pub fn count(connection: &Connection, root_id: RootId) -> Result<u64, IndexError> {
    let value: i64 = connection.query_row(
        "SELECT count(*) FROM files WHERE root_id = ?1",
        [root_id as i64],
        |row| row.get(0),
    )?;
    Ok(value as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::schema;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-writer-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn connection(dir: &Path) -> Connection {
        schema::open(&schema::index_path(dir)).unwrap()
    }

    const BIG: u64 = 2 * 1024 * 1024;

    #[test]
    fn text_file_gets_indexed() {
        let dir = temp_dir("store");
        let path = dir.join("заметка.md");
        std::fs::write(&path, "съешь ещё этих мягких французских булок").unwrap();
        let db = connection(&dir);

        assert_eq!(index_file(&db, 1, &path, BIG).unwrap(), Indexed::Stored);
        assert_eq!(count(&db, 1).unwrap(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Неизменившийся файл не перечитывается: на десяти тысячах файлов это
    /// разница между секундой и минутой.
    #[test]
    fn unchanged_file_is_not_reread() {
        let dir = temp_dir("unchanged");
        let path = dir.join("заметка.md");
        std::fs::write(&path, "текст").unwrap();
        let db = connection(&dir);

        assert_eq!(index_file(&db, 1, &path, BIG).unwrap(), Indexed::Stored);
        assert_eq!(index_file(&db, 1, &path, BIG).unwrap(), Indexed::Unchanged);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Изменённый файл переиндексируется, и старое содержимое не остаётся.
    #[test]
    fn changed_file_replaces_the_old_content() {
        let dir = temp_dir("changed");
        let path = dir.join("заметка.md");
        std::fs::write(&path, "первоначальное содержимое").unwrap();
        let db = connection(&dir);
        index_file(&db, 1, &path, BIG).unwrap();

        // Ждём, чтобы отметка времени заведомо изменилась: файловые системы
        // Windows хранят её с грубым шагом.
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(&path, "совершенно другое наполнение").unwrap();

        assert_eq!(index_file(&db, 1, &path, BIG).unwrap(), Indexed::Stored);
        assert_eq!(count(&db, 1).unwrap(), 1, "файл не должен удвоиться");

        let stale: i64 = db
            .query_row(
                "SELECT count(*) FROM content WHERE content MATCH 'первоначальное'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stale, 0, "старое содержимое осталось в индексе");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn binary_file_is_skipped() {
        let dir = temp_dir("binary");
        let path = dir.join("картинка.png");
        std::fs::write(&path, [0x89, b'P', b'N', b'G', 0x00, 0x1A, 0x0A]).unwrap();
        let db = connection(&dir);

        assert_eq!(index_file(&db, 1, &path, BIG).unwrap(), Indexed::Skipped);
        assert_eq!(count(&db, 1).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_file_is_skipped() {
        let dir = temp_dir("big");
        let path = dir.join("журнал.log");
        std::fs::write(&path, "строка\n".repeat(1000)).unwrap();
        let db = connection(&dir);

        assert_eq!(index_file(&db, 1, &path, 100).unwrap(), Indexed::Skipped);
        assert_eq!(count(&db, 1).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Файл, переросший предел, обязан уйти из индекса, а не остаться
    /// в нём со старым содержимым.
    #[test]
    fn file_that_outgrew_the_limit_leaves_the_index() {
        let dir = temp_dir("outgrew");
        let path = dir.join("растущий.md");
        std::fs::write(&path, "коротко").unwrap();
        let db = connection(&dir);
        index_file(&db, 1, &path, 1000).unwrap();
        assert_eq!(count(&db, 1).unwrap(), 1);

        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(&path, "длинно ".repeat(1000)).unwrap();

        assert_eq!(index_file(&db, 1, &path, 1000).unwrap(), Indexed::Skipped);
        assert_eq!(count(&db, 1).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Кодировка определяется тем же кодом, что и при открытии файла:
    /// в индексе должен лежать тот же текст, что видит пользователь.
    #[test]
    fn single_byte_encoding_is_decoded() {
        use crate::text::encoding::{Encoding, encode};

        let dir = temp_dir("encoding");
        let path = dir.join("старая.txt");
        let bytes = encode("сегодня была метель", Encoding::Windows1251).unwrap();
        std::fs::write(&path, bytes).unwrap();
        let db = connection(&dir);

        index_file(&db, 1, &path, BIG).unwrap();

        let found: i64 = db
            .query_row(
                "SELECT count(*) FROM content WHERE content MATCH 'метель'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(found, 1, "кириллица из windows-1251 не доехала до индекса");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn forgetting_a_root_removes_its_content() {
        let dir = temp_dir("forget-root");
        let db = connection(&dir);

        for (i, root) in [(1, 1u64), (2, 1), (3, 2)] {
            let path = dir.join(format!("файл-{i}.md"));
            std::fs::write(&path, "содержимое").unwrap();
            index_file(&db, root, &path, BIG).unwrap();
        }

        forget_root(&db, 1).unwrap();

        assert_eq!(count(&db, 1).unwrap(), 0);
        assert_eq!(count(&db, 2).unwrap(), 1);
        let orphans: i64 = db
            .query_row("SELECT count(*) FROM content", [], |row| row.get(0))
            .unwrap();
        assert_eq!(orphans, 1, "содержимое удалённого корня осталось");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn known_paths_lists_only_this_root() {
        let dir = temp_dir("known");
        let db = connection(&dir);

        let first = dir.join("один.md");
        let second = dir.join("два.md");
        std::fs::write(&first, "текст").unwrap();
        std::fs::write(&second, "текст").unwrap();
        index_file(&db, 1, &first, BIG).unwrap();
        index_file(&db, 2, &second, BIG).unwrap();

        let paths = known_paths(&db, 1).unwrap();

        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("один.md"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
