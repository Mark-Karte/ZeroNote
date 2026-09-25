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

/// Сколько ждать WebView2. Лист печатается за доли секунды, сотня страниц —
/// за несколько; две минуты — предел, за которым ждать уже нечего.
const PDF_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Записать PDF документа, который окно уже поставило в режим печати
/// (задача 111).
///
/// Печатает WebView2 (`pdf::start`), в потоке окна. Пишет он сам и не
/// атомарно, поэтому пишет **во временный файл**, а на место его кладёт
/// наша атомарная запись (инвариант 3): иначе сбой посреди печати оставил
/// бы вместо прежнего PDF полупустой. Команда асинхронная и ждёт ответа
/// в отдельном потоке — поток окна в это время свободен: сама печать
/// идёт в нём же.
#[tauri::command]
pub async fn export_pdf(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::state::AppState>,
    path: String,
    title: String,
) -> Fallible<()> {
    let target = std::path::PathBuf::from(&path);
    check_path(&target, &["pdf"])?;

    // Поле страницы — тот же токен, что у печати через диалог (Р-268).
    let margin = crate::commands::appearance::build_print(&state.data_dir.path)
        .tokens
        .get("space-print-page")
        .and_then(|value| crate::pdf::inches(value))
        .unwrap_or(crate::pdf::DEFAULT_MARGIN_IN);

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // Во временной папке и с приставкой `zeronote-`: если что-то пойдёт
    // совсем не так, файл уберёт та же чистка, что и папки тестов.
    let temp = std::env::temp_dir().join(format!("zeronote-pdf-{nanos}.pdf"));

    let (done, answer) = std::sync::mpsc::channel();
    let page = crate::pdf::Page { margin, title };
    let printing = temp.clone();
    window
        .with_webview(move |webview| crate::pdf::start(webview, printing, page, done))
        .map_err(|e| format!("окно недоступно: {e}"))?;

    let printed = tauri::async_runtime::spawn_blocking(move || answer.recv_timeout(PDF_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|_| Err("WebView2 не ответил за две минуты".to_owned()));

    let written = printed.and_then(|()| {
        let bytes = std::fs::read(&temp).map_err(|e| format!("PDF не прочитан: {e}"))?;
        crate::fsx::atomic_save::save(&target, &bytes).map_err(|e| e.to_string())
    });
    let _ = std::fs::remove_file(&temp);
    written
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// PDF — только `.pdf`: команда не должна писать им что-то другое.
    #[test]
    fn only_pdf_is_printed() {
        assert!(check_path(Path::new(r"C:\заметки\план.pdf"), &["pdf"]).is_ok());
        assert!(check_path(Path::new(r"C:\заметки\план.PDF"), &["pdf"]).is_ok());
        assert!(check_path(Path::new(r"C:\заметки\план.html"), &["pdf"]).is_err());
        assert!(check_path(Path::new(r"C:\хранилище\.obsidian\план.pdf"), &["pdf"]).is_err());
    }

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
