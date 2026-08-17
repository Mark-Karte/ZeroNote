//! Корни и файл проекта на настоящих папках на диске.
//!
//! Главное здесь — проверка решения Р-049: открытие чужой папки не должно
//! оставлять в ней ни одного следа. Модульными тестами это не поймать,
//! потому что след оставляет как раз работа с диском.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use zeronote_lib::model::root::Roots;
use zeronote_lib::project;
use zeronote_lib::text::encoding::Encoding;

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("zeronote-roots-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("не удалось создать временную папку");
    dir
}

/// Всё, что лежит в папке, включая вложенное, — для сравнения «до и после».
fn contents(dir: &Path) -> BTreeSet<PathBuf> {
    let mut found = BTreeSet::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return found;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(contents(&path));
        }
        found.insert(path);
    }
    found
}

/// Инвариант 1 и решение Р-049: добавление папки корнем не пишет в неё ничего.
///
/// Пользователь мог открыть чужую папку просто посмотреть. Файл проекта,
/// созданный без спроса, — это правка чужого каталога, и попадёт он ровно
/// туда, откуда его труднее всего заметить: в чужой репозиторий.
#[test]
fn adding_a_root_writes_nothing_into_the_folder() {
    let dir = temp_dir("untouched");
    fs::write(dir.join("заметка.md"), "текст").unwrap();
    fs::create_dir_all(dir.join("вложенная")).unwrap();
    fs::write(dir.join("вложенная/ещё.md"), "текст").unwrap();

    let before = contents(&dir);

    let mut roots = Roots::new();
    let root = roots.add(dir.clone());
    assert!(root.available);
    assert!(!root.has_project_file);

    assert_eq!(
        contents(&dir),
        before,
        "открытие папки корнем изменило её содержимое"
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Файл проекта создаётся только явной командой — и тогда он настоящий:
/// разбирается и даёт умолчания.
#[test]
fn project_file_is_created_only_on_request() {
    let dir = temp_dir("create");
    let path = project::project_path(&dir);

    let mut roots = Roots::new();
    roots.add(dir.clone());
    assert!(!path.exists(), "корень не должен создавать файл проекта");

    // То же, что делает команда create_project_file.
    fs::write(&path, project::DEFAULT_TEMPLATE).unwrap();
    let root = roots.get_mut(1).unwrap();
    root.reload();

    assert!(root.has_project_file);
    assert!(root.problems.is_empty(), "{:?}", root.problems);
    let _ = fs::remove_dir_all(&dir);
}

/// Настройки проекта доезжают до правил игнорирования: это и есть смысл файла.
#[test]
fn project_file_drives_the_ignore_rules() {
    let dir = temp_dir("rules");
    fs::write(
        project::project_path(&dir),
        "schema = 1\n[ignore]\nrules = [\"черновики/\"]\n",
    )
    .unwrap();

    let mut roots = Roots::new();
    let root = roots.add(dir.clone());

    assert!(root.rules.is_ignored(&dir.join("черновики/старое.md"), false));
    assert!(!root.rules.is_ignored(&dir.join("заметка.md"), false));
    // Умолчания продолжают действовать рядом со своими правилами.
    assert!(root.rules.is_ignored(&dir.join("node_modules"), true));
    let _ = fs::remove_dir_all(&dir);
}

/// Кодировка по умолчанию из файла проекта достаётся файлу этого корня —
/// и не достаётся файлу вне корней.
#[test]
fn default_encoding_reaches_files_of_the_project() {
    let dir = temp_dir("encoding");
    fs::write(
        project::project_path(&dir),
        "schema = 1\n[editor]\ndefault_encoding = \"koi8-r\"\n",
    )
    .unwrap();

    let mut roots = Roots::new();
    roots.add(dir.clone());

    let owner = roots.for_path(&dir.join("заметка.md"));
    assert_eq!(
        owner.and_then(|r| r.project.editor.default_encoding),
        Some(Encoding::Koi8R)
    );

    assert!(
        roots.for_path(Path::new(r"D:\чужое\заметка.md")).is_none(),
        "файл вне корней подсказки получать не должен"
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Сломанный `zeronote.toml` не мешает открыть папку, но обязан быть назван.
#[test]
fn broken_project_file_does_not_block_the_root() {
    let dir = temp_dir("broken");
    fs::write(project::project_path(&dir), "schema = 1\n[ignore]\nuse_defalts = 1\n").unwrap();

    let mut roots = Roots::new();
    let root = roots.add(dir.clone());

    assert!(root.available, "папка обязана открыться");
    assert_eq!(root.problems.len(), 1, "{:?}", root.problems);
    assert!(
        root.problems[0].contains("use_defalts"),
        "ошибка должна называть ключ: {:?}",
        root.problems
    );
    let _ = fs::remove_dir_all(&dir);
}
