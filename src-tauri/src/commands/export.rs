//! Экспорт заметки для чужих глаз (задачи 110 и 111).
//!
//! Документ собирает фронтенд — вывод HTML живёт там же, где разбор
//! markdown (задача 108). Ядро только пишет готовое: атомарно (инвариант 3)
//! и только туда, куда человек указал в диалоге сохранения (Р-049).
//!
//! **Команда пишет не всякий файл.** Путь приходит из окна, и без проверки
//! она стала бы «запиши что угодно куда угодно» по IPC. Поэтому расширение
//! обязано быть тем, что экспорт и делает, — `.html` или `.htm`, — и в
//! `.obsidian` не пишется ничего (инвариант 2). Тот же приём, что у чтения
//! заготовок: путь проверяет ядро, а не тот, кто его прислал (Р-240).

use std::path::Path;

type Fallible<T> = Result<T, String>;

/// Можно ли писать экспорт по этому пути.
///
/// Отдельно от команды — ради проверки тестом без окна.
fn check_path(path: &Path, allowed: &[&str]) -> Fallible<()> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    if !allowed.contains(&extension.as_str()) {
        return Err(format!(
            "экспорт пишет только файлы {}, а не «{}»",
            allowed
                .iter()
                .map(|e| format!(".{e}"))
                .collect::<Vec<_>>()
                .join(" и "),
            path.display()
        ));
    }
    if crate::fsx::atomic_save::is_inside_obsidian(path) {
        return Err("в .obsidian ничего не пишется (инвариант 2)".to_owned());
    }
    Ok(())
}

/// Записать экспортированный HTML.
///
/// Существующий файл заменяется: о перезаписи уже спросил диалог
/// сохранения, и спрашивать второй раз — значит не верить ответу.
#[tauri::command]
pub fn write_html_export(path: String, html: String) -> Fallible<()> {
    let path = Path::new(&path);
    check_path(path, &["html", "htm"])?;
    crate::fsx::atomic_save::save(path, html.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-export-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Пишется только то, что экспорт и делает: окно не должно получить
    /// через эту команду запись любого файла.
    #[test]
    fn only_html_is_written() {
        let html = ["html", "htm"];
        assert!(check_path(Path::new(r"C:\заметки\план.html"), &html).is_ok());
        assert!(check_path(Path::new(r"C:\заметки\план.HTM"), &html).is_ok());
        assert!(check_path(Path::new(r"C:\заметки\план.md"), &html).is_err());
        assert!(check_path(Path::new(r"C:\заметки\план"), &html).is_err());
        assert!(check_path(Path::new(r"C:\Windows\evil.exe"), &html).is_err());
        assert!(check_path(Path::new(r"C:\хранилище\.obsidian\x.html"), &html).is_err());
    }

    /// Запись атомарная и заменяет прежний файл: о перезаписи спросил диалог.
    #[test]
    fn export_replaces_the_file() {
        let dir = temp_dir("write");
        let path = dir.join("заметка.html");
        std::fs::write(&path, "старое").unwrap();

        write_html_export(path.to_string_lossy().into_owned(), "<p>новое</p>".to_owned()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "<p>новое</p>");

        let refused = write_html_export(
            dir.join("заметка.md").to_string_lossy().into_owned(),
            "x".to_owned(),
        );
        assert!(refused.is_err());
        assert!(!dir.join("заметка.md").exists());

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
