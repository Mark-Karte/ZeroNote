//! Отслеживание изменений файлов настроек и тем.
//!
//! Задача: правка `settings.toml` или файла темы должна применяться на лету,
//! без перезапуска приложения.
//!
//! Реализовано опросом времени изменения, а не подпиской на события файловой
//! системы. Причина — в DESIGN.md: крейт `notify` на этом этапе не берём,
//! а речь идёт о паре десятков маленьких файлов, которые опрашиваются два раза
//! в секунду. Затраты неизмеримы, зависимостей ноль.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter};

/// Событие, по которому фронтенд перезапрашивает оформление.
pub const APPEARANCE_CHANGED: &str = "appearance-changed";

const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Слепок состояния файлов: путь, время изменения, размер.
///
/// Размер учитывается вместе со временем не зря: файловые системы Windows
/// хранят время с грубым шагом, и быстрая правка может не изменить отметку.
type Snapshot = Vec<(PathBuf, Option<SystemTime>, u64)>;

fn snapshot(data_dir: &Path) -> Snapshot {
    let mut items: Snapshot = Vec::new();

    let mut record = |path: PathBuf| {
        match std::fs::metadata(&path) {
            Ok(meta) => items.push((path, meta.modified().ok(), meta.len())),
            // Отсутствие файла — тоже состояние: его удаление должно приводить
            // к перечитыванию, а не оставлять старые значения навсегда.
            Err(_) => items.push((path, None, 0)),
        }
    };

    record(data_dir.join("settings.toml"));

    if let Ok(entries) = std::fs::read_dir(data_dir.join("themes")) {
        let mut theme_files: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("toml"))
            .collect();
        // Порядок обхода директории не гарантирован, а сравнивать слепки надо
        // как есть, поэтому сортируем.
        theme_files.sort();
        for path in theme_files {
            record(path);
        }
    }

    items
}

/// Запустить наблюдение. Возврата не ждём: поток живёт столько же, сколько
/// процесс, и присоединяться к нему некому.
///
/// `move` передаёт в поток владение копией `AppHandle` и путём. `AppHandle`
/// специально сделан дешёвым для клонирования и пригодным к передаче между
/// потоками — это ручка к приложению, а не само приложение.
pub fn spawn(app: AppHandle, data_dir: PathBuf) {
    std::thread::spawn(move || {
        let mut previous = snapshot(&data_dir);

        loop {
            std::thread::sleep(POLL_INTERVAL);

            let current = snapshot(&data_dir);
            if current != previous {
                previous = current;
                // Само событие ничего не несёт: фронтенд в ответ запрашивает
                // полное состояние оформления. Так исключается рассинхронизация
                // между тем, что прислали, и тем, что лежит на диске.
                let _ = app.emit(APPEARANCE_CHANGED, ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-watch-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Слепок не должен зависеть от порядка, в котором операционная система
    /// вернула содержимое директории.
    #[test]
    fn snapshot_is_stable_between_calls() {
        let dir = temp_dir("stable");
        let themes = dir.join("themes");
        fs::create_dir_all(&themes).unwrap();
        fs::write(themes.join("б.toml"), "schema = 1").unwrap();
        fs::write(themes.join("а.toml"), "schema = 1").unwrap();

        assert_eq!(snapshot(&dir), snapshot(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Правка содержимого видна, даже если отметка времени не изменилась:
    /// за это отвечает размер в слепке.
    #[test]
    fn snapshot_notices_content_change() {
        let dir = temp_dir("change");
        let path = dir.join("settings.toml");
        fs::write(&path, "schema = 1").unwrap();

        let before = snapshot(&dir);
        fs::write(&path, "schema = 1\n[appearance]\ndensity = \"compact\"\n").unwrap();

        assert_ne!(before, snapshot(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Появление и удаление файла темы — тоже изменение.
    #[test]
    fn snapshot_notices_added_and_removed_theme() {
        let dir = temp_dir("add-remove");
        let themes = dir.join("themes");
        fs::create_dir_all(&themes).unwrap();

        let empty = snapshot(&dir);

        let path = themes.join("новая.toml");
        fs::write(&path, "schema = 1").unwrap();
        let with_theme = snapshot(&dir);
        assert_ne!(empty, with_theme);

        fs::remove_file(&path).unwrap();
        assert_eq!(empty, snapshot(&dir));
        let _ = fs::remove_dir_all(&dir);
    }
}
