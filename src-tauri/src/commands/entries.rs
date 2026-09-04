//! Команды дерева: создать, переименовать, удалить в корзину.
//!
//! Логики здесь нет — проверка имени в `fsx/entry_ops`, удаление
//! в `fsx/recycle`. Здесь только то, что нельзя проверить чистой функцией:
//! границы проекта, `.obsidian` и существование пути.
//!
//! Все четыре проверки идут до любой записи на диск. Порядок важен: сначала
//! отказать, потом трогать чужие файлы, а не наоборот.

use std::path::{Path, PathBuf};

use crate::fsx::{entry_ops, recycle};
use crate::state::AppState;

type Fallible<T> = Result<T, String>;

/// Путь внутри какого-нибудь открытого проекта — иначе отказ.
///
/// Не формальность: дерево показывает только содержимое корней, и путь вне
/// их — это либо ошибка в интерфейсе, либо чужая папка, о которой мы ничего
/// не знаем. Ни в том, ни в другом случае писать туда не следует.
fn inside_root(state: &AppState, path: &Path) -> Fallible<PathBuf> {
    let roots = state.roots.lock().expect("реестр корней повреждён");
    roots
        .for_path(path)
        .map(|root| root.path.clone())
        .ok_or_else(|| "путь не входит ни в одну открытую папку".to_owned())
}

/// Общие для всех трёх операций отказы.
fn guard(state: &AppState, path: &Path) -> Fallible<PathBuf> {
    let root = inside_root(state, path)?;

    // Инвариант 2: в `.obsidian` не пишется ничего и ни при каких условиях.
    if crate::fsx::atomic_save::is_inside_obsidian(path) {
        return Err("в .obsidian ничего не меняется (инвариант 2)".to_owned());
    }

    Ok(root)
}

/// Создать пустой файл или папку.
#[tauri::command]
pub fn create_entry(
    state: tauri::State<'_, AppState>,
    parent: String,
    name: String,
    folder: bool,
) -> Fallible<String> {
    let parent = PathBuf::from(parent);
    guard(&state, &parent)?;

    if !parent.is_dir() {
        return Err(format!("{} — не папка", parent.display()));
    }

    let path = entry_ops::child_path(&parent, &name).map_err(|e| e.to_string())?;
    // Проверяем и то, куда собрались писать: имя годное, но `.obsidian`
    // мог оказаться именно здесь.
    guard(&state, &path)?;

    if path.exists() {
        return Err(format!("«{}» здесь уже есть", path.display()));
    }

    if folder {
        std::fs::create_dir(&path).map_err(|e| format!("не удалось создать папку: {e}"))?;
    } else {
        // Через атомарную запись, как и всё остальное: файл создаётся пустым,
        // заполнять его за пользователя нечем.
        crate::fsx::atomic_save::save(&path, &[]).map_err(|e| e.to_string())?;
    }

    Ok(path.to_string_lossy().into_owned())
}

/// Переименовать файл или папку. Возвращает новый путь.
#[tauri::command]
pub fn rename_entry(
    state: tauri::State<'_, AppState>,
    path: String,
    name: String,
) -> Fallible<String> {
    let path = PathBuf::from(path);
    let root = guard(&state, &path)?;

    if !path.exists() {
        return Err("этого файла или папки уже нет на диске".to_owned());
    }
    // Корень проекта переименовывается в проводнике, а не здесь: за ним
    // тянется запись в сессии, наблюдатель и содержимое индекса.
    if path == root {
        return Err("это корневая папка проекта: уберите её из дерева или переименуйте в проводнике".to_owned());
    }

    let target = entry_ops::renamed_path(&path, &name).map_err(|e| e.to_string())?;
    guard(&state, &target)?;

    if target == path {
        return Ok(path.to_string_lossy().into_owned());
    }
    // Разный регистр того же имени — законное переименование на Windows,
    // и `exists` на нём говорит «занято». Отличаем по настоящему совпадению.
    if target.exists() && !same_name_other_case(&path, &target) {
        return Err(format!("«{}» здесь уже есть", target.display()));
    }

    std::fs::rename(&path, &target).map_err(|e| format!("не удалось переименовать: {e}"))?;

    Ok(target.to_string_lossy().into_owned())
}

/// Тот же файл, только записанный другим регистром.
fn same_name_other_case(from: &Path, to: &Path) -> bool {
    let (Some(a), Some(b)) = (from.file_name(), to.file_name()) else {
        return false;
    };
    from.parent() == to.parent()
        && a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// Удалить файл или папку в корзину (Р-110).
#[tauri::command]
pub fn delete_entry(state: tauri::State<'_, AppState>, path: String) -> Fallible<()> {
    let path = PathBuf::from(path);
    let root = guard(&state, &path)?;

    if path == root {
        return Err(
            "это корневая папка проекта: её убирают из дерева, а не удаляют".to_owned()
        );
    }

    recycle::to_recycle_bin(&path).map_err(|e| e.to_string())
}

/// Сообщить ядру, что открытый файл переехал.
///
/// Зовётся после переименования: путь в буфере иначе остался бы прежним,
/// и сохранение записало бы файл обратно под старым именем — то есть создало
/// бы копию, которую никто не просил.
#[tauri::command]
pub fn move_buffer(
    state: tauri::State<'_, AppState>,
    id: crate::model::buffer::BufferId,
    path: String,
) -> Vec<crate::model::buffer::Buffer> {
    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    buffers.move_to(id, PathBuf::from(path));
    buffers.list().to_vec()
}
