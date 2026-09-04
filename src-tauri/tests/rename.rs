//! Переименование с обновлением ссылок на настоящем хранилище.
//!
//! Здесь проверяется то, ради чего задача 48 писалась: после переименования
//! ссылка ведёт в ту же заметку, что и до него. Модульные тесты в
//! `fsx/link_edit.rs` отвечают за подстановку в текст, здесь — за ответ
//! на вопрос «что именно подставлять», а он считается симуляцией (Р-137).

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use zeronote_lib::fsx::link_edit;
use zeronote_lib::index::{graph, jobs, rename, schema, writer};
use zeronote_lib::project::{IgnoreSettings, ignore};

const MAX: u64 = 2 * 1024 * 1024;

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("zeronote-rename-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("не удалось создать временную папку");
    dir
}

fn vault(dir: &Path, files: &[(&str, &str)]) -> Connection {
    for (rel, text) in files {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, text).unwrap();
    }

    let rules = ignore::build(dir, &IgnoreSettings::default());
    let db = schema::open(&schema::index_path(dir)).unwrap();

    for path in jobs::collect_files(dir, &rules, &|| false).unwrap() {
        if path.extension().and_then(|e| e.to_str()) == Some("db") {
            continue;
        }
        writer::index_file(&db, 1, dir, &path, MAX).unwrap();
    }
    db
}

/// Собрать план и сразу применить его — как это делает приложение.
fn rename_and_fix(
    db: &mut Connection,
    dir: &Path,
    from: &Path,
    to: &Path,
) -> rename::RenamePlan {
    let root = dir.display().to_string();
    let plan = rename::plan(
        db,
        1,
        &root,
        &from.display().to_string(),
        &to.display().to_string(),
    )
    .expect("план должен считаться");

    fs::rename(from, to).expect("переименование не удалось");

    for file in &plan.files {
        link_edit::apply(Path::new(&file.path), &file.edits).expect("правка не удалась");
    }

    plan
}

/// Переиндексировать корень с нуля: после переименования пути в базе старые.
fn reindex(dir: &Path) -> Connection {
    let db_path = schema::index_path(dir);
    let _ = fs::remove_file(&db_path);
    let rules = ignore::build(dir, &IgnoreSettings::default());
    let db = schema::open(&db_path).unwrap();
    for path in jobs::collect_files(dir, &rules, &|| false).unwrap() {
        if path.extension().and_then(|e| e.to_str()) == Some("db") {
            continue;
        }
        writer::index_file(&db, 1, dir, &path, MAX).unwrap();
    }
    db
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

/// Простейший случай, ради которого всё и делается.
#[test]
fn link_follows_the_renamed_note() {
    let dir = temp_dir("simple");
    let mut db = vault(
        &dir,
        &[
            ("Дневник.md", "Сегодня писал про [[Планы]].\n"),
            ("Планы.md", "# Планы\n"),
        ],
    );

    let plan = rename_and_fix(&mut db, &dir, &dir.join("Планы.md"), &dir.join("Задачи.md"));

    assert_eq!(plan.links, 1);
    assert_eq!(read(&dir.join("Дневник.md")), "Сегодня писал про [[Задачи]].\n");
    let _ = fs::remove_dir_all(&dir);
}

/// Раздел и подпись остаются на месте: правится только цель.
#[test]
fn heading_and_alias_survive() {
    let dir = temp_dir("alias");
    let mut db = vault(
        &dir,
        &[
            (
                "Дневник.md",
                "Смотри [[Планы#Квартал|наши планы]] и ![[Планы]].\n",
            ),
            ("Планы.md", "# Планы\n"),
        ],
    );

    rename_and_fix(&mut db, &dir, &dir.join("Планы.md"), &dir.join("Задачи.md"));

    assert_eq!(
        read(&dir.join("Дневник.md")),
        "Смотри [[Задачи#Квартал|наши планы]] и ![[Задачи]].\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Новое имя занято тёзкой — тогда в ссылку идёт путь, а не имя (Р-134).
///
/// Иначе ссылка молча уехала бы в другую заметку: коротким именем
/// разрешается ближайшая.
#[test]
fn taken_name_forces_the_path_form() {
    let dir = temp_dir("taken");
    let mut db = vault(
        &dir,
        &[
            ("Дневник.md", "Про [[работа/Планы]].\n"),
            ("работа/Планы.md", "# Рабочие\n"),
            ("Задачи.md", "# Уже существующие задачи\n"),
        ],
    );

    rename_and_fix(
        &mut db,
        &dir,
        &dir.join("работа").join("Планы.md"),
        &dir.join("работа").join("Задачи.md"),
    );

    assert_eq!(read(&dir.join("Дневник.md")), "Про [[работа/Задачи]].\n");

    // И проверка, ради которой тест написан: ссылка ведёт в переименованную
    // заметку, а не в ту, что оказалась с тем же именем.
    let after = reindex(&dir);
    let from = dir.join("Дневник.md").display().to_string();
    let resolved = graph::resolve(&after, "работа/Задачи", &from, 1).unwrap().unwrap();
    assert!(resolved.path.contains("работа"), "{}", resolved.path);
    let _ = fs::remove_dir_all(&dir);
}

/// Переименование папки: ссылка с путём через неё правится.
#[test]
fn folder_rename_fixes_path_links() {
    let dir = temp_dir("folder");
    let mut db = vault(
        &dir,
        &[
            ("Дневник.md", "Про [[работа/Планы]] и [[работа/Отчёт]].\n"),
            ("работа/Планы.md", "# Планы\n"),
            ("работа/Отчёт.md", "# Отчёт\n"),
        ],
    );

    let plan = rename_and_fix(&mut db, &dir, &dir.join("работа"), &dir.join("дела"));

    assert_eq!(plan.links, 2);
    assert_eq!(
        read(&dir.join("Дневник.md")),
        "Про [[дела/Планы]] и [[дела/Отчёт]].\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Самый неочевидный случай (Р-137): ссылку без пути переименование папки
/// уводит в другую заметку, хотя ни она, ни ссылка не менялись.
///
/// В хранилище два тёзки, и `[[Планы]]` из корня разрешается по близости,
/// а при равной — по более короткому пути. Переименование `аа` в `яяяяя`
/// меняет длину пути, победитель становится другим — и ссылку приходится
/// прижать путём, иначе она молча переедет.
#[test]
fn folder_rename_pins_a_link_that_would_drift() {
    let dir = temp_dir("drift");
    let mut db = vault(
        &dir,
        &[
            ("Дневник.md", "Про [[Планы]].\n"),
            ("аа/Планы.md", "# Ближе по длине пути\n"),
            ("ббб/Планы.md", "# Другой тёзка\n"),
        ],
    );

    let before = graph::resolve(&db, "Планы", &dir.join("Дневник.md").display().to_string(), 1)
        .unwrap()
        .unwrap();
    assert!(before.path.contains("аа"), "проверка построена не на том: {}", before.path);

    rename_and_fix(&mut db, &dir, &dir.join("аа"), &dir.join("яяяяя"));

    // Ссылка стала путём — иначе она вела бы теперь в «ббб».
    assert_eq!(read(&dir.join("Дневник.md")), "Про [[яяяяя/Планы]].\n");

    let after = reindex(&dir);
    let resolved = graph::resolve(
        &after,
        "яяяяя/Планы",
        &dir.join("Дневник.md").display().to_string(),
        1,
    )
    .unwrap()
    .unwrap();
    assert!(resolved.path.contains("яяяяя"), "{}", resolved.path);
    let _ = fs::remove_dir_all(&dir);
}

/// Ссылка, которая после переименования ведёт туда же, не трогается вовсе.
///
/// Это следствие симуляции, и оно важнее, чем кажется: правка чужого файла
/// без нужды — то самое «файл изменился сам».
#[test]
fn links_that_still_work_are_left_alone() {
    let dir = temp_dir("untouched");
    let mut db = vault(
        &dir,
        &[
            ("Дневник.md", "Про [[Планы]].\n"),
            ("работа/Планы.md", "# Планы\n"),
            ("работа/Отчёт.md", "# Отчёт\n"),
        ],
    );

    // Переименовываем папку. `[[Планы]]` тёзок не имеет, поэтому и после
    // переименования разрешится в ту же заметку.
    let plan = rename_and_fix(&mut db, &dir, &dir.join("работа"), &dir.join("дела"));

    assert_eq!(plan.links, 0, "{:?}", plan.files);
    assert_eq!(read(&dir.join("Дневник.md")), "Про [[Планы]].\n");
    let _ = fs::remove_dir_all(&dir);
}

/// Висячая ссылка остаётся висячей: чинить в ней нечего, и придумывать
/// ей цель — не наше дело.
#[test]
fn dangling_links_are_not_invented() {
    let dir = temp_dir("dangling");
    let mut db = vault(
        &dir,
        &[
            ("Дневник.md", "Про [[Планы]] и [[Ненаписанное]].\n"),
            ("Планы.md", "# Планы\n"),
        ],
    );

    let plan = rename_and_fix(&mut db, &dir, &dir.join("Планы.md"), &dir.join("Задачи.md"));

    assert_eq!(plan.links, 1);
    assert_eq!(
        read(&dir.join("Дневник.md")),
        "Про [[Задачи]] и [[Ненаписанное]].\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Инвариант 1 на настоящем файле: кроме цели ссылки не меняется ни байта.
///
/// Файл нарочно неудобный — метка порядка байтов, смешанные переносы строк
/// и текст вокруг ссылки. Обычное сохранение буфера свело бы переносы
/// к одному виду; здесь этого не должно случиться (Р-136).
#[test]
fn nothing_but_the_target_changes_in_bytes() {
    let dir = temp_dir("bytes");

    let mut original: Vec<u8> = vec![0xEF, 0xBB, 0xBF];
    original.extend_from_slice("# Дневник\r\n\r\nПро [[Планы]].\nХвост\r\n".as_bytes());
    fs::write(dir.join("Дневник.md"), &original).unwrap();
    fs::write(dir.join("Планы.md"), "# Планы\n").unwrap();

    // Файлы уже на диске — `vault` их только проиндексирует.
    let mut db = vault(&dir, &[]);

    rename_and_fix(&mut db, &dir, &dir.join("Планы.md"), &dir.join("Задачи.md"));

    let after = fs::read(dir.join("Дневник.md")).unwrap();
    let mut expected: Vec<u8> = vec![0xEF, 0xBB, 0xBF];
    expected.extend_from_slice("# Дневник\r\n\r\nПро [[Задачи]].\nХвост\r\n".as_bytes());

    assert_eq!(after, expected, "изменилось что-то кроме цели ссылки");
    let _ = fs::remove_dir_all(&dir);
}
