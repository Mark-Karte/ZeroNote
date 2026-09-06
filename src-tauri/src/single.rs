//! Одно приложение — один процесс.
//!
//! До задачи 69 второй запуск был делом редким и намеренным: человек дважды
//! щёлкал по ярлыку. С ассоциацией файлов он становится обычным — каждое
//! «Открыть в ZeroNote» и каждый двойной щелчок по `.md` запускают процесс.
//! А два процесса на одной папке данных — это две сессии, два набора
//! черновиков и потеря несохранённого у того, кто записал раньше: прямо
//! против инварианта 4.
//!
//! Поэтому второй экземпляр не открывает окна вовсе. Он оставляет первому
//! записку с путями и уходит; первый её подбирает, показывается и открывает
//! то, что в ней написано.
//!
//! **Ключ — папка данных, а не имя приложения.** Два экземпляра мешают друг
//! другу ровно тогда, когда пишут в одни и те же файлы. Отладочная сборка
//! и установленная держат разные папки и обязаны уживаться: на этом стоит
//! весь стенд ручных проверок и замеры.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager};

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
use windows_sys::Win32::System::Threading::CreateMutexW;
use windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;

/// Событие фронтенду: открыть эти пути. Приходит от второго экземпляра.
pub const OPEN_PATHS: &str = "open-paths";

/// Как часто первый экземпляр смотрит, не оставили ли ему записку.
///
/// Своя частота и свой поток, а не общий цикл с наблюдением за настройками
/// (`watch.rs`): у того шаг в полсекунды, и он смотрит десятки файлов.
/// Здесь ответ должен быть быстрым — человек ждёт окна, — а работа
/// на каждом шаге ровно одна: заглянуть в почти всегда пустую папку.
const POLL: Duration = Duration::from_millis(100);

/// Кто мы: первый экземпляр или второй.
pub enum Instance {
    /// Первый. Держит замок, пока живёт.
    First(Guard),
    /// Второй. Окна создавать не надо — надо передать пути и уйти.
    Second,
}

/// Замок, снимаемый вместе с процессом.
///
/// Хранится в `run()` до самого конца: `Drop` у него не формальность —
/// именно освобождение дескриптора отпускает имя для следующего запуска.
pub struct Guard(HANDLE);

impl Drop for Guard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // Пятый unsafe в проекте (прежние — `ReplaceFileW`, чтение буфера
            // обмена, корзина). Закрытие дескриптора, полученного строкой выше.
            unsafe { CloseHandle(self.0) };
        }
    }
}

/// Занять место единственного экземпляра для этой папки данных.
pub fn claim(data_dir: &Path) -> Instance {
    let name = mutex_name(data_dir);
    let wide: Vec<u16> = OsStr::new(&name).encode_wide().chain(Some(0)).collect();

    // Именованный мьютекс — самый дешёвый в системе способ спросить «а есть
    // ли уже такой процесс». Имя живёт в пространстве сеанса (`Local\`):
    // два пользователя на одной машине друг другу не мешают.
    //
    // Указатель на живой вектор с нулём на конце; вектор жив до конца функции.
    let handle = unsafe { CreateMutexW(std::ptr::null(), 1, wide.as_ptr()) };
    let taken = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;

    if handle.is_null() {
        // Системный вызов не удался. Считаем себя первыми: отказать человеку
        // в запуске из-за неудачи `CreateMutexW` хуже, чем открыть второе окно.
        return Instance::First(Guard(std::ptr::null_mut()));
    }

    if taken {
        unsafe { CloseHandle(handle) };
        return Instance::Second;
    }

    Instance::First(Guard(handle))
}

/// Передать пути первому экземпляру и разрешить ему выйти на передний план.
///
/// Пустой список — тоже записка: человек запустил ZeroNote с ярлыка, когда
/// тот уже работал, и ждёт, что окно покажется.
pub fn hand_over(data_dir: &Path, paths: &[String]) {
    let dir = requests_dir(data_dir);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }

    let name = format!("{}-{}", std::process::id(), nanos());
    let draft = dir.join(format!("{name}.tmp"));
    let ready = dir.join(format!("{name}.open"));

    // Сначала во временный файл, потом переименование. Читатель просматривает
    // папку опросом и обязан не увидеть записку, дописанную наполовину;
    // переименование внутри одной папки происходит целиком или никак.
    //
    // Имя своё у каждой записки: проводник запускает по процессу на выделенный
    // файл, и общее имя означало бы, что из пяти выбранных откроется один.
    if std::fs::write(&draft, paths.join("\n")).is_ok() {
        let _ = std::fs::rename(&draft, &ready);
    }

    allow_foreground();
}

/// Разрешить любому процессу вывести своё окно вперёд.
///
/// Windows не даёт программе перехватывать передний план, и без этого
/// разрешения первый экземпляр смог бы только помигать кнопкой на панели
/// задач. Разрешение выдаёт тот, у кого право есть, — то есть мы: нас только
/// что запустил проводник по щелчку человека.
fn allow_foreground() {
    // `ASFW_ANY` — «любой процесс». Числом, а не именем из `windows-sys`:
    // константа определена в документации Windows раз и навсегда, а имя
    // её в разных версиях крейта лежит в разных модулях.
    const ASFW_ANY: u32 = 0xFFFF_FFFF;
    unsafe { AllowSetForegroundWindow(ASFW_ANY) };
}

/// Забрать все оставленные записки. `None` — записок не было.
///
/// Пути из всех записок складываются в один список: пока мы спали, их могло
/// прийти несколько, и открыть надо всё.
pub fn take_requests(data_dir: &Path) -> Option<Vec<String>> {
    let entries = std::fs::read_dir(requests_dir(data_dir)).ok()?;

    let mut paths = Vec::new();
    let mut found = false;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("open") {
            continue;
        }

        found = true;
        if let Ok(text) = std::fs::read_to_string(&path) {
            paths.extend(text.lines().filter(|line| !line.is_empty()).map(str::to_owned));
        }
        // Записка одноразовая: прочли — убрали. Иначе она открывалась бы
        // снова на каждом шаге опроса.
        let _ = std::fs::remove_file(&path);
    }

    found.then_some(paths)
}

/// Следить за записками. Зовётся один раз, первым экземпляром.
pub fn watch(app: AppHandle, data_dir: PathBuf) {
    // Записки, оставшиеся с прошлого раза, принадлежат сеансу, который уже
    // кончился: первый экземпляр мог упасть, не успев их прочитать. Открыть
    // их сейчас значило бы показать человеку файлы, которых он в этот раз
    // не просил, — поэтому убираем молча.
    let _ = take_requests(&data_dir);

    std::thread::spawn(move || {
        loop {
            std::thread::sleep(POLL);

            let Some(paths) = take_requests(&data_dir) else {
                continue;
            };

            // Окно показывается всегда, даже если путей нет: записка без путей
            // и означает «покажись». Разворачиваем свёрнутое — иначе человек
            // получил бы ответ, которого не видно.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }

            if !paths.is_empty() {
                let _ = app.emit(OPEN_PATHS, paths);
            }
        }
    });
}

fn requests_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("requests")
}

fn nanos() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// Имя замка для этой папки данных.
///
/// Путь в имя мьютекса не годится: обратная косая черта там служебная,
/// а длина ограничена. Поэтому от пути берётся отпечаток — FNV-1a, четыре
/// строки, ничего криптографического здесь не нужно: совпадение отпечатков
/// у двух разных папок означало бы лишь то, что второй экземпляр отдал бы
/// свои пути чужому окну, а вероятность этого меньше вероятности отказа диска.
fn mutex_name(data_dir: &Path) -> String {
    // Пути в Windows нечувствительны к регистру, и `C:\ZeroNote` с
    // `c:\zeronote` — одна и та же папка. Без приведения регистра ярлык
    // и командная строка могли бы дать два «первых» экземпляра.
    let key = data_dir.to_string_lossy().to_lowercase();
    format!("Local\\ZeroNote-{:016x}", digest(&key))
}

fn digest(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zeronote-single-{tag}-{}", nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Имя замка зависит от папки данных и ни от чего больше.
    #[test]
    fn lock_name_follows_the_data_folder() {
        let installed = mutex_name(Path::new(r"C:\Users\user\AppData\Local\ZeroNote\data"));
        let debug = mutex_name(Path::new(r"C:\проект\src-tauri\target\debug\data"));

        assert_ne!(
            installed, debug,
            "установленная и отладочная сборки обязаны уживаться"
        );
        assert!(installed.starts_with("Local\\ZeroNote-"));
        // Обратной косой черты в имени быть не должно нигде, кроме пространства
        // имён: иначе система откажет в создании.
        assert_eq!(installed.matches('\\').count(), 1);
    }

    /// Регистр пути ничего не меняет: в Windows это одна и та же папка.
    #[test]
    fn lock_name_ignores_letter_case() {
        assert_eq!(
            mutex_name(Path::new(r"C:\ZeroNote\Data")),
            mutex_name(Path::new(r"c:\zeronote\data"))
        );
    }

    /// Записка доходит целиком и исчезает после прочтения.
    #[test]
    fn note_arrives_once() {
        let dir = temp_dir("note");
        let paths = vec![
            r"C:\заметки\список дел.md".to_owned(),
            r"D:\проект".to_owned(),
        ];

        hand_over(&dir, &paths);

        assert_eq!(take_requests(&dir), Some(paths));
        assert_eq!(take_requests(&dir), None, "записка одноразовая");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Записка без путей — это «покажись», а не «ничего не делать».
    /// Отличить её от отсутствия записки обязательно.
    #[test]
    fn empty_note_is_still_a_note() {
        let dir = temp_dir("empty");

        hand_over(&dir, &[]);

        assert_eq!(take_requests(&dir), Some(Vec::new()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Проводник запускает по процессу на каждый выделенный файл, и записок
    /// приходит несколько. Пропасть не должна ни одна.
    #[test]
    fn several_notes_add_up() {
        let dir = temp_dir("several");

        hand_over(&dir, &[r"C:\первый.md".to_owned()]);
        hand_over(&dir, &[r"C:\второй.md".to_owned()]);

        let mut paths = take_requests(&dir).expect("записки должны найтись");
        paths.sort();
        assert_eq!(paths, vec![r"C:\второй.md", r"C:\первый.md"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Пустой папки данных достаточно: отсутствие записок — не ошибка.
    #[test]
    fn no_notes_is_not_an_error() {
        let dir = temp_dir("none");
        assert_eq!(take_requests(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
