//! Измерительный стенд.
//!
//! Живёт внутри основного бинарника намеренно: измерять нужно ровно тот
//! исполняемый файл, который получит пользователь. Отдельная сборка «для
//! замеров» давала бы числа про другую программу.
//!
//! Включается только аргументами командной строки. Без них ни одна из этих
//! команд не делает ничего, что влияло бы на обычную работу.

use std::sync::OnceLock;
use std::time::Instant;

/// Момент входа в `main`.
///
/// `OnceLock` — ячейка, в которую значение кладётся ровно один раз; после
/// записи чтение из любого потока бесплатно и без блокировки. Здесь она нужна
/// потому, что `Instant::now()` нельзя вычислить на этапе компиляции (значит,
/// обычная `static` не подходит), а читать значение будет поток, в котором
/// Tauri исполняет команды, — то есть не тот, в котором оно записано.
/// `Mutex` был бы избыточен: после записи значение уже не меняется.
/// `static mut` потребовал бы `unsafe` и здесь неуместен.
static PROCESS_START: OnceLock<Instant> = OnceLock::new();

/// Разобранные аргументы командной строки. Кладутся один раз при старте,
/// чтобы команды не разбирали `std::env::args()` заново на каждый вызов.
static CONFIG: OnceLock<BenchConfig> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchConfig {
    /// `Some("startup")`, `Some("ipc")` или `None` для обычного запуска.
    pub mode: Option<String>,
    /// Куда записать отчёт. Если `None`, отчёт показывается в окне.
    pub out_path: Option<String>,
}

/// Разбор аргументов вынесен в отдельную функцию, принимающую срез строк,
/// а не читающую `std::env` напрямую, — только ради тестируемости.
pub fn parse_args(args: &[String]) -> BenchConfig {
    let mut mode: Option<String> = None;
    let mut out_path: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--bench" => {
                mode = args.get(i + 1).cloned();
                i += 2;
            }
            "--bench-out" => {
                out_path = args.get(i + 1).cloned();
                i += 2;
            }
            _ => i += 1,
        }
    }

    // Признаём только известные режимы. Опечатка в аргументе должна давать
    // обычный запуск с явно пустым режимом, а не молча включать что-то другое.
    let mode = match mode.as_deref() {
        Some("startup") => Some("startup".to_owned()),
        Some("ipc") => Some("ipc".to_owned()),
        _ => None,
    };

    BenchConfig { mode, out_path }
}

/// Вызывается первой строкой `run()`, до построения окна.
pub fn init() {
    let _ = PROCESS_START.set(Instant::now());
    let args: Vec<String> = std::env::args().collect();
    let _ = CONFIG.set(parse_args(&args));
}

fn config() -> &'static BenchConfig {
    static FALLBACK: BenchConfig = BenchConfig {
        mode: None,
        out_path: None,
    };
    CONFIG.get().unwrap_or(&FALLBACK)
}

#[tauri::command]
pub fn bench_config() -> BenchConfig {
    config().clone()
}

/// Фронтенд сообщает, что первый кадр отрисован и окно показано.
/// Возвращает миллисекунды с входа в `main`.
#[tauri::command]
pub fn bench_ready(app: tauri::AppHandle) -> u128 {
    let ms = PROCESS_START
        .get()
        .map(|start| start.elapsed().as_millis())
        .unwrap_or(0);

    let cfg = config();
    if cfg.mode.as_deref() == Some("startup") {
        if let Some(path) = &cfg.out_path {
            // Ошибку записи намеренно не глушим до конца: скрипт стенда
            // увидит отсутствие файла и сообщит о провале замера.
            let _ = std::fs::write(path, ms.to_string());
        }
        app.exit(0);
    }

    ms
}

// --- Полезная нагрузка для замера границы Rust <-> фронтенд ---

const ASCII_LINE: &str =
    "fn main() { println!(\"hello\"); } // sample line used only by the benchmark\n";
const CYRILLIC_LINE: &str =
    "Заметка: строка образца для замера переноса текста через границу IPC.\n";

/// Собирает строку заданного размера повторением одной строки-образца.
fn generate(mib: usize, cyrillic: bool) -> String {
    let target = mib * 1024 * 1024;
    let line = if cyrillic { CYRILLIC_LINE } else { ASCII_LINE };

    // `with_capacity` — одна аллокация вместо цепочки перевыделений по мере
    // роста строки. Без неё замер мерил бы работу аллокатора, а не переноса.
    let mut out = String::with_capacity(target + line.len());
    while out.len() < target {
        out.push_str(line);
    }
    out
}

/// Базовая линия: сгенерировать и выбросить. Вычитая это из замеров ниже,
/// получаем стоимость собственно переноса.
#[tauri::command]
pub fn bench_gen_only(mib: usize, cyrillic: bool) -> usize {
    let text = generate(mib, cyrillic);
    // `black_box` не даёт оптимизатору выбросить генерацию как бесполезную.
    std::hint::black_box(&text).len()
}

/// Штатный путь Tauri: значение сериализуется в JSON и разбирается во фронтенде.
#[tauri::command]
pub fn bench_gen_text(mib: usize, cyrillic: bool) -> String {
    generate(mib, cyrillic)
}

/// Обход JSON: тело ответа уходит сырыми байтами, декодирование — на фронтенде.
#[tauri::command]
pub fn bench_gen_bytes(mib: usize, cyrillic: bool) -> tauri::ipc::Response {
    tauri::ipc::Response::new(generate(mib, cyrillic).into_bytes())
}

/// Обратное направление: текст приходит аргументом команды.
/// Это тот же путь, которым пойдут сброс черновика и сохранение файла.
#[tauri::command]
pub fn bench_sink_text(text: String) -> usize {
    std::hint::black_box(&text).len()
}

#[tauri::command]
pub fn bench_write_report(path: String, content: String) -> Result<(), String> {
    // Команда пишет по произвольному пути, поэтому доступна только когда стенд
    // явно включён аргументом командной строки. В обычном запуске — отказ.
    if config().mode.is_none() {
        return Err("измерительный стенд не включён".to_owned());
    }
    std::fs::write(&path, content).map_err(|e| format!("не удалось записать {path}: {e}"))
}

#[tauri::command]
pub fn bench_exit(app: tauri::AppHandle) {
    if config().mode.is_some() {
        app.exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    /// Обычный запуск — стенд выключен, даже если в аргументах есть путь к файлу.
    #[test]
    fn plain_launch_leaves_bench_off() {
        let cfg = parse_args(&args(&["zeronote.exe", "C:\\файл.txt"]));
        assert_eq!(cfg.mode, None);
        assert_eq!(cfg.out_path, None);
    }

    /// Режим и путь отчёта разбираются из аргументов.
    #[test]
    fn parses_mode_and_out_path() {
        let cfg = parse_args(&args(&[
            "zeronote.exe",
            "--bench",
            "startup",
            "--bench-out",
            "C:\\out.txt",
        ]));
        assert_eq!(cfg.mode.as_deref(), Some("startup"));
        assert_eq!(cfg.out_path.as_deref(), Some("C:\\out.txt"));
    }

    /// Опечатка в названии режима не должна включать стенд наполовину.
    #[test]
    fn unknown_mode_is_treated_as_plain_launch() {
        let cfg = parse_args(&args(&["zeronote.exe", "--bench", "startupp"]));
        assert_eq!(cfg.mode, None);
    }

    /// `--bench` последним аргументом не должен ронять разбор выходом за границу.
    #[test]
    fn mode_without_value_does_not_panic() {
        let cfg = parse_args(&args(&["zeronote.exe", "--bench"]));
        assert_eq!(cfg.mode, None);
    }

    /// Генератор выдаёт запрошенный размер с перебором не больше одной строки.
    #[test]
    fn generator_hits_requested_size() {
        for cyrillic in [false, true] {
            let text = generate(1, cyrillic);
            let target = 1024 * 1024;
            assert!(text.len() >= target);
            // Перебор не больше одной строки-образца.
            assert!(text.len() < target + 128);
        }
    }
}
