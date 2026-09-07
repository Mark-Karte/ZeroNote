//! Команды раскладки окна — области редактора (Р-207).
//!
//! Логики здесь нет: дерево живёт в `model/layout.rs`, а команды только
//! берут блокировку, зовут одну операцию и отдают раскладку целиком.
//! Целиком, а не «что изменилось»: фронтенд заменяет свою копию ответом,
//! и расхождение между ним и ядром не накапливается.

use crate::model::buffer::BufferId;
use crate::model::layout::{Direction, Layout, NodeId};
use crate::state::AppState;

fn snapshot(state: &tauri::State<'_, AppState>) -> Layout {
    state
        .layout
        .lock()
        .expect("раскладка повреждена")
        .clone()
}

/// Раскладка как она есть.
#[tauri::command]
pub fn layout_state(state: tauri::State<'_, AppState>) -> Layout {
    snapshot(&state)
}

/// Фокус ушёл в область (Р-210).
#[tauri::command]
pub fn set_active_pane(state: tauri::State<'_, AppState>, pane: NodeId) -> Layout {
    let mut layout = state.layout.lock().expect("раскладка повреждена");
    layout.set_active_pane(pane);
    layout.clone()
}

/// Вкладку выбрали щелчком: она активна в своей области, область — в окне.
#[tauri::command]
pub fn set_active_tab(state: tauri::State<'_, AppState>, pane: NodeId, id: BufferId) -> Layout {
    let mut layout = state.layout.lock().expect("раскладка повреждена");
    layout.set_active_tab(pane, id);
    layout.clone()
}

/// Вкладку переставили внутри области.
#[tauri::command]
pub fn reorder_tab(
    state: tauri::State<'_, AppState>,
    pane: NodeId,
    id: BufferId,
    to: usize,
) -> Layout {
    let mut layout = state.layout.lock().expect("раскладка повреждена");
    layout.reorder(pane, id, to);
    layout.clone()
}

/// Убрать вкладку из одной области, оставив буфер жить в других (Р-209).
/// Из последней области вкладку так не убирают — это уже `close_buffer`.
#[tauri::command]
pub fn remove_tab(state: tauri::State<'_, AppState>, pane: NodeId, id: BufferId) -> Layout {
    let mut layout = state.layout.lock().expect("раскладка повреждена");
    if layout.panes_with(id).len() > 1 {
        layout.remove(pane, id);
    }
    layout.clone()
}

/// Разделить область. С буфером — новая область получает его вкладку
/// (зеркало, Р-209), без — остаётся пустой до первого открытия.
#[tauri::command]
pub fn split_pane(
    state: tauri::State<'_, AppState>,
    pane: NodeId,
    direction: Direction,
    id: Option<BufferId>,
) -> Layout {
    let mut layout = state.layout.lock().expect("раскладка повреждена");
    layout.split(pane, direction, id);
    layout.clone()
}

/// Закрыть область. Буферы, оставшиеся без области, закрывает фронтенд —
/// он же перед этим спрашивает про несохранённое.
#[tauri::command]
pub fn close_pane(state: tauri::State<'_, AppState>, pane: NodeId) -> Layout {
    let mut layout = state.layout.lock().expect("раскладка повреждена");
    layout.close_pane(pane);
    layout.clone()
}

/// Перенести вкладку между областями; внутри одной — переставить.
#[tauri::command]
pub fn move_tab(
    state: tauri::State<'_, AppState>,
    id: BufferId,
    from: NodeId,
    to: NodeId,
    at: Option<usize>,
) -> Layout {
    let mut layout = state.layout.lock().expect("раскладка повреждена");
    layout.move_tab(id, from, to, at);
    layout.clone()
}

/// Границу между областями подвинули.
#[tauri::command]
pub fn set_split_ratio(state: tauri::State<'_, AppState>, split: NodeId, ratio: f64) -> Layout {
    let mut layout = state.layout.lock().expect("раскладка повреждена");
    layout.set_ratio(split, ratio);
    layout.clone()
}
