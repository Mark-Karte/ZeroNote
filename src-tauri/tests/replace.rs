//! Замена по проекту на настоящих файлах (задача 88).
//!
//! Модульные тесты в `replace/matcher.rs` отвечают за смещения, здесь —
//! за то, ради чего задача писалась: приложение меняет файлы, которых человек
//! не открывал, и после этого они обязаны остаться теми же файлами. Проверка
//! идёт **по байтам**, а не по тексту: инвариант 1 — это про байты.
//!
//! Отмена проверяется тем же способом. Обещание «пять последних замен
//! отменяются» ничего не стоит, если после отмены файл отличается от
//! исходного хоть одним байтом.

use std::fs;
use std::path::{Path, PathBuf};

use zeronote_lib::fsx::text_edit;
use zeronote_lib::model::edit::{self, FileEdits};
use zeronote_lib::replace::{self, Candidate, Matcher, Options};

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("zeronote-replace-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("не удалось создать временную папку");
    dir
}

fn candidates(dir: &Path, names: &[&str]) -> Vec<Candidate> {
    names
        .iter()
        .map(|name| Candidate {
            root_id: 1,
            path: dir.join(name).to_string_lossy().into_owned(),
            inside: (*name).to_owned(),
        })
        .collect()
}

/// Применить план и вернуть правки для отмены — как это делает приложение.
fn apply(plan: &replace::ReplacePlan) -> Vec<FileEdits> {
    let mut undo = Vec::new();

    for file in &plan.files {
        text_edit::apply(Path::new(&file.path), &file.edits).expect("правка не прошла");
        undo.push(FileEdits {
            path: file.path.clone(),
            inside: file.inside.clone(),
            edits: edit::invert(&file.edits),
        });
    }

    undo
}

fn undo(files: &[FileEdits]) {
    for file in files {
        text_edit::apply(Path::new(&file.path), &file.edits).expect("отмена не прошла");
    }
}

fn plan(dir: &Path, names: &[&str], query: &str, replacement: &str) -> replace::ReplacePlan {
    let matcher = Matcher::build(query, Options::default()).expect("запрос не собрался");
    replace::scan(&candidates(dir, names), &matcher, replacement, &|| false)
}

/// План по регулярному выражению — тем же кодом, только искатель другой.
fn plan_by_expression(
    dir: &Path,
    names: &[&str],
    query: &str,
    replacement: &str,
) -> replace::ReplacePlan {
    let matcher = Matcher::build(
        query,
        Options {
            expression: true,
            ..Options::default()
        },
    )
    .expect("выражение не собралось");
    replace::scan(&candidates(dir, names), &matcher, replacement, &|| false)
}

/// Замена проходит по нескольким файлам, а отмена возвращает их байт в байт.
#[test]
fn replace_and_undo_restore_every_byte() {
    let dir = temp_dir("undo");
    let files = [
        // Переносы Windows, кириллица, без финальной новой строки.
        ("заметки/Планы.md", "# Планы\r\nсрок: план на неделю\r\nещё план"),
        // Переносы Unix и финальная новая строка на месте.
        ("код/main.rs", "// план\nfn main() {}\n"),
        ("прочее/чужое.md", "тут ничего похожего нет\n"),
    ];

    let mut before = Vec::new();
    for (rel, text) in files {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, text).unwrap();
        before.push((path, fs::read(dir.join(rel)).unwrap()));
    }

    let names: Vec<&str> = files.iter().map(|(rel, _)| *rel).collect();
    let plan = plan(&dir, &names, "план", "замысел");

    assert_eq!(plan.files.len(), 2, "третий файл трогать не за что");
    assert_eq!(plan.total, 4, "«Планы» — тоже совпадение, регистр не учитываем");

    let back = apply(&plan);

    let planned = fs::read_to_string(dir.join("заметки/Планы.md")).unwrap();
    assert_eq!(planned, "# замыселы\r\nсрок: замысел на неделю\r\nещё замысел");
    assert!(
        fs::read_to_string(dir.join("код/main.rs"))
            .unwrap()
            .starts_with("// замысел\n"),
        "правка не дошла до второго файла"
    );

    undo(&back);

    for (path, bytes) in before {
        assert_eq!(fs::read(&path).unwrap(), bytes, "файл {} не вернулся", path.display());
    }

    let _ = fs::remove_dir_all(&dir);
}

/// Кодировка и метка порядка байтов остаются прежними (инвариант 1).
///
/// Файл в Windows-1251 после замены обязан остаться в Windows-1251: чужой
/// файл не переезжает в UTF-8 оттого, что мы поправили в нём слово.
#[test]
fn encoding_and_bom_survive_the_replacement() {
    let dir = temp_dir("encoding");

    let cp1251 = zeronote_lib::text::encoding::encode(
        "план работы\r\n",
        zeronote_lib::text::encoding::Encoding::Windows1251,
    )
    .unwrap();
    fs::write(dir.join("однобайтовый.txt"), &cp1251).unwrap();

    let mut with_bom = vec![0xEF, 0xBB, 0xBF];
    with_bom.extend_from_slice("план работы\n".as_bytes());
    fs::write(dir.join("с меткой.md"), &with_bom).unwrap();

    let plan = plan(
        &dir,
        &["однобайтовый.txt", "с меткой.md"],
        "план",
        "замысел",
    );
    assert_eq!(plan.files.len(), 2);
    apply(&plan);

    let single = fs::read(dir.join("однобайтовый.txt")).unwrap();
    assert_eq!(
        single,
        zeronote_lib::text::encoding::encode(
            "замысел работы\r\n",
            zeronote_lib::text::encoding::Encoding::Windows1251,
        )
        .unwrap(),
        "кодировка файла изменилась"
    );

    let marked = fs::read(dir.join("с меткой.md")).unwrap();
    assert_eq!(&marked[..3], &[0xEF, 0xBB, 0xBF], "метка пропала");

    let _ = fs::remove_dir_all(&dir);
}

/// План устарел — файл не правится вовсе, ни в одном месте.
///
/// Между показом списка и согласием человека файл могли изменить в другой
/// программе. Испорченный чужой файл хуже незаменённого слова.
#[test]
fn stale_plan_touches_nothing() {
    let dir = temp_dir("stale");
    let path = dir.join("файл.md");
    fs::write(&path, "план и ещё план\n").unwrap();

    let plan = plan(&dir, &["файл.md"], "план", "замысел");
    assert_eq!(plan.total, 2);

    // Пока человек читал список, файл изменился.
    fs::write(&path, "совсем другое содержимое\n").unwrap();

    let result = text_edit::apply(&path, &plan.files[0].edits);

    assert!(result.is_err(), "правка по устаревшему плану прошла");
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "совсем другое содержимое\n",
        "файл всё-таки тронули"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// Отмена возвращает заменённое и не трогает то, что человек написал после.
///
/// Отмена хранит обратные правки, а не копию файла (`model::edit::invert`),
/// и вот ради чего: копия вернула бы файл целиком, стерев всё, что человек
/// успел в нём написать после замены. Обратная правка возвращает ровно свои
/// куски и сверяет их по байтам.
#[test]
fn undo_keeps_what_was_written_after() {
    let dir = temp_dir("after");
    let path = dir.join("файл.md");
    fs::write(&path, "план\n").unwrap();

    let plan = plan(&dir, &["файл.md"], "план", "замысел");
    let back = apply(&plan);

    fs::write(&path, "замысел\nдописано руками\n").unwrap();
    undo(&back);

    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "план\nдописано руками\n",
        "отмена должна вернуть заменённое и сохранить дописанное"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// А если заменённого на месте больше нет — файл не трогается вовсе.
#[test]
fn undo_refuses_when_the_replacement_is_gone() {
    let dir = temp_dir("gone");
    let path = dir.join("файл.md");
    fs::write(&path, "план\n").unwrap();

    let plan = plan(&dir, &["файл.md"], "план", "замысел");
    let back = apply(&plan);

    let rewritten = "совсем другое содержимое\n";
    fs::write(&path, rewritten).unwrap();

    let result = text_edit::apply(&path, &back[0].edits);

    assert!(result.is_err(), "отмена переписала чужой текст");
    assert_eq!(fs::read_to_string(&path).unwrap(), rewritten);

    let _ = fs::remove_dir_all(&dir);
}

/// Замена по выражению с подстановкой групп — и отмена возвращает всё назад.
///
/// Ради этого выражение в замене обычно и нужно: переставить куски местами.
/// Отмена здесь ничем не отличается от обычной: обратная правка не знает,
/// каким способом посчитали прямую.
#[test]
fn expression_replacement_and_undo() {
    let dir = temp_dir("expression");
    let path = dir.join("настройки.toml");
    let before = "ключ = значение\nдругой = ещё\n";
    fs::write(&path, before).unwrap();

    let plan = plan_by_expression(
        &dir,
        &["настройки.toml"],
        r"(\w+) = (\w+)",
        "$2 = $1",
    );
    assert_eq!(plan.total, 2);

    let back = apply(&plan);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "значение = ключ\nещё = другой\n"
    );

    undo(&back);
    assert_eq!(fs::read_to_string(&path).unwrap(), before);

    let _ = fs::remove_dir_all(&dir);
}

/// Замена на пустоту — это удаление найденного, и отмена его возвращает.
#[test]
fn empty_replacement_deletes_and_comes_back() {
    let dir = temp_dir("delete");
    let path = dir.join("файл.md");
    let before = "текст с пометкой TODO внутри\n";
    fs::write(&path, before).unwrap();

    let plan = plan(&dir, &["файл.md"], "TODO ", "");
    let back = apply(&plan);

    assert_eq!(fs::read_to_string(&path).unwrap(), "текст с пометкой внутри\n");

    undo(&back);
    assert_eq!(fs::read_to_string(&path).unwrap(), before);

    let _ = fs::remove_dir_all(&dir);
}
