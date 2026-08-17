//! Команды дерева файлов.
//!
//! Логики здесь нет: содержимое папки читает `tree/`, правила знает `model/root.rs`.

use std::path::PathBuf;

use crate::model::root::RootId;
use crate::state::AppState;
use crate::tree::{self, Entry};

type Fallible<T> = Result<T, String>;

/// Прочитать содержимое одной папки корня.
///
/// `path` пустой — содержимое самого корня. Дерево целиком не обходится
/// никогда: читается ровно та папка, которую раскрыли.
#[tauri::command]
pub fn read_children(
    state: tauri::State<'_, AppState>,
    root_id: RootId,
    path: Option<String>,
) -> Fallible<Vec<Entry>> {
    // Под блокировкой — только взять путь и указатель на правила. Дальше
    // работа с диском, и держать на ней блокировку нельзя: медленный сетевой
    // диск заморозил бы все остальные команды.
    let (root_path, rules) = {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        let root = roots
            .get(root_id)
            .ok_or_else(|| format!("корень {root_id} не найден"))?;
        (root.path.clone(), root.rules.clone())
    };

    let dir = match path {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => root_path.clone(),
    };

    // Читать разрешено только внутри корня. Без этой проверки любой путь
    // с диска можно было бы перечислить через окно приложения — фронтенду
    // такого доверия не выдано.
    if !dir.starts_with(&root_path) {
        return Err(format!("{} вне корня", dir.display()));
    }

    tree::read_children(&dir, &rules).map_err(|e| e.to_string())
}
