//! Разрешение путей к данным приложения.
//!
//! Единственное место, где решается, куда приложение кладёт свои файлы.
//! Остальной код спрашивает у этого модуля и никогда не собирает пути сам —
//! иначе решение Р-008 разъедется по кодовой базе и его нельзя будет изменить.

use std::fs;
use std::path::{Path, PathBuf};

/// Где в итоге лежат данные и почему именно там.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDir {
    pub path: PathBuf,
    /// `true` — данные рядом с исполняемым файлом, как задумано.
    /// `false` — папка приложения оказалась недоступна на запись, ушли в запасную.
    pub portable: bool,
}

#[derive(Debug)]
pub enum DataDirError {
    /// Ни основная, ни запасная папка не доступны на запись.
    /// Молча продолжать нельзя: черновики (инвариант 4) писать будет некуда.
    NoWritableLocation { preferred: PathBuf, fallback: PathBuf },
}

impl std::fmt::Display for DataDirError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DataDirError::NoWritableLocation {
                preferred,
                fallback,
            } => write!(
                f,
                "нет папки для данных, доступной на запись: ни {}, ни {}",
                preferred.display(),
                fallback.display()
            ),
        }
    }
}

impl std::error::Error for DataDirError {}

/// Проверка «сюда действительно можно писать».
///
/// Проверяется не признаком «только для чтения» и не правами в дескрипторе
/// безопасности, а настоящей записью файла: только так учитываются и ACL,
/// и групповые политики, и носитель с аппаратной защитой от записи.
fn is_writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }

    let probe = dir.join(".zeronote-write-probe");
    match fs::write(&probe, b"") {
        Ok(()) => {
            // Пробный файл убираем сразу. Если удалить не вышло — записать всё
            // равно смогли, значит папка годится; мусор в один пустой файл
            // не повод уходить в запасную папку.
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Ядро решения, отделённое от того, откуда взялись пути, — ради тестов.
///
/// Оба аргумента — заимствованные `&Path`, а не `PathBuf`: функции достаточно
/// посмотреть на путь, владеть им она не должна. Результат владеет своей копией.
pub fn choose_data_dir(preferred: &Path, fallback: &Path) -> Result<DataDir, DataDirError> {
    if is_writable(preferred) {
        return Ok(DataDir {
            path: preferred.to_path_buf(),
            portable: true,
        });
    }

    if is_writable(fallback) {
        return Ok(DataDir {
            path: fallback.to_path_buf(),
            portable: false,
        });
    }

    Err(DataDirError::NoWritableLocation {
        preferred: preferred.to_path_buf(),
        fallback: fallback.to_path_buf(),
    })
}

/// Основной вариант: папка `data` рядом с исполняемым файлом.
fn preferred_dir() -> PathBuf {
    match std::env::current_exe() {
        Ok(exe) => match exe.parent() {
            Some(dir) => dir.join("data"),
            // У исполняемого файла всегда есть родитель; ветка недостижима
            // на практике, но паниковать из-за неё незачем.
            None => PathBuf::from("data"),
        },
        Err(_) => PathBuf::from("data"),
    }
}

/// Запасной вариант: `%LOCALAPPDATA%\ZeroNote`.
fn fallback_dir() -> PathBuf {
    match std::env::var_os("LOCALAPPDATA") {
        Some(local) => PathBuf::from(local).join("ZeroNote"),
        // Переменной нет только в очень поломанном окружении.
        // Тогда пусть будет хотя бы рядом с текущей директорией.
        None => PathBuf::from(".zeronote"),
    }
}

/// Полное разрешение с реальными путями окружения.
pub fn resolve() -> Result<DataDir, DataDirError> {
    choose_data_dir(&preferred_dir(), &fallback_dir())
}

impl DataDir {
    pub fn settings_file(&self) -> PathBuf {
        self.path.join("settings.toml")
    }

    pub fn themes_dir(&self) -> PathBuf {
        self.path.join("themes")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Временная папка для теста. Своя, чтобы не тащить зависимость ради
    /// нескольких строк: имя уникально за счёт идентификатора потока и времени.
    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-test-{tag}-{nanos}"));
        fs::create_dir_all(&dir).expect("не удалось создать временную папку");
        dir
    }

    /// Обычный случай: папка рядом с приложением доступна на запись.
    #[test]
    fn prefers_portable_location() {
        let base = temp_dir("portable");
        let preferred = base.join("app/data");
        let fallback = base.join("local/ZeroNote");

        let result = choose_data_dir(&preferred, &fallback).expect("должна найтись папка");

        assert_eq!(result.path, preferred);
        assert!(result.portable);
        let _ = fs::remove_dir_all(&base);
    }

    /// Папка рядом с приложением недоступна — уходим в запасную и помечаем это.
    #[test]
    fn falls_back_when_preferred_is_not_writable() {
        let base = temp_dir("fallback");
        let fallback = base.join("local/ZeroNote");

        // Файл вместо папки: create_dir_all на такой путь заведомо не сработает.
        let blocker = base.join("blocked");
        // Литерал b"..." принимает только ASCII, поэтому обычная строка:
        // fs::write берёт всё, что приводится к срезу байтов, и &str подходит.
        fs::write(&blocker, "это файл, а не папка").expect("не удалось создать файл-заглушку");
        let preferred = blocker.join("data");

        let result = choose_data_dir(&preferred, &fallback).expect("должна найтись запасная папка");

        assert_eq!(result.path, fallback);
        assert!(
            !result.portable,
            "переход в запасную папку обязан быть виден вызывающему коду"
        );
        let _ = fs::remove_dir_all(&base);
    }

    /// Обе недоступны — это ошибка, а не тихое продолжение работы:
    /// иначе черновики писать будет некуда и инвариант 4 нарушится молча.
    #[test]
    fn reports_error_when_nothing_is_writable() {
        let base = temp_dir("nowhere");
        let blocker = base.join("blocked");
        // Литерал b"..." принимает только ASCII, поэтому обычная строка:
        // fs::write берёт всё, что приводится к срезу байтов, и &str подходит.
        fs::write(&blocker, "это файл, а не папка").expect("не удалось создать файл-заглушку");

        let result = choose_data_dir(&blocker.join("data"), &blocker.join("local"));

        assert!(result.is_err());
        let _ = fs::remove_dir_all(&base);
    }

    /// Пробный файл не должен оставаться в папке пользователя.
    #[test]
    fn write_probe_leaves_no_trace() {
        let base = temp_dir("probe");
        let dir = base.join("data");

        assert!(is_writable(&dir));

        let leftovers: Vec<_> = fs::read_dir(&dir)
            .expect("папка должна была появиться")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name())
            .collect();
        assert!(leftovers.is_empty(), "остался мусор: {leftovers:?}");
        let _ = fs::remove_dir_all(&base);
    }
}
