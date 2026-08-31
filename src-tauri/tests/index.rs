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
use zeronote_lib::index::{jobs, query, schema, writer};
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
    for i in 0..20 {
        fs::write(dir.join(format!("файл-{i}.md")), format!("текст номер {i}")).unwrap();
    }

    let rules = ignore::build(&dir, &IgnoreSettings::default());
    let db = schema::open(&schema::index_path(&dir)).unwrap();
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
