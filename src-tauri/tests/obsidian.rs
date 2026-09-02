//! Переходник Obsidian на настоящих папках.
//!
//! Главное здесь — инвариант 2: `.obsidian` только читается. Модульными
//! тестами это не поймать, потому что нарушить его может только работа
//! с диском.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use zeronote_lib::model::root::Roots;
use zeronote_lib::project::{self, obsidian};

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("zeronote-obsidian-it-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("не удалось создать временную папку");
    dir
}

/// Правдоподобное хранилище: настройки, заметки, вложенная папка.
fn vault(tag: &str, app_json: &str) -> PathBuf {
    let dir = temp_dir(tag);
    let config = dir.join(obsidian::CONFIG_DIR);
    fs::create_dir_all(&config).unwrap();

    fs::write(config.join("app.json"), app_json).unwrap();
    fs::write(config.join("appearance.json"), "{}").unwrap();
    fs::write(config.join("core-plugins.json"), r#"{"graph": true}"#).unwrap();

    fs::create_dir_all(dir.join("Архив")).unwrap();
    fs::write(dir.join("Архив/Старое.md"), "# Старое\n").unwrap();
    fs::write(dir.join("Заметка.md"), "# Заметка\n").unwrap();
    dir
}

/// Слепок папки: путь → содержимое. Для сравнения «до и после».
fn snapshot(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut out = BTreeMap::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(snapshot(&path));
        } else if let Ok(bytes) = fs::read(&path) {
            out.insert(path, bytes);
        }
    }
    out
}

/// Инвариант 2: переходник читает `.obsidian` и не пишет в неё ничего.
///
/// Сравнивается вся папка настроек целиком, побайтно, — а не только наличие
/// файлов: правка чужого файла на месте так же недопустима, как новый файл.
#[test]
fn adapter_never_writes_into_obsidian() {
    let dir = vault(
        "readonly",
        r#"{"userIgnoreFilters": ["Архив", "/^черновик/"], "attachmentFolderPath": "Вложения"}"#,
    );
    let config = dir.join(obsidian::CONFIG_DIR);

    let before = snapshot(&config);

    let mut roots = Roots::new();
    let id = roots.add(dir.clone()).id;
    let import = obsidian::read_import(&dir);

    // И сам перенос: он создаёт файл проекта, но в чужую папку не лезет.
    let text = project::template_with_rules(&import.rules, ".obsidian/app.json");
    fs::write(project::project_path(&dir), text).unwrap();
    roots.get_mut(id).unwrap().reload();

    assert_eq!(
        snapshot(&config),
        before,
        "переходник изменил содержимое .obsidian"
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Перенесённые правила должны по-настоящему работать: файл проекта
/// прочитан, правила собраны, папка скрыта.
#[test]
fn imported_rules_actually_hide_files() {
    let dir = vault("works", r#"{"userIgnoreFilters": ["Архив"]}"#);

    let import = obsidian::read_import(&dir);
    let text = project::template_with_rules(&import.rules, ".obsidian/app.json");
    fs::write(project::project_path(&dir), text).unwrap();

    let mut roots = Roots::new();
    let root = roots.add(dir.clone());

    assert!(root.has_obsidian_config, "хранилище не опознано");
    assert!(root.has_project_file);
    assert!(
        root.problems.is_empty(),
        "созданный нами файл вызвал жалобы: {:?}",
        root.problems
    );
    assert!(
        root.rules.is_ignored(&dir.join("Архив"), true),
        "перенесённое правило не действует"
    );
    assert!(!root.rules.is_ignored(&dir.join("Заметка.md"), false));
    let _ = fs::remove_dir_all(&dir);
}

/// Хранилище с нетронутыми настройками опознаётся, но переносить нечего.
/// Это самый частый случай, и он не должен выглядеть как ошибка.
#[test]
fn untouched_vault_is_detected_with_nothing_to_import() {
    let dir = vault("untouched", "{}");

    let mut roots = Roots::new();
    let root = roots.add(dir.clone());
    let import = obsidian::read_import(&dir);

    assert!(root.has_obsidian_config);
    assert!(import.rules.is_empty());
    assert!(import.skipped.is_empty());
    let _ = fs::remove_dir_all(&dir);
}

/// Обычная папка с заметками — не хранилище, и предлагать перенос нечего.
#[test]
fn plain_folder_is_not_a_vault() {
    let dir = temp_dir("plain");
    fs::write(dir.join("Заметка.md"), "# Заметка\n").unwrap();

    let mut roots = Roots::new();

    assert!(!roots.add(dir.clone()).has_obsidian_config);
    let _ = fs::remove_dir_all(&dir);
}
