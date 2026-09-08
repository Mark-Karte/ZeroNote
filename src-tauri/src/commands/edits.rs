//! Правка файлов пачкой: план замены, применение правок, отмена обхода.
//!
//! Логики здесь нет: поиск совпадений — `replace/`, запись — `fsx/text_edit`,
//! обратные правки — `model/edit`. Здесь только то, что нельзя проверить
//! чистой функцией: границы проектов, список файлов у индекса и работа
//! в фоне.
//!
//! Два потребителя, и это не совпадение: правки применяет и переименование
//! (задача 48), и замена по проекту (задача 88). Правка — это тройка «где,
//! что было, что станет», и её применение одинаково в обоих случаях;
//! разными были только способы её посчитать.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use crate::model::edit::{self, FileEdits};
use crate::replace::{self, Candidate, Options, ReplacePlan};
use crate::state::AppState;

use super::entries::guard;
use super::index::inside_root;

/// Что вышло из применения правок.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOutcome {
    /// Жалобы на файлы, которые не вышло поправить. Пишутся человеку как есть.
    pub problems: Vec<String>,
    /// Правки, возвращающие всё как было. Пустой список — менять нечего.
    pub undo: Vec<FileEdits>,
}

/// Что изменится в проекте, если заменить (задача 88).
///
/// Зовётся **до** записи и ничего не меняет: ответ показывается человеку,
/// и он вправе отказаться.
///
/// Просматриваются те файлы, содержимое которых прочитал индекс, — ровно те,
/// в которых ищет поиск по проекту. Правило одно на обе стороны: чего поиск
/// не находит, того замена не меняет. Файл больше `index.max_file_size`
/// в индексе есть, но без содержимого, и замена в него не заходит.
///
/// Работа идёт в отдельном потоке: обход тысяч файлов — это чтение диска,
/// и держать на нём поток команд значит подвесить окно (инвариант 6).
#[tauri::command]
pub async fn plan_replace(
    state: tauri::State<'_, AppState>,
    query: String,
    replacement: String,
    match_case: bool,
    whole_word: bool,
) -> Result<ReplacePlan, String> {
    if query.is_empty() {
        return Ok(ReplacePlan::default());
    }

    // Номер поколения, как у индексации: отмена не флаг, а увеличение
    // счётчика. Свой номер обход помнит и бросает работу, как только счётчик
    // ушёл вперёд, — новый запрос отменяет прежний сам, без отдельного вызова.
    let generation = state.replace_scan.clone();
    let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;

    let candidates = candidates(&state);
    let options = Options {
        match_case,
        whole_word,
    };

    let plan = tauri::async_runtime::spawn_blocking(move || {
        replace::scan(&candidates, &query, &replacement, options, &|| {
            generation.load(Ordering::SeqCst) != mine
        })
    })
    .await
    .map_err(|e| format!("обход файлов прервался: {e}"))?;

    Ok(plan)
}

/// Прервать идущий обход.
///
/// Отдельная команда, а не отмена запроса во фронтенде: обход уже идёт
/// в потоке, и выбросить его ответ мало — он всё равно дочитает все файлы
/// до конца.
#[tauri::command]
pub fn cancel_replace(state: tauri::State<'_, AppState>) {
    state.replace_scan.fetch_add(1, Ordering::SeqCst);
}

/// Файлы проекта, в которых имеет смысл искать.
///
/// Берутся у индекса вместе с путём внутри корня: этот путь показывается
/// человеку в списке, и считать его каждому потребителю заново незачем.
/// Файл, чей корень успели убрать, отсеивается — писать в него уже нельзя.
fn candidates(state: &AppState) -> Vec<Candidate> {
    let files = state.index.lock().expect("индекс повреждён").text_files();

    let roots: Vec<(u64, String)> = {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        roots
            .list()
            .iter()
            .map(|root| (root.id, root.path.display().to_string()))
            .collect()
    };

    files
        .into_iter()
        .filter_map(|file| {
            let (_, root_path) = roots.iter().find(|(id, _)| *id == file.root_id)?;
            let inside = inside_root(&file.path, root_path)?;
            Some(Candidate {
                root_id: file.root_id,
                path: file.path,
                inside,
            })
        })
        .collect()
}

/// Поправить файлы по плану. Возвращает жалобы и правки для отмены.
///
/// Файлы независимы, и это главное свойство: сорвавшийся файл пропускается
/// с объяснением, остальные правятся. Половина работы лучше, чем ничего, —
/// а вот половина файла хуже всего, поэтому внутри файла правка либо
/// применяется целиком, либо не применяется вовсе (`fsx::text_edit`).
///
/// Обратные правки возвращаются только для тех файлов, которые и правда
/// записались: отмена, обещающая вернуть то, чего не меняли, врёт.
#[tauri::command]
pub async fn apply_edits(
    state: tauri::State<'_, AppState>,
    files: Vec<FileEdits>,
) -> Result<ApplyOutcome, String> {
    let mut problems = Vec::new();
    let mut approved = Vec::new();

    // Проверки границ идут до всякой записи и по памяти — быстро, поэтому
    // здесь же, в потоке команды. План приходит снаружи, и доверять ему
    // на слово нельзя: свой проект, не `.obsidian`.
    for file in files {
        match guard(&state, Path::new(&file.path)) {
            Err(complaint) => problems.push(format!("{}: {complaint}", file.inside)),
            Ok(_) => approved.push(file),
        }
    }

    let written = tauri::async_runtime::spawn_blocking(move || write_all(approved))
        .await
        .map_err(|e| format!("запись прервалась: {e}"))?;

    problems.extend(written.problems);
    Ok(ApplyOutcome {
        problems,
        undo: written.undo,
    })
}

/// Записать всё, что разрешено, и собрать обратные правки.
fn write_all(files: Vec<FileEdits>) -> ApplyOutcome {
    let mut outcome = ApplyOutcome::default();

    for file in files {
        let path = PathBuf::from(&file.path);

        match crate::fsx::text_edit::apply(&path, &file.edits) {
            Err(error) => outcome.problems.push(format!("{}: {error}", file.inside)),
            Ok(()) => outcome.undo.push(FileEdits {
                path: file.path,
                inside: file.inside,
                edits: edit::invert(&file.edits),
            }),
        }
    }

    outcome
}
