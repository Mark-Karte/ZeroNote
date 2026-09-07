//! Индекс на настоящем дереве файлов.
//!
//! Модульные тесты в `src/index/` проверяют запись и запрос по одному файлу.
//! Здесь — то, что модульными не поймать: что обход учитывает правила
//! игнорирования, что переиндексация не удваивает записи, и что отмена
//! действительно прерывает обход, а не доводит его до конца молча.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use rusqlite::Connection;
use zeronote_lib::index::{graph, jobs, query, schema, writer};
use zeronote_lib::project::{IgnoreSettings, ignore};

const MAX: u64 = 2 * 1024 * 1024;

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("zeronote-index-it-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("не удалось создать временную папку");
    dir
}

/// Проиндексировать корень целиком — то же, что делает фоновое задание,
/// но без потока и событий.
fn scan(db: &Connection, root: &Path, rules: &ignore::IgnoreRules) -> usize {
    let files = jobs::collect_files(root, rules, &|| false).expect("обход не отменяли");
    for path in &files {
        writer::index_file(db, 1, root, path, MAX).expect("индексация не должна падать");
    }
    files.len()
}

/// Правила игнорирования обязаны действовать и на индекс: файл, скрытый
/// в дереве, но найденный поиском, — это утечка, а не удобство.
#[test]
fn ignored_files_never_reach_the_index() {
    let dir = temp_dir("ignored");
    fs::create_dir_all(dir.join("node_modules/пакет")).unwrap();
    fs::create_dir_all(dir.join("заметки")).unwrap();

    fs::write(dir.join("заметки/нужная.md"), "уникальное слово мандарин").unwrap();
    fs::write(
        dir.join("node_modules/пакет/index.js"),
        "уникальное слово мандарин",
    )
    .unwrap();
    fs::write(dir.join(".gitignore"), "секрет.md\n").unwrap();
    fs::write(dir.join("секрет.md"), "уникальное слово мандарин").unwrap();

    let rules = ignore::build(&dir, &IgnoreSettings::default());
    let db = schema::open(&schema::index_path(&dir)).unwrap();
    scan(&db, &dir, &rules);

    let hits = query::search(&db, "мандарин", None, 20).unwrap();

    assert_eq!(hits.len(), 1, "нашлось лишнее: {hits:?}");
    assert!(hits[0].path.ends_with("нужная.md"));
    let _ = fs::remove_dir_all(&dir);
}

/// Повторный проход не должен ни удваивать записи, ни перечитывать файлы,
/// которые не менялись.
#[test]
fn second_pass_changes_nothing() {
    let dir = temp_dir("second");
    // База — в стороне от индексируемой папки, а не внутри неё. С задачи 82
    // в индекс попадает любой файл, включая двоичный, и собственная база
    // с её спутниками журнала оказалась бы в счёте: 23 файла вместо 20.
    // В приложении она и лежит в стороне — в папке данных (Р-058).
    let db_dir = temp_dir("second-db");
    for i in 0..20 {
        fs::write(dir.join(format!("файл-{i}.md")), format!("текст номер {i}")).unwrap();
    }

    let rules = ignore::build(&dir, &IgnoreSettings::default());
    let db = schema::open(&schema::index_path(&db_dir)).unwrap();
    scan(&db, &dir, &rules);
    let after_first = writer::count(&db, 1).unwrap();

    let files = jobs::collect_files(&dir, &rules, &|| false).unwrap();
    let mut unchanged = 0;
    for path in &files {
        if writer::index_file(&db, 1, &dir, path, MAX).unwrap() == writer::Indexed::Unchanged {
            unchanged += 1;
        }
    }

    assert_eq!(after_first, 20);
    assert_eq!(writer::count(&db, 1).unwrap(), 20, "записи удвоились");
    assert_eq!(unchanged, 20, "файлы перечитались без нужды");
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&db_dir);
}

/// Удалённый файл должен уйти из выдачи. Иначе поиск приводит к файлу,
/// которого нет, — и это выглядит как поломка, а не как устаревший индекс.
#[test]
fn deleted_file_leaves_the_index() {
    let dir = temp_dir("deleted");
    let path = dir.join("временная.md");
    fs::write(&path, "уникальное слово ананас").unwrap();

    let rules = ignore::build(&dir, &IgnoreSettings::default());
    let db = schema::open(&schema::index_path(&dir)).unwrap();
    scan(&db, &dir, &rules);
    assert_eq!(query::search(&db, "ананас", None, 20).unwrap().len(), 1);

    fs::remove_file(&path).unwrap();
    writer::forget_file(&db, &path).unwrap();

    assert!(query::search(&db, "ананас", None, 20).unwrap().is_empty());
    let _ = fs::remove_dir_all(&dir);
}

/// Задача 82 целиком, на настоящем дереве: картинку и PDF находит быстрое
/// открытие, но не поиск по содержимому.
///
/// Модульные тесты проверяют одну запись, а здесь важно, что до картинки
/// доходит сам обход и что правила игнорирования на неё действуют так же,
/// как на текст: файл, скрытый в дереве, но найденный палитрой, — та же
/// утечка, о которой написано в Р-056.
#[test]
fn images_and_pdfs_are_found_by_name_only() {
    let dir = temp_dir("media");
    let db_dir = temp_dir("media-db");
    fs::create_dir_all(dir.join("вложения")).unwrap();
    fs::write(dir.join("заметка.md"), "уникальное слово абрикос").unwrap();
    fs::write(
        dir.join("вложения/схема.png"),
        [0x89, b'P', b'N', b'G', 0x00, 0x1A, 0x0A],
    )
    .unwrap();
    fs::write(
        dir.join("вложения/устав.pdf"),
        [b'%', b'P', b'D', b'F', b'-', b'1', b'.', b'7', 0x00, 0x01],
    )
    .unwrap();
    fs::write(dir.join(".gitignore"), "скрытая.png
").unwrap();
    fs::write(dir.join("скрытая.png"), [0x89, b'P', b'N', b'G', 0x00]).unwrap();

    let rules = ignore::build(&dir, &IgnoreSettings::default());
    let db = schema::open(&schema::index_path(&db_dir)).unwrap();
    scan(&db, &dir, &rules);

    let files = writer::all_files(&db).unwrap();
    let names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();

    assert!(names.contains(&"схема.png"), "картинки нет в индексе: {names:?}");
    assert!(names.contains(&"устав.pdf"), "PDF нет в индексе: {names:?}");
    assert!(
        !names.contains(&"скрытая.png"),
        "правила игнорирования обязаны действовать и на картинки: {names:?}"
    );

    let image = files.iter().find(|f| f.name == "схема.png").unwrap();
    assert!(!image.has_text, "содержимого у картинки быть не должно");

    // Подсказка имён при `[[` берёт другой список — только с содержимым.
    // Иначе она предлагала бы ссылку, которая выйдет висячей: разрешение
    // ссылок на вложения — задача 83.
    let for_links = writer::text_files(&db).unwrap();
    let link_names: Vec<&str> = for_links.iter().map(|f| f.name.as_str()).collect();
    assert!(
        !link_names.contains(&"схема.png") && !link_names.contains(&"устав.pdf"),
        "подсказка имён не должна предлагать вложения: {link_names:?}"
    );
    assert!(link_names.contains(&"заметка.md"));

    // Быстрое открытие ищет по именам — картинка находится.
    let rows = files.iter().map(|f| {
        let inside = f.path[dir.to_string_lossy().len()..]
            .trim_start_matches(['\\', '/'])
            .to_owned();
        (f.root_id, f.path.clone(), f.name.clone(), inside)
    });
    let hits = zeronote_lib::index::names::best("схема", rows, 10);
    assert_eq!(hits.first().map(|h| h.name.as_str()), Some("схема.png"));

    // А содержимого у двоичных не появилось: в `content` ровно столько строк,
    // сколько текстовых файлов, — заметка и сам `.gitignore`.
    let with_text = files.iter().filter(|f| f.has_text).count();
    let stored: i64 = db
        .query_row("SELECT count(*) FROM content", [], |row| row.get(0))
        .unwrap();
    assert_eq!(with_text, 2, "содержимое читается только у текстовых");
    assert_eq!(stored as usize, with_text);
    assert_eq!(query::search(&db, "абрикос", None, 20).unwrap().len(), 1);

    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&db_dir);
}

/// Граница задач 82 и 83: картинка попала в индекс, но ссылка на неё
/// пока не наводится.
///
/// Задача 82 даёт индексу имена всех файлов, и разрешение ссылок стало бы
/// находить картинку само собой — молча, без правил на случай, когда рядом
/// лежат заметка и вложение с одним именем. Такие правила пишутся в задаче
/// 83; до тех пор ссылки ведут ровно туда же, куда вели.
#[test]
fn links_do_not_reach_images_yet() {
    let dir = temp_dir("link-image");
    let db_dir = temp_dir("link-image-db");
    let note = dir.join("заметка.md");
    fs::write(&note, "ссылка на [[схема]]").unwrap();
    fs::write(dir.join("схема.png"), [0x89, b'P', b'N', b'G', 0x00]).unwrap();
    fs::write(dir.join("схема.md"), "а это заметка про схему").unwrap();

    let rules = ignore::build(&dir, &IgnoreSettings::default());
    let db = schema::open(&schema::index_path(&db_dir)).unwrap();
    scan(&db, &dir, &rules);

    let note_path = note.to_string_lossy().into_owned();
    let resolved = graph::resolve(&db, "схема", &note_path, 1).unwrap();

    assert!(
        resolved.is_some_and(|found| found.path.ends_with("схема.md")),
        "ссылка обязана вести в заметку, а не во вложение"
    );

    // А на картинку, у которой нет заметки-тёзки, ссылка пока висячая.
    fs::write(dir.join("только-картинка.png"), [0x89, b'P', b'N', b'G', 0x00]).unwrap();
    scan(&db, &dir, &rules);
    assert!(
        graph::resolve(&db, "только-картинка", &note_path, 1)
            .unwrap()
            .is_none(),
        "разрешение ссылок на вложения — задача 83"
    );

    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&db_dir);
}

/// Отмена обязана прерывать обход, а не доводить его до конца молча.
/// Проверка, которая не может провалиться, выглядит как проходящая, поэтому
/// считаем, сколько папок успели прочитать до остановки.
#[test]
fn cancellation_stops_the_walk() {
    let dir = temp_dir("cancel");
    for folder in 0..50 {
        let nested = dir.join(format!("раздел-{folder:02}"));
        fs::create_dir_all(&nested).unwrap();
        for i in 0..10 {
            fs::write(nested.join(format!("файл-{i}.md")), "текст").unwrap();
        }
    }

    let rules = ignore::build(&dir, &IgnoreSettings::default());

    // Сначала убеждаемся, что без отмены обход находит всё.
    let all = jobs::collect_files(&dir, &rules, &|| false).unwrap();
    assert_eq!(all.len(), 500);

    // Теперь останавливаем после третьей проверки.
    let checks = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    let result = jobs::collect_files(&dir, &rules, &|| {
        if checks.fetch_add(1, Ordering::SeqCst) >= 3 {
            stop.store(true, Ordering::SeqCst);
        }
        stop.load(Ordering::SeqCst)
    });

    assert!(result.is_none(), "обход не прервался");
    assert!(
        checks.load(Ordering::SeqCst) < 51,
        "обход дошёл до конца вместо остановки: {} проверок",
        checks.load(Ordering::SeqCst)
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Поиск по всем корням сразу — то, ради чего база одна, а не по файлу
/// на корень (Р-059).
#[test]
fn search_spans_all_roots() {
    let first = temp_dir("root-a");
    let second = temp_dir("root-b");
    fs::write(first.join("а.md"), "общее слово абрикос").unwrap();
    fs::write(second.join("б.md"), "общее слово абрикос").unwrap();

    let db = schema::open(&schema::index_path(&first)).unwrap();
    let rules_a = ignore::build(&first, &IgnoreSettings::default());
    let rules_b = ignore::build(&second, &IgnoreSettings::default());

    for path in jobs::collect_files(&first, &rules_a, &|| false).unwrap() {
        writer::index_file(&db, 1, &first, &path, MAX).unwrap();
    }
    for path in jobs::collect_files(&second, &rules_b, &|| false).unwrap() {
        writer::index_file(&db, 2, &second, &path, MAX).unwrap();
    }

    assert_eq!(query::search(&db, "абрикос", None, 20).unwrap().len(), 2);
    assert_eq!(
        query::search(&db, "абрикос", Some(2), 20).unwrap().len(),
        1
    );

    let _ = fs::remove_dir_all(&first);
    let _ = fs::remove_dir_all(&second);
}
