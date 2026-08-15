//! Команды сессии и черновиков — инвариант 4.
//!
//! Логики здесь нет: чтение и запись делает `session/`, файлы читает `fsx/`,
//! список буферов ведёт `model/`.

use crate::fsx::text_file;
use crate::model::buffer::{Buffer, BufferId, Buffers};
use crate::session::{self, BufferSnapshot, WorkspaceSnapshot};
use crate::state::AppState;

use super::files::BufferWithText;

type Fallible<T> = Result<T, String>;

/// Состояние вида, которым владеет фронтенд: курсор и прокрутка.
/// Ядро их не знает и знать не может — они живут в CodeMirror.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewState {
    pub id: BufferId,
    #[serde(default)]
    pub cursor: usize,
    #[serde(default)]
    pub scroll_top: f64,
}

fn snapshot_of(buffer: &Buffer, view: Option<&ViewState>) -> BufferSnapshot {
    BufferSnapshot {
        id: buffer.id,
        path: buffer.path.clone(),
        title: buffer.title.clone(),
        encoding: buffer.encoding,
        bom: buffer.bom,
        eol: buffer.eol,
        eol_mixed: buffer.eol_mixed,
        modified: buffer.modified,
        large: buffer.large,
        lossy: buffer.lossy,
        encoding_confident: buffer.encoding_confident,
        disk_modified_ms: buffer.disk.and_then(|d| d.modified_ms),
        disk_size: buffer.disk.map(|d| d.size),
        // Черновик нужен всем, у кого содержимое отличается от диска, и всем,
        // у кого диска нет вовсе. Большие файлы только для чтения — им нет.
        has_draft: !buffer.large && (buffer.modified || buffer.path.is_none()),
        cursor: view.map(|v| v.cursor).unwrap_or(0),
        scroll_top: view.map(|v| v.scroll_top).unwrap_or(0.0),
    }
}

/// Записать снимок сессии.
#[tauri::command]
pub fn save_session(
    state: tauri::State<'_, AppState>,
    views: Vec<ViewState>,
    active: Option<BufferId>,
) -> Fallible<()> {
    let snapshot = {
        let buffers = state.buffers.lock().expect("реестр буферов повреждён");

        WorkspaceSnapshot {
            active,
            next_id: buffers.next_id(),
            next_untitled: buffers.next_untitled(),
            buffers: buffers
                .list()
                .iter()
                .map(|buffer| {
                    let view = views.iter().find(|v| v.id == buffer.id);
                    snapshot_of(buffer, view)
                })
                .collect(),
        }
    };

    session::write_session(&state.data_dir.path, &snapshot)
}

/// Один черновик: номер буфера и его текущее содержимое.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftEntry {
    pub id: BufferId,
    pub text: String,
}

/// Сбросить черновики на диск.
///
/// Зовётся с задержкой около двух секунд после последнего изменения, и только
/// для буферов, содержимое которых с прошлого сброса менялось.
#[tauri::command]
pub fn flush_drafts(state: tauri::State<'_, AppState>, entries: Vec<DraftEntry>) -> Fallible<()> {
    for entry in &entries {
        session::write_draft(&state.data_dir.path, entry.id, &entry.text)?;
    }
    Ok(())
}

/// Убрать черновик: буфер сохранён на диск или закрыт.
#[tauri::command]
pub fn drop_draft(state: tauri::State<'_, AppState>, id: BufferId) {
    session::drop_draft(&state.data_dir.path, id);
}

/// Что удалось восстановить.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredSession {
    pub buffers: Vec<RestoredBuffer>,
    pub active: Option<BufferId>,
    /// О чём надо сказать пользователю: пропавшие файлы, нечитаемые черновики.
    pub notices: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredBuffer {
    #[serde(flatten)]
    pub buffer: BufferWithText,
    pub cursor: usize,
    pub scroll_top: f64,
}

/// Восстановить сессию при запуске.
///
/// Ни одна беда здесь не должна мешать приложению открыться: пропал файл —
/// говорим об этом и продолжаем, испорчен снимок — начинаем с чистого листа.
/// Пустой редактор лучше, чем не запустившийся.
#[tauri::command]
pub fn restore_session(state: tauri::State<'_, AppState>) -> RestoredSession {
    let data = &state.data_dir.path;
    let mut notices = Vec::new();

    let Some(snapshot) = session::read_session(data) else {
        return RestoredSession {
            buffers: Vec::new(),
            active: None,
            notices,
        };
    };

    let mut buffers = Vec::new();
    let mut restored = Vec::new();

    for item in &snapshot.buffers {
        // Черновик главнее файла: в нём то, чего на диске ещё нет.
        let draft = if item.has_draft {
            session::read_draft(data, item.id)
        } else {
            None
        };

        let (text, buffer) = match (draft, &item.path) {
            // Есть черновик — берём его, каким бы ни было состояние файла.
            (Some(text), _) => (text, buffer_from(item, true)),

            // Черновика нет, но есть файл — читаем с диска.
            (None, Some(path)) => match text_file::open(path) {
                Ok(opened) => {
                    let mut buffer = buffer_from(item, false);
                    // Сведения о файле берём свежие: за время простоя он мог
                    // измениться, и держаться за старые незачем.
                    buffer.encoding = opened.document.encoding;
                    buffer.bom = opened.document.bom;
                    buffer.eol = opened.document.eol.dominant;
                    buffer.eol_mixed = opened.document.eol.mixed;
                    buffer.lossy = opened.document.lossy;
                    buffer.encoding_confident = opened.document.encoding_confident;
                    buffer.read_only = opened.read_only || opened.large;
                    buffer.large = opened.large;
                    buffer.disk = Some(opened.disk);
                    (opened.document.text, buffer)
                }
                Err(e) => {
                    // Файл исчез или стал недоступен. Несохранённого в нём не
                    // было, поэтому вкладку просто не открываем — но молчать
                    // об этом нельзя.
                    notices.push(format!("не удалось открыть {}: {e}", path.display()));
                    continue;
                }
            },

            // Ни черновика, ни файла — пустой безымянный буфер.
            (None, None) => (String::new(), buffer_from(item, false)),
        };

        restored.push(RestoredBuffer {
            buffer: BufferWithText {
                buffer: buffer.clone(),
                text,
            },
            cursor: item.cursor,
            scroll_top: item.scroll_top,
        });
        buffers.push(buffer);
    }

    let ids: Vec<BufferId> = buffers.iter().map(|b| b.id).collect();

    // Активной могла быть вкладка, которую не удалось восстановить.
    let active = snapshot.active.filter(|id| ids.contains(id));

    *state.buffers.lock().expect("реестр буферов повреждён") =
        Buffers::restore(buffers, snapshot.next_id, snapshot.next_untitled);

    // Черновики без буфера мог оставить сбой между записью черновика
    // и записью снимка. Копить их незачем.
    session::prune_drafts(data, &ids);

    RestoredSession {
        buffers: restored,
        active,
        notices,
    }
}

fn buffer_from(item: &BufferSnapshot, from_draft: bool) -> Buffer {
    Buffer {
        id: item.id,
        path: item.path.clone(),
        title: item.title.clone(),
        encoding: item.encoding,
        bom: item.bom,
        eol: item.eol,
        eol_mixed: item.eol_mixed,
        // Восстановленный из черновика буфер изменён по определению: его
        // содержимое не совпадает с тем, что лежит на диске.
        modified: from_draft && (item.modified || item.path.is_none()),
        read_only: item.large,
        large: item.large,
        lossy: item.lossy,
        encoding_confident: item.encoding_confident,
        disk: item.disk(),
    }
}
