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
use std::sync::atomic::{AtomicBool, Ordering};
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

    // В порядке прихода, а не имён: папка отдаёт записки по имени,
    // то есть по номеру процесса, и пять файлов из проводника вставали
    // вкладками вразнобой. Метка времени в имени — порядок запуска.
    let mut notes: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("open"))
        .collect();
    notes.sort_by_key(|path| stamp_of(path));

    let mut paths = Vec::new();
    let found = !notes.is_empty();

    for path in notes {
        if let Ok(text) = std::fs::read_to_string(&path) {
            paths.extend(text.lines().filter(|line| !line.is_empty()).map(str::to_owned));
        }
        // Записка одноразовая: прочли — убрали. Иначе она открывалась бы
        // снова на каждом шаге опроса.
        let _ = std::fs::remove_file(&path);
    }

    found.then_some(paths)
}

/// Момент, от которого записки считаются своими. Берётся до `claim`.
///
/// Той же меркой, что метка в имени записки (`nanos`): второй экземпляр
/// ставит её после того, как не смог занять замок, — то есть заведомо
/// позже этого момента.
pub fn stamp() -> u128 {
    nanos()
}

/// Убрать записки, оставшиеся с прошлого раза.
///
/// Они принадлежат сеансу, который уже кончился: первый экземпляр мог упасть,
/// не успев их прочитать. Открыть их сейчас значило бы показать человеку
/// файлы, которых он в этот раз не просил, — поэтому убираем молча.
///
/// **Только старше `since`** (находка Я6 ревизии). До задачи 142 здесь
/// стояло `take_requests` — «убрать всё», — а зовётся уборка из `setup`,
/// через сотни миллисекунд после занятия замка. Проводник запускает
/// по процессу на каждый выделенный файл, братья успевают оставить записки
/// в это окно, и из пяти выбранных при холодном старте открывался один.
/// Метка в имени записки (`{pid}-{nanos}`) говорит, когда её оставили;
/// имя без метки — не наша записка, её тоже убираем. Недописанный `.tmp`
/// от упавшего брата — туда же, иначе он лежал бы вечно.
pub fn discard_stale(data_dir: &Path, since: u128) {
    let Ok(entries) = std::fs::read_dir(requests_dir(data_dir)) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let fresh = stamp_of(&path).is_some_and(|left_at| left_at >= since);
        if !fresh {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// Почтовый ящик первого экземпляра: записки лежат в папке, пока окно
/// не готово их принять (находка Я6 ревизии).
///
/// Пути уходят фронтенду событием, а событие Tauri без подписчика
/// не копится — уходит в пустоту. Подписывается же фронтенд поздно:
/// после раскладки клавиш, восстановления сессии и своих путей из командной
/// строки. До задачи 142 поток опроса забирал записку (и удалял её) сразу,
/// и пути братьев, пришедшие при холодном старте, терялись.
///
/// Теперь поток не трогает записок, пока фронтенд не подписался и не забрал
/// накопленное сам (`open`). `AtomicBool`, а не `Mutex<bool>`: флаг один,
/// меняется один раз и читается раз в сотню миллисекунд из другого потока —
/// атомарной переменной тут достаточно, и заблокироваться на ней нельзя.
/// `Ordering::SeqCst` — самый строгий порядок и самый простой для
/// рассуждений; на флаге, который читают раз в сотню миллисекунд,
/// разницы в скорости с более слабыми нет.
#[derive(Default)]
pub struct Mailbox {
    ready: AtomicBool,
}

impl Mailbox {
    /// Для потока опроса: записки, если окно уже слушает, иначе `None`.
    pub fn collect(&self, data_dir: &Path) -> Option<Vec<String>> {
        if !self.ready.load(Ordering::SeqCst) {
            return None;
        }
        take_requests(data_dir)
    }

    /// Фронтенд подписался на `OPEN_PATHS`: отдать накопленное и дальше
    /// слать событием. Флаг ставится до чтения: записка, пришедшая между
    /// ними, уйдёт событием к уже готовому слушателю, а не пропадёт.
    pub fn open(&self, data_dir: &Path) -> Vec<String> {
        self.ready.store(true, Ordering::SeqCst);
        take_requests(data_dir).unwrap_or_default()
    }
}

/// Следить за записками. Зовётся один раз, первым экземпляром.
///
/// `since` — момент перед занятием замка (`stamp`): записки старше него
/// остались от прошлого сеанса.
pub fn watch(app: AppHandle, data_dir: PathBuf, since: u128) {
    discard_stale(&data_dir, since);

    std::thread::spawn(move || {
        loop {
            std::thread::sleep(POLL);

            // Ящик кладётся в состояние приложения до `setup` (`lib.rs`),
            // так что здесь он есть всегда.
            let Some(paths) = app.state::<Mailbox>().collect(&data_dir) else {
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

/// Когда оставлена записка: метка из её имени `{pid}-{nanos}`.
/// `None` — имя не наше.
fn stamp_of(path: &Path) -> Option<u128> {
    path.file_stem()?.to_str()?.rsplit_once('-')?.1.parse().ok()
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

        // В порядке прихода: так они и встанут вкладками.
        let paths = take_requests(&dir).expect("записки должны найтись");
        assert_eq!(paths, vec![r"C:\первый.md", r"C:\второй.md"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Записки — в порядке прихода, а не имён: имя начинается номером
    /// процесса, и папка отдаёт их по нему. Здесь процесс 1 пришёл позже
    /// процесса 2.
    #[test]
    fn notes_come_in_arrival_order() {
        let dir = temp_dir("order");
        let requests = requests_dir(&dir);
        std::fs::create_dir_all(&requests).unwrap();
        std::fs::write(requests.join("1-200.open"), r"C:\второй.md").unwrap();
        std::fs::write(requests.join("2-100.open"), r"C:\первый.md").unwrap();

        assert_eq!(
            take_requests(&dir),
            Some(vec![r"C:\первый.md".to_owned(), r"C:\второй.md".to_owned()])
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Холодный старт (Я6 ревизии): брат оставил записку после того, как
    /// первый занял замок, но до уборки в `setup`. Уборка её не трогает,
    /// а записку прошлого сеанса и мусор без метки — убирает.
    #[test]
    fn startup_cleanup_keeps_fresh_notes() {
        let dir = temp_dir("stale");
        hand_over(&dir, &[r"C:\прошлый раз.md".to_owned()]);
        std::fs::write(requests_dir(&dir).join("чужое.open"), r"C:\чужое.md").unwrap();

        let since = stamp();
        hand_over(&dir, &[r"C:\брат.md".to_owned()]);
        discard_stale(&dir, since);

        assert_eq!(take_requests(&dir), Some(vec![r"C:\брат.md".to_owned()]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Пока окно не подписалось, записки лежат: событие без подписчика
    /// ушло бы в пустоту (Я6 ревизии). Подписавшись, фронтенд забирает
    /// накопленное сам, а дальше записки идут потоку опроса.
    #[test]
    fn notes_wait_until_the_window_listens() {
        let dir = temp_dir("mailbox");
        let mailbox = Mailbox::default();

        hand_over(&dir, &[r"C:\первый.md".to_owned()]);
        assert_eq!(mailbox.collect(&dir), None, "окно ещё не слушает");

        assert_eq!(mailbox.open(&dir), vec![r"C:\первый.md".to_owned()]);

        hand_over(&dir, &[r"C:\второй.md".to_owned()]);
        assert_eq!(mailbox.collect(&dir), Some(vec![r"C:\второй.md".to_owned()]));
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
