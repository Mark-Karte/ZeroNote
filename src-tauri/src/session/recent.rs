//! Недавно открытые файлы.
//!
//! Отдельный файл, а не поле в снимке сессии, и это то же рассуждение, что
//! в Р-030 про черновики: у истории свой ритм и своя жизнь. Сессия отвечает
//! на вопрос «что было открыто», история — «что открывали раньше». Закрыв все
//! вкладки, пользователь очищает первое и не должен терять второе.
//!
//! Любая беда с файлом означает «истории нет», а не остановку: стартовый экран
//! обязан открыться и без неё.

use std::path::{Path, PathBuf};

use crate::fsx::atomic_save;

/// Сколько записей храним. Больше пятёрки на экран не влезет, но запас нужен:
/// файл мог быть удалён или лежать на отключённом диске.
const KEEP: usize = 20;

const RECENT_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Entry {
    pub path: PathBuf,
    /// Когда открыли, в миллисекундах эпохи. Часовой пояс не хранится:
    /// показывается «сколько времени назад», а это разность.
    pub opened_at: u64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RecentFile {
    schema: u32,
    #[serde(default)]
    entries: Vec<Entry>,
}

pub fn recent_path(data: &Path) -> PathBuf {
    data.join("recent.toml")
}

/// Ключ для сравнения путей.
///
/// Windows не различает регистр, и `C:\Проект\Файл.md` с `c:\проект\файл.md` —
/// один и тот же файл. Приведение делается в Rust: как и в индексе, полагаться
/// тут на чужой `lower()` нельзя, кириллицу он не знает.
fn key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

pub fn read(data: &Path) -> Vec<Entry> {
    let Ok(text) = std::fs::read_to_string(recent_path(data)) else {
        return Vec::new();
    };
    let Ok(file) = toml::from_str::<RecentFile>(&text) else {
        return Vec::new();
    };
    if file.schema != RECENT_SCHEMA {
        return Vec::new();
    }
    file.entries
}

/// Добавить файл в историю. Самый свежий — первый.
///
/// Повторное открытие не заводит вторую запись, а поднимает существующую:
/// список «недавнего», где один и тот же файл встречается пять раз, — это
/// список одного файла.
pub fn remember(data: &Path, path: &Path, now_ms: u64) -> Result<(), String> {
    let mut entries = read(data);
    let target = key(path);
    entries.retain(|entry| key(&entry.path) != target);
    entries.insert(
        0,
        Entry {
            path: path.to_path_buf(),
            opened_at: now_ms,
        },
    );
    entries.truncate(KEEP);

    let file = RecentFile {
        schema: RECENT_SCHEMA,
        entries,
    };
    let text = toml::to_string_pretty(&file).map_err(|e| e.to_string())?;
    atomic_save::save(&recent_path(data), text.as_bytes()).map_err(|e| e.to_string())
}

/// Время «сейчас» в миллисекундах эпохи.
///
/// Отдельной функцией, чтобы `remember` можно было проверить тестом на любых
/// значениях времени, а не на настоящих часах.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-recent-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn newest_comes_first() {
        let dir = temp_dir("order");

        remember(&dir, Path::new(r"C:\п\первый.md"), 100).unwrap();
        remember(&dir, Path::new(r"C:\п\второй.md"), 200).unwrap();

        let entries = read(&dir);
        assert_eq!(entries[0].path, PathBuf::from(r"C:\п\второй.md"));
        assert_eq!(entries[1].path, PathBuf::from(r"C:\п\первый.md"));

        let _ = fs::remove_dir_all(&dir);
    }

    /// Повторное открытие поднимает запись, а не заводит вторую.
    #[test]
    fn reopening_moves_the_entry_up() {
        let dir = temp_dir("dedup");

        remember(&dir, Path::new(r"C:\п\а.md"), 100).unwrap();
        remember(&dir, Path::new(r"C:\п\б.md"), 200).unwrap();
        remember(&dir, Path::new(r"C:\п\а.md"), 300).unwrap();

        let entries = read(&dir);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, PathBuf::from(r"C:\п\а.md"));
        assert_eq!(entries[0].opened_at, 300);

        let _ = fs::remove_dir_all(&dir);
    }

    /// Тот же файл, записанный иначе, — это тот же файл.
    #[test]
    fn path_comparison_ignores_case_and_separators() {
        let dir = temp_dir("case");

        remember(&dir, Path::new(r"C:\Проект\Файл.md"), 100).unwrap();
        remember(&dir, Path::new(r"c:/проект/файл.md"), 200).unwrap();

        let entries = read(&dir);
        assert_eq!(entries.len(), 1, "{entries:?}");

        let _ = fs::remove_dir_all(&dir);
    }

    /// Список не растёт бесконечно.
    #[test]
    fn history_is_capped() {
        let dir = temp_dir("cap");

        for i in 0..(KEEP + 5) {
            remember(&dir, &PathBuf::from(format!(r"C:\п\{i}.md")), i as u64).unwrap();
        }

        assert_eq!(read(&dir).len(), KEEP);

        let _ = fs::remove_dir_all(&dir);
    }

    /// Испорченный файл — это «истории нет», а не отказ работать.
    #[test]
    fn broken_file_means_empty_history() {
        let dir = temp_dir("broken");
        fs::write(recent_path(&dir), "это не toml = = =").unwrap();

        assert!(read(&dir).is_empty());

        // И следующая запись его чинит, а не спотыкается о него.
        remember(&dir, Path::new(r"C:\п\а.md"), 100).unwrap();
        assert_eq!(read(&dir).len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    /// Файла нет — тоже пустая история, без ошибки.
    #[test]
    fn missing_file_means_empty_history() {
        let dir = temp_dir("missing");
        assert!(read(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Чужая версия формата не читается: поля могли поменять смысл.
    #[test]
    fn foreign_schema_is_ignored() {
        let dir = temp_dir("schema");
        fs::write(
            recent_path(&dir),
            "schema = 99\n\n[[entries]]\npath = 'C:\\\\п\\\\а.md'\nopened-at = 1\n",
        )
        .unwrap();

        assert!(read(&dir).is_empty());

        let _ = fs::remove_dir_all(&dir);
    }
}
