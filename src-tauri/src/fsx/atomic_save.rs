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
    /// Замена оборвалась на полпути: прежнего файла на месте может уже
    /// не быть, а новое содержимое лежит во временном. Временный файл
    /// оставлен, и его имя названо — иначе данных не найти (задача 138).
    Stranded {
        path: PathBuf,
        temp: PathBuf,
        source: io::Error,
    },
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
            SaveError::Stranded { path, temp, source } => write!(
                f,
                "{}: {source}. Замена оборвалась на полпути — новое содержимое \
                 сохранено в {}",
                path.display(),
                temp.display()
            ),
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
///
/// **Имя на пути — не единственное имя папки** (задача 138, находки Я1
/// и Ф3 ревизии). Windows отбрасывает точки и пробелы на конце части пути,
/// так что `.obsidian.\x.md` пишется в `.obsidian`; туда же ведут короткое
/// имя 8.3 (`OBSIDI~1`) и связь — символьная ссылка или junction —
/// под любым именем. До задачи 138 сторож сравнивал имена буквально,
/// и Ctrl+щелчок по ссылке `[[.obsidian./plugins/x]]` в чужой заметке
/// создавал файл внутри `.obsidian`. Теперь имена сравниваются так, как
/// их читает Windows, а ближайшая существующая папка пути ещё
/// и разворачивается в настоящий путь.
pub fn is_inside_obsidian(path: &Path) -> bool {
    if names_obsidian(path) {
        return true;
    }
    path.ancestors()
        .find(|existing| !existing.as_os_str().is_empty() && existing.exists())
        .and_then(|existing| fs::canonicalize(existing).ok())
        .is_some_and(|real| names_obsidian(&real))
}

/// Есть ли среди частей пути `.obsidian` — с точками и пробелами на конце
/// или без: Windows их всё равно отбросит.
fn names_obsidian(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(name) => name.to_str().is_some_and(|name| {
            name.trim_end_matches(['.', ' '])
                .eq_ignore_ascii_case(OBSIDIAN_DIR)
        }),
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
        if strands_content(&source) {
            // Замена оборвалась на полпути (задача 138, находка Ф2): прежний
            // файл уже убран с места или переименован, и новое содержимое
            // есть только во временном. Удалить его, как любой мусор, —
            // значит не оставить файла вовсе: для пакетной правки чужого
            // файла копия была только в памяти. Поэтому — довести дело
            // переименованием; атрибуты при этом возьмутся от временного
            // (Р-006), но содержимое дороже. Не вышло — временный остаётся
            // и называется в ошибке.
            if move_into_place(&temp, target) {
                return Ok(());
            }
            return Err(SaveError::Stranded {
                path: target.to_path_buf(),
                temp,
                source,
            });
        }
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
/// Похоже ли имя на наш временный файл.
///
/// Нужно дереву файлов: временный файл живёт миллисекунды, но событие
/// о его появлении успевает дойти, и мигать им в списке незачем. Проверка
/// живёт здесь, рядом с тем, кто эти имена создаёт, — иначе два места
/// разъедутся при первой же правке формата имени.
pub fn is_temp_name(name: &str) -> bool {
    name.starts_with('.') && name.contains(".zeronote-") && name.ends_with(".tmp")
}

/// `ReplaceFileW` не смог поставить новый файл на место: `ERROR_UNABLE_TO_
/// MOVE_REPLACEMENT` (1176) — прежнего файла на месте больше нет,
/// `…_2` (1177) — прежний остался под другим именем. В обоих случаях новое
/// содержимое есть только во временном файле.
fn strands_content(error: &io::Error) -> bool {
    const UNABLE_TO_MOVE_REPLACEMENT: i32 = 1176;
    const UNABLE_TO_MOVE_REPLACEMENT_2: i32 = 1177;
    matches!(
        error.raw_os_error(),
        Some(UNABLE_TO_MOVE_REPLACEMENT | UNABLE_TO_MOVE_REPLACEMENT_2)
    )
}

/// Поставить временный файл на место цели обычным переименованием.
/// Несколько попыток с паузой: чаще всего замену срывает антивирус или
/// индексатор, придержавший файл на миг.
fn move_into_place(temp: &Path, target: &Path) -> bool {
    for pause_ms in [0u64, 50, 200] {
        std::thread::sleep(std::time::Duration::from_millis(pause_ms));
        if fs::rename(temp, target).is_ok() {
            return true;
        }
    }
    false
}

fn temp_path(target: &Path) -> PathBuf {
    // Начало имени, а не всё: имя длиной почти в предел части пути
    // (255 знаков) с приставкой и меткой вышло бы за него, и такой файл
    // нельзя было бы сохранить вовсе (задача 138, находка Ф7). Шестидесяти
    // знаков хватает узнать, чей это файл, если он останется после сбоя.
    let name: String = target
        .file_name()
        .map(|n| n.to_string_lossy().chars().take(60).collect())
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

    /// Путь в виде, который ждёт Windows: UTF-16 с нулём на конце —
    /// и с приставкой `\\?\`, снимающей предел в 260 знаков (задача 138,
    /// находка Ф7). Без неё файл по длинному пути открывался — std ставит
    /// приставку сама, — а сохранение отказывало: этот вызов идёт мимо std.
    /// С приставкой Windows путь не разбирает, поэтому сначала он приводится
    /// к полному виду (`absolute` — это `GetFullPathNameW`).
    fn wide(path: &Path) -> io::Result<Vec<u16>> {
        let full: Vec<u16> = std::path::absolute(path)?.as_os_str().encode_wide().collect();
        let starts = |prefix: &str| {
            let prefix: Vec<u16> = prefix.encode_utf16().collect();
            full.starts_with(&prefix)
        };

        let mut out: Vec<u16> = Vec::with_capacity(full.len() + 9);
        if starts("\\\\?\\") || starts("\\\\.\\") {
            // Уже без разбора — оставить как есть.
            out.extend(&full);
        } else if starts("\\\\") {
            // Сетевой путь `\\сервер\ресурс` пишется как `\\?\UNC\сервер\ресурс`.
            out.extend("\\\\?\\UNC\\".encode_utf16());
            out.extend(&full[2..]);
        } else {
            out.extend("\\\\?\\".encode_utf16());
            out.extend(&full);
        }
        out.push(0);
        Ok(out)
    }

    let target_wide = wide(target)?;
    let temp_wide = wide(temp)?;

    // Один из трёх unsafe в проекте: два других читают буфер обмена
    // (`clipboard.rs`, Р-109) и удаляют в корзину (`fsx/recycle.rs`, Р-110).
    // Обоснование — в DESIGN.md, решение Р-006.
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

    /// Опознаватель временных файлов обязан узнавать то, что создаёт
    /// `temp_path`, — и не принимать за временный чужой файл.
    #[test]
    fn temp_names_are_recognised() {
        let temp = temp_path(Path::new(r"C:\заметки\список дел.md"));
        let name = temp.file_name().unwrap().to_string_lossy();

        assert!(is_temp_name(&name), "не узнал собственное имя: {name}");
        assert!(!is_temp_name("список дел.md"));
        assert!(!is_temp_name(".gitignore"));
        assert!(!is_temp_name("сборка.tmp"));
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

    /// Точка и пробел на конце имени — та же `.obsidian` (задача 138,
    /// находки Я1 и Ф3 ревизии). Windows при разборе пути отбрасывает их
    /// у любой части пути, и запись по `.obsidian.\x.md` уходила
    /// в настоящую `.obsidian`: сторож сравнивал имя буквально.
    #[test]
    fn trailing_dot_and_space_still_mean_obsidian() {
        for path in [
            r"C:\хранилище\.obsidian.\x.md",
            r"C:\хранилище\.obsidian \x.md",
            r"C:\хранилище\.obsidian. .\plugins\x.md",
        ] {
            assert!(is_inside_obsidian(Path::new(path)), "пропущено: {path}");
        }
    }

    /// И на диске: запись по пути с точкой не доходит до `.obsidian`.
    #[test]
    fn trailing_dot_writes_nothing_into_obsidian() {
        let dir = temp_dir("obsidian-dot");
        let vault = dir.join(".obsidian");
        fs::create_dir_all(&vault).unwrap();

        let error = save(&dir.join(".obsidian.").join("x.md"), b"")
            .expect_err("запись должна быть отвергнута");

        assert!(matches!(error, SaveError::ObsidianIsReadOnly { .. }));
        assert_eq!(fs::read_dir(&vault).unwrap().count(), 0, "в .obsidian что-то появилось");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Связь (junction) на `.obsidian` под другим именем — тоже `.obsidian`.
    /// То же с коротким именем 8.3 (`OBSIDI~1`): обе видны только по
    /// развёрнутому пути, и сторож разворачивает ближайшую существующую
    /// папку. Junction создаётся без прав администратора; не создалась —
    /// проверять нечего, и тест об этом говорит.
    #[test]
    fn junction_into_obsidian_is_refused() {
        let dir = temp_dir("obsidian-junction");
        let vault = dir.join(".obsidian");
        fs::create_dir_all(&vault).unwrap();
        let link = dir.join("настройки");

        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&vault)
            .output()
            .is_ok_and(|out| out.status.success());
        if !made {
            eprintln!("junction не создалась — проверка пропущена");
            let _ = fs::remove_dir_all(&dir);
            return;
        }

        assert!(is_inside_obsidian(&link.join("x.md")));
        assert!(save(&link.join("x.md"), b"").is_err());
        assert_eq!(fs::read_dir(&vault).unwrap().count(), 0);

        // Связь убирается отдельно: `remove_dir_all` не ходит по ней.
        let _ = fs::remove_dir(&link);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Какой отказ `ReplaceFileW` оставляет содержимое только во временном
    /// файле (задача 138, находка Ф2). Сам отказ на живом диске не вызвать —
    /// его устраивает антивирус в нужную миллисекунду, — проверяется решение.
    #[test]
    fn only_half_done_replace_keeps_the_temporary_file() {
        let code = io::Error::from_raw_os_error;
        assert!(strands_content(&code(1176)));
        assert!(strands_content(&code(1177)));
        // 1175 — прежний файл не удалось убрать: оба на местах, временный — мусор.
        assert!(!strands_content(&code(1175)));
        assert!(!strands_content(&code(5)));
        assert!(!strands_content(&io::Error::other("не системная")));
    }

    /// Папка с полным путём длиннее MAX_PATH (260 знаков).
    ///
    /// Длина — в знаках UTF-16, как её считает Windows. Первая версия теста
    /// мерила байты `OsStr`, а кириллица в них по два байта: путь выходил
    /// короче предела, и тест проходил на неисправленном коде.
    fn deep_dir(dir: &Path) -> PathBuf {
        use std::os::windows::ffi::OsStrExt;
        let mut deep = dir.to_path_buf();
        while deep.as_os_str().encode_wide().count() < 280 {
            deep = deep.join("вложенная-папка-проекта");
        }
        fs::create_dir_all(&deep).unwrap();
        deep
    }

    /// Файл по длинному пути сохраняется, как и открывается (задача 138,
    /// находка Ф7). Чтение шло через std, которая сама ставит приставку
    /// `\\?\`, а `ReplaceFileW` получал путь без неё и отказывал: файл
    /// открывался, но не сохранялся.
    #[test]
    fn long_path_is_saved() {
        let dir = temp_dir("long-path");
        let target = deep_dir(&dir).join("заметка.md");
        fs::write(&target, "было").unwrap();

        save(&target, "стало".as_bytes()).expect("длинный путь обязан сохраняться");

        assert_eq!(fs::read_to_string(&target).unwrap(), "стало");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Файл с именем почти в 255 знаков: временное имя не должно выходить
    /// за предел одной части пути (задача 138, Ф7).
    #[test]
    fn long_file_name_is_saved() {
        let dir = temp_dir("long-name");
        let name = format!("{}.md", "ы".repeat(240));
        let target = dir.join(&name);
        fs::write(&target, "было").unwrap();

        save(&target, "стало".as_bytes()).expect("длинное имя обязано сохраняться");

        assert_eq!(fs::read_to_string(&target).unwrap(), "стало");
        let _ = fs::remove_dir_all(&dir);
    }
}
