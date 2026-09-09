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
        Some("live") => Some("live".to_owned()),
        Some("media") => Some("media".to_owned()),
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
            let _ = writer::index_file(&db, 1, &dir, path, max_size);
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
        let _ = writer::index_file(&db, 1, &dir, path, max_size);
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

    // --- Этап 13: второй путь поиска и план замены ---
    //
    // Обход файлов с чтением — главная новая цена этапа, и мерить её надо
    // на том же наборе, что индексацию: тогда числа сравнимы между собой.
    // Индекс здесь отдаёт только список файлов; всё остальное — диск.
    //
    // **Мерить надо два случая, и первый прогон это показал.** Поиск
    // останавливается, набрав предел в двести файлов, — на стенде, где
    // слово есть в каждом файле, он прочитал 201 файл и отчитался
    // о трёх миллисекундах. Число верное и бесполезное: настоящая цена
    // обхода видна там, где не найдено ничего и остановиться негде.
    let candidates: Vec<crate::replace::Candidate> = writer::text_files(&db)
        .unwrap_or_default()
        .into_iter()
        .map(|file| crate::replace::Candidate {
            root_id: file.root_id,
            inside: file.name,
            path: file.path,
        })
        .collect();

    let never = || false;
    let options = crate::replace::Options::default();
    let expression = crate::replace::Options {
        expression: true,
        ..crate::replace::Options::default()
    };

    let common = crate::replace::Matcher::build("заметка", options).map_err(|e| e.to_string())?;
    let start = Instant::now();
    let found = crate::replace::find(&candidates, &common, 200, &never);
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    report.push_str(&format!(
        "| Поиск обходом, слово в каждом файле | {} до предела | {ms:.0} мс |\n",
        found.scanned
    ));

    let rare = crate::replace::Matcher::build("такогословатутнет", options)
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    let found = crate::replace::find(&candidates, &rare, 200, &never);
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    report.push_str(&format!(
        "| Поиск обходом, ничего не найдено | {} просмотрено | {ms:.0} мс |\n",
        found.scanned
    ));

    let rare_expression =
        crate::replace::Matcher::build(r"такогослова\w*тутнет", expression)
            .map_err(|e| e.to_string())?;
    let start = Instant::now();
    let found = crate::replace::find(&candidates, &rare_expression, 200, &never);
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    report.push_str(&format!(
        "| Поиск выражением, ничего не найдено | {} просмотрено | {ms:.0} мс |\n",
        found.scanned
    ));

    let start = Instant::now();
    let plan = crate::replace::scan(&candidates, &common, "запись", &never);
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    report.push_str(&format!(
        "| План замены по всем файлам | {} совпадений | {ms:.0} мс |\n",
        plan.total
    ));

    let db_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
    report.push_str(&format!(
        "\nБаза индекса: {:.1} МиБ на {} файлов.\n\
         Повторный проход — это цена запуска с готовым индексом: он сверяет\n\
         время и размер и содержимое не перечитывает.\n\
         Поиск обходом и план замены читают файлы целиком — это цена второго\n\
         пути (задачи 88 и 89), и сравнивать её надо не с поиском по индексу,\n\
         а с первой индексацией: работа та же.\n",
        db_size as f64 / (1024.0 * 1024.0),
        TREE_FILES * 2
    ));

    drop(db);
    let _ = std::fs::remove_dir_all(&dir);
    Ok(report)
}

// --- Инвариант 6: ввод не ждёт фоновую работу ---

/// Номер корня для стенда. Заведомо не совпадает с настоящими: те выдаются
/// подряд с единицы, а хранилищ у человека не тысячи.
const BENCH_ROOT_ID: crate::model::root::RootId = 900_001;

/// Собрать стенд и поставить его в очередь индексации по-настоящему.
///
/// Именно по-настоящему: тот же рабочий поток, та же база, та же очередь,
/// что у обычной работы. Отдельный «как бы фоновый» счёт мерил бы не то,
/// ради чего инвариант 6 писался.
#[tauri::command]
pub fn bench_start_index(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<String, String> {
    use crate::project::{IgnoreSettings, IndexSettings, ignore};

    if config().mode.is_none() {
        return Err("измерительный стенд не включён".to_owned());
    }

    let dir = std::env::temp_dir().join(format!("zeronote-bench-live-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    make_tree_fixture(&dir).map_err(|e| e.to_string())?;

    let rules = std::sync::Arc::new(ignore::build(&dir, &IgnoreSettings::default()));
    let max_size = IndexSettings::default().max_file_size;

    state.index.lock().expect("индекс повреждён").scan_root(
        BENCH_ROOT_ID,
        dir.clone(),
        rules,
        max_size,
    );

    Ok(dir.display().to_string())
}

/// Убрать за стендом: отменить индексацию, вычистить записи, удалить папку.
#[tauri::command]
pub fn bench_stop_index(
    state: tauri::State<'_, crate::state::AppState>,
    path: String,
) -> Result<(), String> {
    if config().mode.is_none() {
        return Err("измерительный стенд не включён".to_owned());
    }

    {
        let index = state.index.lock().expect("индекс повреждён");
        index.cancel();
        index.forget_root(BENCH_ROOT_ID);
    }

    let _ = std::fs::remove_dir_all(std::path::PathBuf::from(path));
    Ok(())
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


// --- Образцы для замера показа картинки и PDF (задача 74) ---

/// Образец: путь, вес и подпись для отчёта.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSample {
    pub kind: String,
    pub label: String,
    pub path: String,
    pub bytes: u64,
}

/// Приготовить файлы для замера показа.
///
/// **Картинка — BMP, и это не лень.** BMP пишется без сжатия, то есть без
/// zlib: сорок строк вместо упаковщика, который пришлось бы тащить
/// в приложение ради стенда. Движок окна разбирает его наравне с прочими,
/// значит замер честный — от чтения с диска до разобранной картинки.
///
/// **PDF заполняется байтами, и разбор pdf.js в замер не входит.** Осмысленное
/// число про разбор даёт только настоящий документ со шрифтами и векторами,
/// а настоящий документ невоспроизводим на чужой машине. Меряется то, что
/// написали мы: чтение и доставка байтов в окно.
#[tauri::command]
pub fn bench_make_media() -> Result<Vec<MediaSample>, String> {
    // Прошлые прогоны за собой убираем: образцы весят полсотни мегабайт,
    // и копить их в папке временных файлов незачем.
    if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with("zeronote-bench-media-") {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }

    let dir = std::env::temp_dir().join(format!("zeronote-bench-media-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut out = Vec::new();

    for mib in [1u32, 5, 15] {
        let path = dir.join(format!("образец-{mib}.bmp"));
        // Ширина втрое меньше высоты — чтобы картинка была не полосой,
        // а чем-то похожим на снимок экрана.
        let pixels = (mib as u64 * 1024 * 1024) / 3;
        let width = (pixels as f64 / 0.6).sqrt() as u32;
        let height = (pixels / u64::from(width.max(1))) as u32;

        let bytes = write_bmp(&path, width.max(1), height.max(1)).map_err(|e| e.to_string())?;
        out.push(MediaSample {
            kind: "image".to_owned(),
            label: format!("BMP {width}×{height}"),
            path: path.display().to_string(),
            bytes,
        });
    }

    for mib in [1u32, 8, 32] {
        let path = dir.join(format!("образец-{mib}.pdf"));
        let size = mib as usize * 1024 * 1024;
        // Не нули: сплошной ноль система и диск сжимают лучше, чем настоящий
        // файл, и замер вышел бы приятнее правды.
        let block: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        let mut bytes = Vec::with_capacity(size);
        while bytes.len() < size {
            bytes.extend_from_slice(&block);
        }
        bytes.truncate(size);

        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        out.push(MediaSample {
            kind: "pdf".to_owned(),
            label: format!("{mib} МиБ"),
            path: path.display().to_string(),
            bytes: bytes.len() as u64,
        });
    }

    Ok(out)
}

/// Записать несжатый BMP заданного размера. Возвращает вес файла.
fn write_bmp(path: &std::path::Path, width: u32, height: u32) -> std::io::Result<u64> {
    // Строка точек выравнивается на четыре байта — это часть формата.
    let stride = (width * 3).div_ceil(4) * 4;
    let pixels = stride as usize * height as usize;
    let size = 54 + pixels;

    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&54u32.to_le_bytes());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(height as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&24u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&(pixels as u32).to_le_bytes());
    out.extend_from_slice(&2835i32.to_le_bytes());
    out.extend_from_slice(&2835i32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());

    // Содержимое не однотонное: сплошной цвет и движок, и диск обработают
    // быстрее настоящего снимка экрана.
    for y in 0..height {
        for x in 0..width {
            out.push((x % 256) as u8);
            out.push((y % 256) as u8);
            out.push(((x + y) % 256) as u8);
        }
        for _ in (width * 3)..stride {
            out.push(0);
        }
    }

    std::fs::write(path, &out)?;
    Ok(out.len() as u64)
}

#[cfg(test)]
mod media_tests {
    use super::*;

    /// Заголовок BMP обязан быть правильным: иначе движок окна покажет
    /// не картинку, а пустое место, и замер будет мерить пустое место.
    #[test]
    fn bmp_header_is_valid() {
        let dir = std::env::temp_dir().join(format!("zeronote-bmp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("проба.bmp");

        let size = write_bmp(&path, 7, 5).unwrap();
        let bytes = std::fs::read(&path).unwrap();

        assert_eq!(&bytes[0..2], b"BM");
        assert_eq!(u32::from_le_bytes(bytes[2..6].try_into().unwrap()), size as u32);
        assert_eq!(u32::from_le_bytes(bytes[10..14].try_into().unwrap()), 54);
        assert_eq!(u16::from_le_bytes(bytes[28..30].try_into().unwrap()), 24);
        // Ширина 7 даёт 21 байт на строку, выравнивание — 24; пять строк.
        assert_eq!(bytes.len(), 54 + 24 * 5);

        let _ = std::fs::remove_dir_all(&dir);
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
