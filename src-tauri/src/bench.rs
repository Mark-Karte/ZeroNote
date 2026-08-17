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
        Some("open") => Some("open".to_owned()),
        Some("tree") => Some("tree".to_owned()),
        Some("index") => Some("index".to_owned()),
        Some("highlight") => Some("highlight".to_owned()),
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

// --- Замер открытия файла: диск -> байты -> определение -> раскодирование ---

/// Сколько раз повторяется каждый замер. Берётся медиана.
const OPEN_RUNS: usize = 7;

/// Прогнать замер открытия файлов и вернуть готовый отчёт.
///
/// Замер целиком в Rust намеренно: это путь, которым файл попадает в буфер,
/// и границы IPC в нём нет. Смешивать одно с другим — значит мерить не то.
#[tauri::command]
pub fn bench_run_open() -> Result<String, String> {
    use crate::text::document;
    use crate::text::encoding::{encode, Encoding};

    let dir = std::env::temp_dir().join(format!("zeronote-bench-open-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let line = "Съешь же ещё этих мягких французских булок, да выпей чаю. 0123456789\r\n";

    let mut report = String::from("| Файл | Размер | Открытие (медиана) | Строк |\n|---|---|---|---|\n");

    for (label, encoding, mib) in [
        ("UTF-8", Encoding::Utf8, 5usize),
        ("windows-1251", Encoding::Windows1251, 5),
        ("UTF-16 LE", Encoding::Utf16Le, 5),
        ("UTF-8", Encoding::Utf8, 10),
    ] {
        // Собираем текст такого размера, чтобы ФАЙЛ вышел нужного размера:
        // в UTF-16 байт вдвое больше, чем в UTF-8, в windows-1251 вдвое меньше.
        //
        // Длина строки в байтах считается один раз. Наращивать текст, каждый
        // раз перекодируя его целиком ради проверки размера, — квадратичная
        // работа: на пяти мегабайтах это десятки секунд вместо миллисекунд.
        let target_bytes = mib * 1024 * 1024;
        let line_bytes = encode(line, encoding).map_err(|e| e.to_string())?.len();
        let repeats = target_bytes.div_ceil(line_bytes);

        let mut text = String::with_capacity(line.len() * repeats);
        for _ in 0..repeats {
            text.push_str(line);
        }

        let bytes = encode(&text, encoding).map_err(|e| e.to_string())?;
        let path = dir.join(format!("{}-{mib}.txt", encoding.label().replace(' ', "")));
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;

        let mut samples = Vec::with_capacity(OPEN_RUNS);
        let mut lines = 0usize;

        // Прогревочный проход: первое чтение оплачивает попадание файла в кэш.
        let _ = std::fs::read(&path);

        for _ in 0..OPEN_RUNS {
            let start = Instant::now();
            let raw = std::fs::read(&path).map_err(|e| e.to_string())?;
            let document = document::read(&raw).map_err(|e| e.to_string())?;
            samples.push(start.elapsed().as_secs_f64() * 1000.0);
            lines = document.text.lines().count();
        }

        samples.sort_by(|a, b| a.partial_cmp(b).expect("время не бывает NaN"));
        let median = samples[samples.len() / 2];

        report.push_str(&format!(
            "| {label} | {mib} МиБ | {median:.1} мс | {lines} |\n"
        ));
    }

    let _ = std::fs::remove_dir_all(&dir);
    Ok(report)
}

// --- Замер дерева файлов: чтение папки и полный обход ---

/// Сколько файлов в стенде дерева. Число из спецификации: показатели этапа 2
/// сформулированы про хранилище на десять тысяч файлов.
const TREE_FILES: usize = 10_000;

/// Разложить файлы по папкам и вернуть путь к стенду.
///
/// Раскладка нарочно двоякая, и обе части полноразмерные: цель про папку
/// на десять тысяч записей должна мериться папкой на десять тысяч записей,
/// а не половиной от неё.
///
/// * `плоская` — все файлы в одном каталоге. Худший случай для чтения.
/// * `раздел-NNN` — сотня папок по сотне файлов. Обычная форма хранилища.
fn make_tree_fixture(dir: &std::path::Path) -> std::io::Result<()> {
    let flat = dir.join("плоская");
    std::fs::create_dir_all(&flat)?;
    for i in 0..TREE_FILES {
        std::fs::write(flat.join(format!("заметка-{i:05}.md")), "# заметка\n")?;
    }

    for folder in 0..100 {
        let nested = dir.join(format!("раздел-{folder:03}"));
        std::fs::create_dir_all(&nested)?;
        for i in 0..(TREE_FILES / 100) {
            std::fs::write(nested.join(format!("файл-{i:03}.md")), "# заметка\n")?;
        }
    }

    // То, что должно быть отсеяно правилами: стенд обязан мерить и эту работу.
    let junk = dir.join("node_modules/пакет");
    std::fs::create_dir_all(&junk)?;
    for i in 0..200 {
        std::fs::write(junk.join(format!("модуль-{i}.js"), ), "// мусор\n")?;
    }

    Ok(())
}

/// Полный обход дерева с учётом правил игнорирования.
///
/// Дереву он не нужен — оно читает по папке. Нужен индексу (задача 11),
/// и замерить его цену стоит заранее: именно она определяет, укладывается ли
/// индексация в обещанные тридцать секунд.
fn walk_all(root: &std::path::Path) -> usize {
    let mut count = 0usize;
    let mut stack = vec![root.to_path_buf()];

    let rules = crate::project::ignore::build(root, &crate::project::IgnoreSettings::default());

    while let Some(dir) = stack.pop() {
        let Ok(entries) = crate::tree::read_children(&dir, &rules) else {
            continue;
        };
        for entry in entries {
            if entry.is_dir && !entry.is_link {
                stack.push(entry.path);
            } else {
                count += 1;
            }
        }
    }
    count
}

/// Прогнать замер дерева и вернуть готовый отчёт.
#[tauri::command]
pub fn bench_run_tree() -> Result<String, String> {
    use crate::project::{IgnoreSettings, ignore};

    let dir = std::env::temp_dir().join(format!("zeronote-bench-tree-{}", std::process::id()));
    // Стенд собирается заново каждый прогон: остатки прошлого дали бы другое
    // число файлов, а значит несравнимые замеры.
    let _ = std::fs::remove_dir_all(&dir);

    let build_start = Instant::now();
    make_tree_fixture(&dir).map_err(|e| e.to_string())?;
    let build_ms = build_start.elapsed().as_secs_f64() * 1000.0;

    let rules = ignore::build(&dir, &IgnoreSettings::default());

    let mut report = String::from("| Что | Записей | Время (медиана) |\n|---|---|---|\n");

    for (label, path) in [
        ("Корень проекта", dir.clone()),
        ("Плоская папка", dir.join("плоская")),
    ] {
        // Прогрев: первое чтение оплачивает попадание каталога в кэш.
        let _ = crate::tree::read_children(&path, &rules);

        let mut samples = Vec::with_capacity(OPEN_RUNS);
        let mut count = 0usize;
        for _ in 0..OPEN_RUNS {
            let start = Instant::now();
            let entries = crate::tree::read_children(&path, &rules).map_err(|e| e.to_string())?;
            samples.push(start.elapsed().as_secs_f64() * 1000.0);
            count = entries.len();
        }
        samples.sort_by(|a, b| a.partial_cmp(b).expect("время не бывает NaN"));
        report.push_str(&format!(
            "| {label} | {count} | {:.1} мс |\n",
            samples[samples.len() / 2]
        ));
    }

    // Полный обход — один раз: он дорогой, и медиана из семи прогонов мерила бы
    // кэш файловой системы, а не работу.
    let walk_start = Instant::now();
    let walked = walk_all(&dir);
    let walk_ms = walk_start.elapsed().as_secs_f64() * 1000.0;
    report.push_str(&format!("| Полный обход | {walked} | {walk_ms:.0} мс |\n"));

    report.push_str(&format!(
        "\nСтенд: {} файлов ({TREE_FILES} в одной папке и столько же по сотне\n\
         папок), собран за {build_ms:.0} мс.\n\
         Дерево читает по одной папке, поэтому его цена — вторая строка,\n\
         а не последняя. Полный обход понадобится индексу (задача 11).\n",
        TREE_FILES * 2
    ));

    let _ = std::fs::remove_dir_all(&dir);
    Ok(report)
}

// --- Замер индексации ---

/// Прогнать замер индексации и вернуть готовый отчёт.
///
/// Меряется то, что определяет ощущение от работы: сколько идёт первая полная
/// индексация хранилища, во что обходится повторный проход (он же — старт
/// с готовым индексом) и сколько занимает поиск.
#[tauri::command]
pub fn bench_run_index() -> Result<String, String> {
    use crate::index::{jobs, query, schema, writer};
    use crate::project::{IgnoreSettings, ignore};

    let dir = std::env::temp_dir().join(format!("zeronote-bench-index-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    make_tree_fixture(&dir).map_err(|e| e.to_string())?;

    let rules = ignore::build(&dir, &IgnoreSettings::default());
    let db_path = dir.join("index.db");
    let db = schema::open(&db_path).map_err(|e| e.to_string())?;
    let max_size = crate::project::IndexSettings::default().max_file_size;

    let mut report = String::from("| Что | Файлов | Время |\n|---|---|---|\n");

    // Обход отдельно от записи: полезно видеть, что дороже — диск или база.
    let start = Instant::now();
    let files = jobs::collect_files(&dir, &rules, &|| false).ok_or("обход прерван")?;
    let walk_ms = start.elapsed().as_secs_f64() * 1000.0;
    report.push_str(&format!(
        "| Обход дерева | {} | {walk_ms:.0} мс |\n",
        files.len()
    ));

    let start = Instant::now();
    {
        let transaction = db.unchecked_transaction().map_err(|e| e.to_string())?;
        for path in &files {
            let _ = writer::index_file(&db, 1, path, max_size);
        }
        transaction.commit().map_err(|e| e.to_string())?;
    }
    let first_ms = start.elapsed().as_secs_f64() * 1000.0;
    report.push_str(&format!(
        "| Первая индексация | {} | {first_ms:.0} мс |\n",
        writer::count(&db, 1).unwrap_or(0)
    ));

    // Повторный проход — то же, что происходит при каждом запуске приложения
    // с уже готовым индексом.
    let start = Instant::now();
    for path in &files {
        let _ = writer::index_file(&db, 1, path, max_size);
    }
    let again_ms = start.elapsed().as_secs_f64() * 1000.0;
    report.push_str(&format!(
        "| Повторный проход | {} | {again_ms:.0} мс |\n",
        files.len()
    ));

    let start = Instant::now();
    let hits = query::search(&db, "заметка", None, 200).map_err(|e| e.to_string())?;
    let search_ms = start.elapsed().as_secs_f64() * 1000.0;
    report.push_str(&format!(
        "| Поиск по содержимому | {} найдено | {search_ms:.1} мс |\n",
        hits.len()
    ));

    let db_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
    report.push_str(&format!(
        "\nБаза индекса: {:.1} МиБ на {} файлов.\n\
         Повторный проход — это цена запуска с готовым индексом: он сверяет\n\
         время и размер и содержимое не перечитывает.\n",
        db_size as f64 / (1024.0 * 1024.0),
        TREE_FILES * 2
    ));

    drop(db);
    let _ = std::fs::remove_dir_all(&dir);
    Ok(report)
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
