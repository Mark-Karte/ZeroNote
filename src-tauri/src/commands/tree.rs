//! Команды дерева файлов.
//!
//! Логики здесь нет: содержимое папки читает `tree/`, правила знает `model/root.rs`.

use std::path::PathBuf;

use crate::model::root::RootId;
use crate::state::AppState;
use crate::tree::{self, Entry};
use crate::l10n::tr_with;

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
        let roots = state.roots.lock().expect("root registry lock poisoned");
        let root = roots
            .get(root_id)
            .ok_or_else(|| tr_with("error.root.missing.id", &[("root_id", &root_id.to_string())]))?;
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
        return Err(tr_with("error.outside-root", &[("path", &dir.display().to_string())]));
    }

    tree::read_children(&dir, &rules).map_err(|e| e.to_string())
}
