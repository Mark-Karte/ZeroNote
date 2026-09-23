//! Команды коллаутов (задача 103).
//!
//! Логики здесь нет: разбор — в `callouts/mod.rs`, правка — в
//! `callouts/edit.rs`, запись — атомарно, как любой файл (инвариант 3).

use crate::callouts::{self, Callout, edit};
use crate::fsx::atomic_save;
use crate::state::AppState;

/// Всё, что нужно окну параметров и превью.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalloutsState {
    pub callouts: Vec<Callout>,
    /// Что из файла не применилось.
    pub problems: Vec<String>,
    pub path: String,
    /// Файл не читается вовсе. Тогда список — образец, а править нельзя:
    /// запись в непонятный файл стёрла бы то, что человек не дописал.
    pub broken: Option<String>,
}

fn file(state: &AppState) -> std::path::PathBuf {
    state.data_dir.path.join("callouts.toml")
}

pub fn build(path: &std::path::Path) -> CalloutsState {
    let (callouts, problems, broken) = match callouts::load_full(path) {
        Ok(loaded) => (loaded.callouts, loaded.problems, None),
        Err(e) => {
            let fallback = callouts::parse(callouts::DEFAULT_TEMPLATE)
                .map(|loaded| loaded.callouts)
                .unwrap_or_default();
            (fallback, Vec::new(), Some(e.to_string()))
        }
    };
    CalloutsState {
        callouts,
        problems,
        path: path.display().to_string(),
        broken,
    }
}

#[tauri::command]
pub fn callouts_state(state: tauri::State<'_, AppState>) -> CalloutsState {
    build(&file(&state))
}

/// Текст файла для правки. Файла нет — правим образец, а не пустоту:
/// иначе первая же правка из окна оставила бы файл без пояснений.
fn source(path: &std::path::Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|_| callouts::DEFAULT_TEMPLATE.to_owned())
}

#[tauri::command]
pub fn save_callout(
    state: tauri::State<'_, AppState>,
    original: Option<String>,
    callout: Callout,
) -> Result<CalloutsState, String> {
    let path = file(&state);
    let updated = edit::upsert(&source(&path), original.as_deref(), &callout)?;
    atomic_save::save(&path, updated.as_bytes()).map_err(|e| e.to_string())?;
    Ok(build(&path))
}

#[tauri::command]
pub fn remove_callout(state: tauri::State<'_, AppState>, id: String) -> Result<CalloutsState, String> {
    let path = file(&state);
    let updated = edit::remove(&source(&path), &id)?;
    atomic_save::save(&path, updated.as_bytes()).map_err(|e| e.to_string())?;
    Ok(build(&path))
}
