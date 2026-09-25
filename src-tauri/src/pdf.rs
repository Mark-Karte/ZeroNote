//! «Экспорт в PDF» одной командой — `PrintToPdf` WebView2 (задача 111, Р-271).
//!
//! Печать через диалог (задача 109) уже умеет «Сохранить в формате PDF»,
//! но это три шага и чужой адрес в колонтитуле: колонтитулы печати
//! страница не настраивает. Здесь тот же движок печати WebView2 зовётся
//! напрямую, со своими настройками листа — A4, поле из темы, в шапке имя
//! файла, в подвале номер страницы и **никакого адреса**.
//!
//! **Седьмой модуль с `unsafe`** — решение владельца (вопрос 2 плана
//! этапа 16). WebView2 говорит только через COM, а все методы COM-объектов
//! в привязках объявлены `unsafe`: компилятор не может проверить, что
//! объект жив и вызывается из своего потока. Мы это обеспечиваем так:
//!
//! * всё здесь выполняется **в потоке окна** — Tauri зовёт замыкание
//!   `with_webview` именно там, а COM-объекты WebView2 живут в нём;
//! * объекты берутся у самого Tauri (`controller`, `environment`) и держатся
//!   ровно на время вызова — счёт ссылок COM ведут обёртки `windows-core`;
//! * о завершении WebView2 сообщает обработчиком, тоже в потоке окна;
//!   ответ уходит каналом команде, которая ждёт его в стороне.
//!
//! `webview2-com` и `windows-core` стали прямыми зависимостями, но нового
//! кода в сборку не принесли: той же версии их уже тянет сам Tauri.

use std::path::PathBuf;
use std::sync::mpsc::Sender;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_7, ICoreWebView2Environment6, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows_core::{Interface, HSTRING};

/// Лист A4 в дюймах — единицах настроек печати WebView2. A4 — решение
/// владельца (вопрос 3 плана этапа 16).
pub const A4_WIDTH_IN: f64 = 210.0 / 25.4;
pub const A4_HEIGHT_IN: f64 = 297.0 / 25.4;

/// Поле страницы, если токен темы не разобрался: те же 20 мм.
pub const DEFAULT_MARGIN_IN: f64 = 20.0 / 25.4;

/// Что напечатать на листе, кроме самого документа.
#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    /// Поле со всех сторон, в дюймах.
    pub margin: f64,
    /// Заголовок в шапке — имя файла.
    pub title: String,
}

/// Длина CSS — в дюймы. Понимает `mm`, `cm`, `in`, `pt`, `px` (у CSS
/// 96 точек и 72 пункта на дюйм). Прочее — `None`: поле страницы берётся
/// из файла темы, и угадывать в нём единицы мы не будем.
pub fn inches(value: &str) -> Option<f64> {
    let text = value.trim();
    let split = text.find(|c: char| c.is_ascii_alphabetic())?;
    let (number, unit) = text.split_at(split);
    let number: f64 = number.trim().parse().ok()?;
    if !number.is_finite() || number < 0.0 {
        return None;
    }
    let per_inch = match unit {
        "mm" => 25.4,
        "cm" => 2.54,
        "in" => 1.0,
        "pt" => 72.0,
        "px" => 96.0,
        _ => return None,
    };
    Some(number / per_inch)
}

/// Начать печать документа окна в PDF по пути `target`.
///
/// Зовётся из `with_webview`, то есть в потоке окна. Возвращается сразу:
/// WebView2 печатает сам и сообщает о конце обработчиком. Ответ — в `done`,
/// ровно один раз: и при ошибке до начала, и по завершении.
pub fn start(
    webview: tauri::webview::PlatformWebview,
    target: PathBuf,
    page: Page,
    done: Sender<Result<(), String>>,
) {
    let answer = done.clone();
    if let Err(problem) = begin(&webview, &target, &page, answer) {
        let _ = done.send(Err(problem));
    }
}

fn begin(
    webview: &tauri::webview::PlatformWebview,
    target: &std::path::Path,
    page: &Page,
    done: Sender<Result<(), String>>,
) -> Result<(), String> {
    let failed = |what: &str, e: windows_core::Error| format!("{what}: {}", e.message());

    // SAFETY: мы в потоке окна (см. шапку модуля) — там, где живут объекты
    // WebView2; объекты получены у Tauri и живы, пока живо окно, а окно живо,
    // раз Tauri позвал нас из него. Каждый вызов ниже — метод COM с ожидаемыми
    // аргументами: строки `HSTRING` держатся до конца вызова, числа — в тех
    // единицах, что требует WebView2.
    unsafe {
        let core = webview
            .controller()
            .CoreWebView2()
            .map_err(|e| failed("вебвью окна недоступен", e))?;
        // Печать в PDF появилась в WebView2 1.0.1020 — у всех, кто обновлял
        // Windows за последние годы. Старее — честный отказ, а не падение.
        let printer: ICoreWebView2_7 = core
            .cast()
            .map_err(|_| "WebView2 слишком старый: печати в PDF в нём нет".to_owned())?;
        let environment: ICoreWebView2Environment6 = webview
            .environment()
            .cast()
            .map_err(|_| "WebView2 слишком старый: настроек печати в нём нет".to_owned())?;

        let settings = environment
            .CreatePrintSettings()
            .map_err(|e| failed("настройки печати не создались", e))?;
        let apply = |result: windows_core::Result<()>| result.map_err(|e| failed("настройка листа", e));
        apply(settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT))?;
        apply(settings.SetPageWidth(A4_WIDTH_IN))?;
        apply(settings.SetPageHeight(A4_HEIGHT_IN))?;
        apply(settings.SetMarginTop(page.margin))?;
        apply(settings.SetMarginBottom(page.margin))?;
        apply(settings.SetMarginLeft(page.margin))?;
        apply(settings.SetMarginRight(page.margin))?;
        // Подложки блоков кода и коллаутов — часть документа, как и на экране.
        apply(settings.SetShouldPrintBackgrounds(true))?;
        // Свои колонтитулы: в шапке имя файла, в подвале номер страницы.
        // Пустой адрес убирает из подвала адрес страницы приложения — ради
        // этого задача и делалась.
        apply(settings.SetShouldPrintHeaderAndFooter(true))?;
        apply(settings.SetHeaderTitle(&HSTRING::from(page.title.as_str())))?;
        apply(settings.SetFooterUri(&HSTRING::new()))?;

        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, written| {
            let answer = match result {
                Err(e) => Err(format!("PDF не записан: {}", e.message())),
                Ok(()) if !written => Err("WebView2 не смог записать PDF".to_owned()),
                Ok(()) => Ok(()),
            };
            let _ = done.send(answer);
            Ok(())
        }));

        printer
            .PrintToPdf(&HSTRING::from(target), &settings, &handler)
            .map_err(|e| failed("печать в PDF не началась", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn css_lengths_become_inches() {
        assert!(close(inches("20mm").unwrap(), 20.0 / 25.4));
        assert!(close(inches("2.54cm").unwrap(), 1.0));
        assert!(close(inches("0.5in").unwrap(), 0.5));
        assert!(close(inches("72pt").unwrap(), 1.0));
        assert!(close(inches("96px").unwrap(), 1.0));
    }

    /// Поле приходит из файла темы — незнакомое не угадывается.
    #[test]
    fn strange_lengths_are_refused() {
        assert_eq!(inches("20"), None);
        assert_eq!(inches("2em"), None);
        assert_eq!(inches("-5mm"), None);
        assert_eq!(inches("mm"), None);
        assert_eq!(inches("20mm; x"), None);
    }

    #[test]
    fn a4_is_a4() {
        assert!(close(A4_WIDTH_IN * 25.4, 210.0));
        assert!(close(A4_HEIGHT_IN * 25.4, 297.0));
    }
}
