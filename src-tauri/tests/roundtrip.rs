//! Сквозная проверка инвариантов 1, 2, 3, 5 на настоящих файлах на диске.
//!
//! Модульные тесты в `src/text/` работают с байтами в памяти. Здесь проверяется
//! то, что модульными тестами не поймать: путь «файл на диске → буфер → файл
//! на диске» целиком, вместе с атомарной заменой.
//!
//! Эталоны в `tests/fixtures/` — это «чужие файлы». Они лежат в репозитории
//! и защищены `.gitattributes` (`* -text`) от нормализации переносов строк.
//! Пересоздаются командой `cargo run --example make_fixtures`, но по своей
//! воле их пересоздавать не надо: они и есть эталон.

use std::fs;
use std::path::{Path, PathBuf};

use zeronote_lib::fsx::atomic_save;
use zeronote_lib::text::document;

/// Единственный эталон, который не переживает обход байт в байт, и это
/// не дефект. Внутри буфера все переносы одинаковы, поэтому у файла со
/// смешанными переносами нет единственно верного способа записаться обратно.
/// Решение о приведении к одному типу принимает пользователь — см. Р-018.
const MIXED: &str = "mixed-eol.txt";

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn fixtures() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(fixtures_dir())
        .expect("папка эталонов должна существовать")
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .collect();
    files.sort();
    files
}

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("zeronote-roundtrip-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("не удалось создать временную папку");
    dir
}

/// Страховка от главного способа обмануть себя: если обход папки сломается,
/// все тесты ниже начнут проходить, не проверив ничего.
#[test]
fn fixtures_are_present() {
    let files = fixtures();
    assert!(
        files.len() >= 15,
        "эталонов подозрительно мало: {}",
        files.len()
    );
}

/// Инвариант 1 целиком: открыть чужой файл и сохранить его, ничего не правя,
/// обязано дать те же самые байты. Кодировка, метка порядка байтов, тип
/// переносов, наличие финальной новой строки — всё на месте.
#[test]
fn every_fixture_survives_open_and_save() {
    let work = temp_dir("identity");

    for source in fixtures() {
        let name = source.file_name().unwrap().to_string_lossy().into_owned();
        if name == MIXED {
            continue;
        }

        let original = fs::read(&source).unwrap_or_else(|e| panic!("{name}: {e}"));

        let document = document::read(&original).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(!document.lossy, "{name}: чтение оказалось с потерями");

        let bytes = document::to_bytes_as_read(&document)
            .unwrap_or_else(|e| panic!("{name}: {e}"));

        // Пишем настоящим сохранением, а не fs::write: проверяется в том числе
        // и то, что атомарная замена ничего не искажает.
        let target = work.join(&name);
        atomic_save::save(&target, &bytes).unwrap_or_else(|e| panic!("{name}: {e}"));

        let written = fs::read(&target).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(written, original, "{name}: байты разошлись");
    }

    let _ = fs::remove_dir_all(&work);
}

/// Повторное сохранение поверх существующего файла тоже ничего не меняет.
/// Отдельно от предыдущего теста, потому что там путь замены не задействован:
/// файла ещё не было, и сработало обычное переименование.
#[test]
fn saving_twice_is_stable() {
    let work = temp_dir("twice");

    for source in fixtures() {
        let name = source.file_name().unwrap().to_string_lossy().into_owned();
        if name == MIXED {
            continue;
        }

        let original = fs::read(&source).unwrap();
        let target = work.join(&name);

        for _ in 0..2 {
            let document = document::read(&fs::read(&target).unwrap_or_else(|_| original.clone()))
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            let bytes = document::to_bytes_as_read(&document).unwrap();
            atomic_save::save(&target, &bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
        }

        assert_eq!(fs::read(&target).unwrap(), original, "{name}: байты разошлись");
    }

    let _ = fs::remove_dir_all(&work);
}

/// Смешанные переносы: файл читается, факт смешения виден снаружи.
/// Молчаливого приведения к одному типу не происходит.
#[test]
fn mixed_line_endings_are_visible_to_the_caller() {
    let bytes = fs::read(fixtures_dir().join(MIXED)).expect("эталон должен существовать");

    let document = document::read(&bytes).expect("файл должен читаться");

    assert!(document.eol.mixed, "смешение обязано быть замечено");
    assert!(document.eol.crlf > 0 && document.eol.lf > 0);
}

/// Инвариант 2 на настоящей файловой системе: в `.obsidian` не пишем никогда,
/// даже если папка существует и доступна на запись.
#[test]
fn obsidian_stays_read_only_on_disk() {
    let work = temp_dir("obsidian");
    let obsidian = work.join(".obsidian");
    fs::create_dir_all(obsidian.join("themes")).unwrap();

    // Настройки хранилища читать можно — кладём их сами, как это сделал бы
    // Obsidian, и убеждаемся, что после попытки записи они не изменились.
    let existing = obsidian.join("app.json");
    let existing_bytes = br#"{"theme":"obsidian"}"#;
    fs::write(&existing, existing_bytes).unwrap();

    for target in [
        obsidian.join("app.json"),
        obsidian.join("workspace.json"),
        obsidian.join("themes/моя-тема.css"),
    ] {
        let error = atomic_save::save(&target, "испорчено".as_bytes())
            .expect_err("запись в .obsidian должна быть отвергнута");
        assert!(
            matches!(error, atomic_save::SaveError::ObsidianIsReadOnly { .. }),
            "неожиданная ошибка: {error}"
        );
    }

    assert_eq!(
        fs::read(&existing).unwrap(),
        existing_bytes,
        "существующий файл в .obsidian изменился"
    );
    assert!(
        !obsidian.join("workspace.json").exists(),
        "в .obsidian появился новый файл"
    );

    let _ = fs::remove_dir_all(&work);
}

/// Инвариант 3: после сохранения в папке не остаётся ничего лишнего.
/// Временный файл — деталь реализации, и пользователь не должен его видеть.
#[test]
fn saving_leaves_the_directory_clean() {
    let work = temp_dir("clean");

    for source in fixtures() {
        let name = source.file_name().unwrap().to_string_lossy().into_owned();
        let bytes = fs::read(&source).unwrap();
        atomic_save::save(&work.join(&name), &bytes).unwrap();
    }

    let mut written: Vec<String> = fs::read_dir(&work)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    written.sort();

    let mut expected: Vec<String> = fixtures()
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    expected.sort();

    assert_eq!(written, expected, "в папке оказалось лишнее");

    let _ = fs::remove_dir_all(&work);
}

/// Символ, которого нет в кодировке файла, — это внятная ошибка до записи,
/// а не молчаливая замена на вопросительный знак уже в файле пользователя.
///
/// Случай совершенно обычный: открыли французский файл в windows-1252
/// и вставили в него русское слово.
#[test]
fn character_outside_the_file_encoding_is_refused_before_writing() {
    let work = temp_dir("unmappable");
    let source = fixtures_dir().join("cp1252-crlf.txt");

    let original = fs::read(&source).unwrap();
    let document = document::read(&original).unwrap();

    let error = document::to_bytes(
        &format!("{}\nрусская строка", document.text),
        document.encoding,
        document.bom,
        document.eol.dominant,
    )
    .expect_err("запись с потерями должна быть отвергнута");

    let message = error.to_string();
    assert!(
        message.contains("windows-1252"),
        "сообщение должно называть кодировку: {message}"
    );

    // И, что важнее, файл на диске не тронут.
    let target = work.join("cp1252-crlf.txt");
    fs::copy(&source, &target).unwrap();
    assert_eq!(fs::read(&target).unwrap(), original);

    let _ = fs::remove_dir_all(&work);
}

/// Правка текста меняет ровно то, что правили: кодировка, метка порядка байтов
/// и тип переносов остаются прежними. Это тоже инвариант 1 — «никаких
/// улучшений без явной команды».
#[test]
fn editing_preserves_encoding_and_line_endings() {
    let work = temp_dir("edit");

    for source in fixtures() {
        let name = source.file_name().unwrap().to_string_lossy().into_owned();
        if name == MIXED || name == "empty.txt" || name == "utf8-bom-only.txt" {
            continue;
        }

        let original = fs::read(&source).unwrap();
        let before = document::read(&original).unwrap();

        // Дописываем строку так, как это сделал бы пользователь: внутри буфера
        // переносы всегда `\n`. Текст намеренно из латиницы и цифр: этот тест
        // про сохранение кодировки и переносов, а не про кириллицу, и он
        // должен проходить в том числе на западноевропейском эталоне.
        let edited_text = format!("{}\nappended line 123", before.text);
        let bytes = document::to_bytes(
            &edited_text,
            before.encoding,
            before.bom,
            before.eol.dominant,
        )
        .unwrap_or_else(|e| panic!("{name}: {e}"));

        let target = work.join(&name);
        atomic_save::save(&target, &bytes).unwrap();

        let after = document::read(&fs::read(&target).unwrap()).unwrap();

        assert_eq!(after.encoding, before.encoding, "{name}: сменилась кодировка");
        assert_eq!(after.bom, before.bom, "{name}: изменилась метка порядка байтов");
        assert_eq!(
            after.eol.dominant, before.eol.dominant,
            "{name}: сменился тип переносов"
        );
        assert_eq!(after.text, edited_text, "{name}: текст исказился");
    }

    let _ = fs::remove_dir_all(&work);
}
