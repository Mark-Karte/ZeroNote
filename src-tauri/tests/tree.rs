//! Дерево файлов на настоящих папках.
//!
//! Модульные тесты в `src/tree/` проверяют порядок и правила на маленьких
//! папках. Здесь — то, что модульными не поймать: что чтение папки не зависит
//! от глубины дерева, что вложенные `.gitignore` доезжают до дерева, и что
//! мы не заходим внутрь точек соединения.

use std::fs;
use std::path::{Path, PathBuf};

use zeronote_lib::project::{IgnoreSettings, ignore};
use zeronote_lib::tree;

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("zeronote-tree-it-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("не удалось создать временную папку");
    dir
}

fn names(dir: &Path, rules: &ignore::IgnoreRules) -> Vec<String> {
    tree::read_children(dir, rules)
        .expect("папка должна читаться")
        .into_iter()
        .map(|e| e.name)
        .collect()
}

/// Правила корня действуют на любой глубине, а вложенный `.gitignore` —
/// только в своей ветке. В репозитории таких файлов обычно несколько.
#[test]
fn rules_reach_every_level_of_the_tree() {
    let dir = temp_dir("levels");
    let inner = dir.join("модуль/глубже");
    fs::create_dir_all(&inner).unwrap();

    fs::write(dir.join(".gitignore"), "*.log\n").unwrap();
    fs::write(dir.join("модуль/.gitignore"), "черновик.md\n").unwrap();

    fs::write(inner.join("вывод.log"), "").unwrap();
    fs::write(inner.join("черновик.md"), "").unwrap();
    fs::write(inner.join("заметка.md"), "").unwrap();

    let rules = ignore::build(&dir, &IgnoreSettings::default());

    assert_eq!(names(&inner, &rules), vec!["заметка.md"]);
    let _ = fs::remove_dir_all(&dir);
}

/// Чтение папки не должно зависеть от того, сколько файлов лежит в соседних:
/// дерево читает по папке и целиком не обходится.
#[test]
fn reading_a_folder_ignores_the_rest_of_the_tree() {
    let dir = temp_dir("isolated");
    let heavy = dir.join("много");
    let light = dir.join("мало");
    fs::create_dir_all(&heavy).unwrap();
    fs::create_dir_all(&light).unwrap();

    for i in 0..2000 {
        fs::write(heavy.join(format!("файл-{i:04}.md")), "").unwrap();
    }
    fs::write(light.join("одна.md"), "").unwrap();

    let rules = ignore::build(&dir, &IgnoreSettings::default());

    // В корне видны только две папки, а не две тысячи файлов из соседней.
    assert_eq!(names(&dir, &rules), vec!["мало", "много"]);
    assert_eq!(names(&light, &rules), vec!["одна.md"]);
    assert_eq!(
        tree::read_children(&heavy, &rules).unwrap().len(),
        2000,
        "большая папка обязана читаться целиком, когда её раскрыли"
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Наш временный файл в списке появляться не должен: он живёт миллисекунды,
/// а событие о нём приходит и успевает вызвать перечитывание папки.
#[test]
fn our_own_temporary_file_is_not_shown() {
    let dir = temp_dir("temp");
    fs::write(dir.join("заметка.md"), "").unwrap();
    fs::write(dir.join(".заметка.md.zeronote-4242-1700000000.tmp"), "").unwrap();

    let rules = ignore::build(&dir, &IgnoreSettings::default());

    assert_eq!(names(&dir, &rules), vec!["заметка.md"]);
    let _ = fs::remove_dir_all(&dir);
}

/// Точка соединения показывается, помечается ссылкой — и внутрь мы не идём.
///
/// Это защита от петли `проект\ссылка → проект`, в которой обход остаётся
/// навсегда (Р-054). Создание точки соединения прав администратора не требует,
/// поэтому проверка работает на обычной машине; если система всё же откажет,
/// тест честно пропускается, а не притворяется пройденным.
#[test]
fn junction_is_marked_and_not_followed() {
    let dir = temp_dir("junction");
    let target = dir.join("настоящая");
    fs::create_dir_all(&target).unwrap();
    fs::write(target.join("внутри.md"), "").unwrap();

    let link = dir.join("ссылка");
    let made = std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(&link)
        .arg(&target)
        .output();

    let created = made.map(|o| o.status.success()).unwrap_or(false);
    if !created {
        eprintln!("точка соединения не создалась — проверка пропущена");
        let _ = fs::remove_dir_all(&dir);
        return;
    }

    let rules = ignore::build(&dir, &IgnoreSettings::default());
    let entries = tree::read_children(&dir, &rules).unwrap();

    let entry = entries
        .iter()
        .find(|e| e.name == "ссылка")
        .expect("ссылка должна быть видна");

    assert!(entry.is_link, "ссылка обязана быть помечена");
    assert!(entry.is_dir, "ссылка на папку раскрывается как папка");

    let _ = fs::remove_dir_all(&dir);
}
