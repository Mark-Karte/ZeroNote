//! Атомарное сохранение файла (инвариант 3) и запрет записи в `.obsidian`
//! (инвариант 2).
//!
//! Порядок действий:
//!
//! 1. Записать во временный файл **в той же директории** — иначе замена
//!    перестанет быть атомарной, потому что перенос между томами это копия.
//! 2. Сбросить на диск (`sync_all`, то есть `FlushFileBuffers`). Без этого
//!    после внезапного отключения питания на месте файла может оказаться
//!    нулевой длины ничто: имя переименовалось, а содержимое не доехало.
//! 3. Заменить целевой файл через `ReplaceFileW`.
//!
//! Про третий шаг подробно, потому что это неочевидно и стоило отдельного
//! решения (Р-006). `std::fs::rename` на Windows вызывает `MoveFileExW`,
//! и целевой файл получает права и атрибуты **временного**: теряются
//! унаследованные записи списка доступа, альтернативные потоки данных, время
//! создания. Для редактора чужих файлов это недопустимо. `ReplaceFileW`
//! переносит содержимое, но сохраняет дескриптор безопасности, атрибуты
//! и время создания приёмника — то есть делает ровно то, что нужно.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

/// Имя папки, запись в которую запрещена инвариантом 2.
const OBSIDIAN_DIR: &str = ".obsidian";

#[derive(Debug)]
pub enum SaveError {
    /// Попытка записи внутрь `.obsidian`. Инвариант 2, обсуждению не подлежит.
    ObsidianIsReadOnly { path: PathBuf },
    /// У пути нет родительской директории — писать временный файл некуда.
    NoParentDirectory { path: PathBuf },
    Io { path: PathBuf, source: io::Error },
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SaveError::ObsidianIsReadOnly { path } => write!(
                f,
                "запись в .obsidian запрещена: {}",
                path.display()
            ),
            SaveError::NoParentDirectory { path } => {
                write!(f, "у пути нет родительской папки: {}", path.display())
            }
            SaveError::Io { path, source } => {
                write!(f, "{}: {source}", path.display())
            }
        }
    }
}

impl std::error::Error for SaveError {}

/// Лежит ли путь внутри папки `.obsidian`.
///
/// Проверяются все составляющие пути, а не только последняя: запрещено и
/// `.obsidian/app.json`, и `.obsidian/themes/что-то/theme.css`.
///
/// Сравнение без учёта регистра — файловая система Windows регистр не
/// различает, и `.OBSIDIAN` обошёл бы точную проверку.
pub fn is_inside_obsidian(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(name) => name
            .to_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(OBSIDIAN_DIR)),
        _ => false,
    })
}

/// Атомарно записать байты в файл.
///
/// Права и атрибуты существующего целевого файла сохраняются.
pub fn save(target: &Path, bytes: &[u8]) -> Result<(), SaveError> {
    if is_inside_obsidian(target) {
        return Err(SaveError::ObsidianIsReadOnly {
            path: target.to_path_buf(),
        });
    }

    let parent = target.parent().ok_or_else(|| SaveError::NoParentDirectory {
        path: target.to_path_buf(),
    })?;

    let temp = temp_path(target);

    write_and_flush(&temp, bytes).map_err(|source| SaveError::Io {
        path: temp.clone(),
        source,
    })?;

    let result = if target.exists() {
        replace_file(target, &temp)
    } else {
        // Заменять нечего — это новый файл. `ReplaceFileW` в таком случае
        // возвращает ошибку, поэтому здесь обычное переименование: терять
        // нечего, прав у несуществующего файла нет.
        fs::rename(&temp, target)
    };

    if let Err(source) = result {
        // Временный файл не должен оставаться мусором в папке пользователя.
        let _ = fs::remove_file(&temp);
        return Err(SaveError::Io {
            path: target.to_path_buf(),
            source,
        });
    }

    // Тишина: директорию на Windows отдельно синхронизировать не нужно,
    // замена имени через ReplaceFileW уже журналируется файловой системой.
    let _ = parent;
    Ok(())
}

/// Имя временного файла: рядом с целевым, с точкой в начале и меткой,
/// по которой видно, чей это файл, если он всё-таки останется после сбоя.
fn temp_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "файл".to_owned());

    // Идентификатор процесса и время делают имя уникальным: два окна
    // приложения, сохраняющие один файл, не должны наступить друг на друга.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let temp_name = format!(".{name}.zeronote-{}-{nanos}.tmp", std::process::id());

    match target.parent() {
        Some(parent) => parent.join(temp_name),
        None => PathBuf::from(temp_name),
    }
}

fn write_and_flush(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;

    let mut file = fs::File::create(path)?;
    file.write_all(bytes)?;
    // sync_all на Windows — это FlushFileBuffers. Именно он превращает
    // «данные где-то в кэше» в «данные на диске».
    file.sync_all()?;
    Ok(())
}

#[cfg(windows)]
fn replace_file(target: &Path, temp: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    /// Путь в виде, который ждёт Windows: UTF-16 с нулём на конце.
    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let target_wide = wide(target);
    let temp_wide = wide(temp);

    // Единственный unsafe в проекте. Обоснование — в DESIGN.md, решение Р-006.
    //
    // Что здесь может пойти не так и почему не идёт:
    //
    // * Оба указателя ведут на векторы, объявленные строкой выше. Они живы
    //   до конца этого блока — компилятор не имеет права освободить их
    //   раньше, потому что они используются здесь же.
    // * Обе строки заканчиваются нулём: об этом заботится `chain(Some(0))`.
    //   Функция читает до нуля, и без него ушла бы за границу вектора.
    // * Остальные три аргумента по контракту допускают null: это
    //   необязательный файл резервной копии и два зарезервированных
    //   параметра, которые обязаны быть нулевыми.
    // * Возвращаемое значение проверяется сразу: ноль означает неудачу,
    //   и подробность берётся из `io::Error::last_os_error()`, пока её
    //   не затёр следующий системный вызов.
    let ok = unsafe {
        windows_sys::Win32::Storage::FileSystem::ReplaceFileW(
            target_wide.as_ptr(),
            temp_wide.as_ptr(),
            std::ptr::null(),
            // Не считать ошибкой невозможность перенести часть второстепенных
            // сведений вроде списка управления доступом на уровне объекта.
            windows_sys::Win32::Storage::FileSystem::REPLACEFILE_IGNORE_MERGE_ERRORS,
            std::ptr::null(),
            std::ptr::null(),
        )
    };

    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// На прочих системах атомарности достаточно от обычного переименования.
/// Ветка существует только чтобы код собирался при проверках вне Windows;
/// поддержка других систем в область первого круга не входит.
#[cfg(not(windows))]
fn replace_file(target: &Path, temp: &Path) -> io::Result<()> {
    fs::rename(temp, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-save-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Запись в `.obsidian` запрещена на любой глубине и в любом регистре.
    /// Это инвариант 2, и он проверяется до всякой работы с диском.
    #[test]
    fn obsidian_is_refused_at_any_depth() {
        for path in [
            r"C:\хранилище\.obsidian\app.json",
            r"C:\хранилище\.obsidian\themes\моя\theme.css",
            r"C:\хранилище\.OBSIDIAN\app.json",
            r"C:\хранилище\.Obsidian\workspace.json",
        ] {
            assert!(
                is_inside_obsidian(Path::new(path)),
                "должно быть запрещено: {path}"
            );
        }
    }

    /// Похожие имена запрещать нельзя: это чужие обычные файлы.
    #[test]
    fn similar_names_are_allowed() {
        for path in [
            r"C:\хранилище\obsidian\заметка.md",
            r"C:\хранилище\.obsidian-backup\app.json",
            r"C:\хранилище\мой.obsidian.md",
        ] {
            assert!(
                !is_inside_obsidian(Path::new(path)),
                "не должно быть запрещено: {path}"
            );
        }
    }

    /// Попытка сохранения в `.obsidian` обязана провалиться, ничего не создав.
    #[test]
    fn saving_into_obsidian_writes_nothing() {
        let dir = temp_dir("obsidian");
        let vault = dir.join(".obsidian");
        fs::create_dir_all(&vault).unwrap();
        let target = vault.join("app.json");

        let error = save(&target, b"{}").expect_err("запись должна быть отвергнута");

        assert!(matches!(error, SaveError::ObsidianIsReadOnly { .. }));
        assert!(!target.exists(), "файл не должен был появиться");
        // И временного файла тоже не должно остаться.
        let leftovers: Vec<_> = fs::read_dir(&vault).unwrap().flatten().collect();
        assert!(leftovers.is_empty(), "в папке остался мусор");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_new_file() {
        let dir = temp_dir("new");
        let target = dir.join("новый.txt");

        save(&target, "содержимое".as_bytes()).unwrap();

        assert_eq!(fs::read(&target).unwrap(), "содержимое".as_bytes());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn overwrites_existing_file() {
        let dir = temp_dir("overwrite");
        let target = dir.join("файл.txt");
        fs::write(&target, "старое").unwrap();

        save(&target, "новое".as_bytes()).unwrap();

        assert_eq!(fs::read(&target).unwrap(), "новое".as_bytes());
        let _ = fs::remove_dir_all(&dir);
    }

    /// После сохранения в папке не должно остаться временных файлов.
    #[test]
    fn leaves_no_temporary_files() {
        let dir = temp_dir("clean");
        let target = dir.join("файл.txt");

        save(&target, b"1").unwrap();
        save(&target, b"2").unwrap();
        save(&target, b"3").unwrap();

        let names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();

        assert_eq!(names, vec!["файл.txt".to_owned()], "остался мусор: {names:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Временный файл создаётся рядом с целевым, а не во временной папке
    /// системы: иначе замена перестанет быть атомарной на другом томе.
    #[test]
    fn temporary_file_is_next_to_target() {
        let target = Path::new(r"D:\хранилище\заметки\файл.md");
        let temp = temp_path(target);

        assert_eq!(temp.parent(), target.parent());
        assert!(temp.file_name().unwrap().to_string_lossy().starts_with('.'));
    }

    /// Атрибуты целевого файла обязаны пережить сохранение — это то,
    /// ради чего взят ReplaceFileW вместо переименования.
    #[cfg(windows)]
    #[test]
    fn preserves_creation_time_of_target() {
        use std::os::windows::fs::MetadataExt;

        let dir = temp_dir("attrs");
        let target = dir.join("файл.txt");
        fs::write(&target, "старое").unwrap();

        let before = fs::metadata(&target).unwrap().creation_time();
        // Файловые системы Windows хранят время с грубым шагом; ждём,
        // чтобы разница между «то же самое» и «новое» была различима.
        std::thread::sleep(std::time::Duration::from_millis(50));

        save(&target, "новое".as_bytes()).unwrap();

        let after = fs::metadata(&target).unwrap().creation_time();
        assert_eq!(
            before, after,
            "время создания приёмника должно сохраняться"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Сохранение не должно портить содержимое: проверяем на байтах,
    /// а не на строке, чтобы поймать любую подмену.
    #[test]
    fn writes_bytes_verbatim() {
        let dir = temp_dir("verbatim");
        let target = dir.join("байты.bin");
        let payload: Vec<u8> = (0u8..=255).collect();

        save(&target, &payload).unwrap();

        assert_eq!(fs::read(&target).unwrap(), payload);
        let _ = fs::remove_dir_all(&dir);
    }
}
