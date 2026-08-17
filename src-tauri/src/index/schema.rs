//! Схема индекса и её версия.
//!
//! Индекс — это кэш: он целиком выводится из файлов на диске. Отсюда решение
//! Р-060: схема не мигрируется, а перестраивается. Писать миграции для кэша
//! значит содержать код, единственная польза которого — сэкономить одну
//! фоновую индексацию.

use std::path::Path;

use rusqlite::Connection;

/// Версия схемы. Меняется — база сносится и строится заново.
pub const SCHEMA_VERSION: u32 = 1;

/// Имя файла базы. Лежит в папке данных приложения, а не в папке проекта
/// (решение Р-058): мы не сорим в чужих папках.
pub const INDEX_FILE: &str = "index.db";

pub fn index_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join(INDEX_FILE)
}

/// Открыть базу, при необходимости построив её заново.
pub fn open(path: &Path) -> Result<Connection, rusqlite::Error> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Любая беда с существующим файлом — обрыв записи, чужой файл с нашим
    // именем, повреждение диска — значит одно: этот кэш нам не понятен.
    // Для кэша это то же самое, что чужая версия, и ответ тот же: построить
    // заново. Файл наш собственный и лежит в нашей папке данных, терять нечего.
    //
    // Проверять приходится с самого открытия: на файле, который не база,
    // спотыкается уже установка режима журнала, до всякого чтения версии.
    let existing = Connection::open(path).ok().and_then(|connection| {
        prepare(&connection).ok()?;
        if version(&connection).unwrap_or(0) == SCHEMA_VERSION {
            Some(connection)
        } else {
            None
        }
    });

    if let Some(connection) = existing {
        return Ok(connection);
    }
    let _ = std::fs::remove_file(path);
    // Спутники журнала предзаписи: без них SQLite восстановит старое
    // содержимое поверх новой базы.
    for suffix in ["-wal", "-shm"] {
        let mut companion = path.as_os_str().to_owned();
        companion.push(suffix);
        let _ = std::fs::remove_file(std::path::PathBuf::from(companion));
    }

    let connection = Connection::open(path)?;
    prepare(&connection)?;
    create(&connection)?;
    Ok(connection)
}

/// Настройки соединения. Задаются при каждом открытии: часть из них живёт
/// в файле базы, часть — только в соединении, и разбираться, что где,
/// дороже, чем выставить всё заново.
fn prepare(connection: &Connection) -> Result<(), rusqlite::Error> {
    // Журнал предзаписи: читатель не ждёт писателя. Для нас это значит,
    // что поиск работает во время индексации, а не после неё.
    connection.pragma_update(None, "journal_mode", "WAL")?;
    // Ждать освободившуюся базу, а не падать с «занято».
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    // Полная синхронизация на каждую запись индексу не нужна: потеря
    // последних записей после падения означает переиндексацию пары файлов,
    // а не потерю пользовательских данных.
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

fn version(connection: &Connection) -> Result<u32, rusqlite::Error> {
    let exists: bool = connection.query_row(
        "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
        [],
        |row| row.get(0),
    )?;
    if !exists {
        return Ok(0);
    }

    let value: Option<String> = connection
        .query_row("SELECT value FROM meta WHERE key = 'schema'", [], |row| {
            row.get(0)
        })
        .ok();

    Ok(value.and_then(|v| v.parse().ok()).unwrap_or(0))
}

fn create(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch(
        r#"
        CREATE TABLE meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Одна база на все корни (Р-059): поиск сразу по всем, удаление
        -- корня — одна строка запроса, миграция — одно место.
        CREATE TABLE files (
            id         INTEGER PRIMARY KEY,
            root_id    INTEGER NOT NULL,
            path       TEXT NOT NULL UNIQUE,
            name       TEXT NOT NULL,
            -- Время и размер на момент индексации: по ним видно, что файл
            -- изменился, и не нужно перечитывать его содержимое.
            mtime_ms   INTEGER,
            size       INTEGER NOT NULL,
            indexed_ms INTEGER NOT NULL
        );

        CREATE INDEX files_by_root ON files(root_id);

        -- Содержимое хранится: без него FTS5 не умеет отрывки с подсветкой,
        -- а список совпадений без отрывка бесполезен.
        CREATE VIRTUAL TABLE content USING fts5(
            text,
            tokenize = 'unicode61 remove_diacritics 2'
        );
        "#,
    )?;

    connection.execute(
        "INSERT INTO meta (key, value) VALUES ('schema', ?1)",
        [SCHEMA_VERSION.to_string()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-index-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// FTS5 обязан быть в сборке. Если его нет, всё остальное бессмысленно,
    /// и узнать об этом надо на тесте, а не от пользователя.
    #[test]
    fn fts5_is_available() {
        let dir = temp_dir("fts5");
        let connection = open(&index_path(&dir)).expect("база должна открыться");

        connection
            .execute("INSERT INTO content (rowid, text) VALUES (1, ?1)", [
                "съешь ещё этих мягких французских булок",
            ])
            .expect("вставка в FTS5 должна работать");

        let found: i64 = connection
            .query_row(
                "SELECT count(*) FROM content WHERE content MATCH 'французских'",
                [],
                |row| row.get(0),
            )
            .expect("поиск должен работать");

        assert_eq!(found, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Повторное открытие не должно ничего ломать и терять.
    #[test]
    fn reopening_keeps_the_data() {
        let dir = temp_dir("reopen");
        let path = index_path(&dir);

        {
            let connection = open(&path).unwrap();
            connection
                .execute(
                    "INSERT INTO files (root_id, path, name, mtime_ms, size, indexed_ms)
                     VALUES (1, 'C:\\заметки\\файл.md', 'файл.md', 1, 10, 1)",
                    [],
                )
                .unwrap();
        }

        let connection = open(&path).unwrap();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM files", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// База чужой версии сносится целиком, а не чинится по кускам (Р-060).
    #[test]
    fn foreign_version_is_rebuilt() {
        let dir = temp_dir("version");
        let path = index_path(&dir);

        {
            let connection = open(&path).unwrap();
            connection
                .execute(
                    "INSERT INTO files (root_id, path, name, mtime_ms, size, indexed_ms)
                     VALUES (1, 'C:\\старое.md', 'старое.md', 1, 10, 1)",
                    [],
                )
                .unwrap();
            connection
                .execute("UPDATE meta SET value = '99' WHERE key = 'schema'", [])
                .unwrap();
        }

        let connection = open(&path).unwrap();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM files", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count, 0, "старые записи не должны пережить смену схемы");
        assert_eq!(version(&connection).unwrap(), SCHEMA_VERSION);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Испорченный файл базы не должен мешать работе: индекс — кэш,
    /// и непонятный кэш строится заново, а не разбирается по кусочкам.
    #[test]
    fn broken_database_is_rebuilt() {
        let dir = temp_dir("broken");
        let path = index_path(&dir);
        std::fs::write(&path, "это не база данных, а просто текст").unwrap();

        let connection = open(&path).expect("испорченная база должна перестроиться");

        assert_eq!(version(&connection).unwrap(), SCHEMA_VERSION);
        // И она работоспособна, а не просто открылась.
        connection
            .execute("INSERT INTO content (rowid, text) VALUES (1, 'проверка')", [])
            .expect("новая база должна принимать записи");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
