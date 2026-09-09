//! Команды сессии и черновиков — инвариант 4.
//!
//! Логики здесь нет: чтение и запись делает `session/`, файлы читает `fsx/`,
//! список буферов ведёт `model/`.

use crate::fsx::text_file;
use crate::model::buffer::{Buffer, BufferId, Buffers, TabKind};
use crate::model::layout::{self, Layout, PaneView};
use crate::model::root::{Root, Roots};
use crate::session::{self, BufferSnapshot, RootSnapshot, WorkspaceSnapshot};
use crate::state::AppState;

use super::files::BufferWithText;
use super::roots::RootView;

type Fallible<T> = Result<T, String>;

/// Состояние вида, которым владеет фронтенд: курсор и прокрутка.
/// Ядро их не знает и знать не может — они живут в CodeMirror.
// Без `Copy`: язык — строка, а строку нельзя скопировать побитово.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewState {
    pub id: BufferId,
    #[serde(default)]
    pub cursor: usize,
    #[serde(default)]
    pub scroll_top: f64,
    /// Выбранный вручную язык подсветки. Ядро его не толкует.
    #[serde(default)]
    pub language: Option<String>,
    /// Номера строк с закладками. Ядро в них тоже не вникает.
    #[serde(default)]
    pub bookmarks: Vec<u32>,
}

fn snapshot_of(buffer: &Buffer, view: Option<&ViewState>) -> BufferSnapshot {
    BufferSnapshot {
        id: buffer.id,
        kind: buffer.kind.to_snapshot(),
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
        //
        // Вид проверяется первым, и это не перестраховка: у вкладки параметров
        // пути тоже нет, и без проверки она попала бы в черновики как обычный
        // безымянный буфер — с пустым файлом на диске в придачу.
        has_draft: buffer.kind == TabKind::Text
            && !buffer.large
            && (buffer.modified || buffer.path.is_none()),
        cursor: view.map(|v| v.cursor).unwrap_or(0),
        scroll_top: view.map(|v| v.scroll_top).unwrap_or(0.0),
        language: view.and_then(|v| v.language.clone()),
        bookmarks: view.map(|v| v.bookmarks.clone()).unwrap_or_default(),
    }
}

/// Записать снимок сессии.
///
/// Активную вкладку и порядок вкладок фронтенд не присылает: ими владеет
/// раскладка в ядре (Р-207). От фронтенда едет только то, чего ядро знать
/// не может, — курсоры, прокрутка, язык, закладки и состояние панели.
#[tauri::command]
pub fn save_session(
    state: tauri::State<'_, AppState>,
    views: Vec<ViewState>,
    pane_views: Vec<PaneView>,
    sidebar: bool,
    sidebar_width: u32,
    sidebar_panel: String,
) -> Fallible<()> {
    // Корни берутся первыми и своей блокировкой: две блокировки, взятые
    // в разном порядке разными командами, — это взаимная блокировка, которая
    // проявится один раз в год и будет выглядеть как зависшее окно.
    let (roots, next_root_id) = {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        let list = roots
            .list()
            .iter()
            .map(|root| RootSnapshot {
                id: root.id,
                path: root.path.clone(),
            })
            .collect();
        (list, roots.next_id())
    };

    let snapshot = {
        // Порядок блокировок — буферы, потом раскладка (см. `AppState`).
        let buffers = state.buffers.lock().expect("реестр буферов повреждён");
        let layout = state.layout.lock().expect("раскладка повреждена");

        // Пока область одна, порядок вкладок пишется порядком списка,
        // а раскладка — нет: снимок остаётся читаемым для 0.10.0. С двумя
        // областями порядок задаёт дерево, и список идёт как есть.
        let single = layout.is_single();
        let order: Vec<BufferId> = if single {
            layout.active_pane().tabs.clone()
        } else {
            buffers.list().iter().map(|b| b.id).collect()
        };
        // Буфер, которого нет ни в одной области, — не ошибка раскладки,
        // а щель между двумя командами; в снимок он всё равно попадает.
        //
        // Отдельным вектором, а не цепочкой итераторов: цепочка держала бы
        // `order` заимствованным в замыкании и одновременно забирала бы его
        // по значению — компилятор такое не пропускает, и правильно.
        let stray: Vec<BufferId> = buffers
            .list()
            .iter()
            .map(|b| b.id)
            .filter(|id| !order.contains(id))
            .collect();
        let order: Vec<BufferId> = order.into_iter().chain(stray).collect();

        WorkspaceSnapshot {
            active: layout.active_tab(),
            next_id: buffers.next_id(),
            next_untitled: buffers.next_untitled(),
            next_root_id,
            sidebar,
            sidebar_width,
            sidebar_panel,
            // Курсоры по областям пишутся вместе с раскладкой и только
            // с ней: пока область одна, курсор у вкладки один и лежит там же,
            // где лежал всегда, — в снимке буфера (задача 84).
            layout: (!single).then(|| layout.to_snapshot(&pane_views)),
            roots,
            buffers: order
                .iter()
                .filter_map(|id| buffers.get(*id))
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
    /// Дерево областей с порядком вкладок и активной вкладкой (Р-207).
    pub layout: Layout,
    /// Курсоры вкладок по областям (задача 84).
    ///
    /// Отдельным списком, а не внутри `layout`: раскладка курсоров не хранит,
    /// они живут в представлениях, то есть во фронтенде. Ядро их только
    /// переносит между запусками.
    pub pane_views: Vec<PaneView>,
    pub roots: Vec<RootView>,
    pub sidebar: bool,
    pub sidebar_width: u32,
    pub sidebar_panel: String,
    /// О чём надо сказать пользователю: пропавшие файлы, нечитаемые черновики,
    /// недоступные папки.
    pub notices: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredBuffer {
    #[serde(flatten)]
    pub buffer: BufferWithText,
    pub cursor: usize,
    pub scroll_top: f64,
    pub language: Option<String>,
    pub bookmarks: Vec<u32>,
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
        // Первый запуск или испорченный снимок: вкладок нет, а дом для
        // заметок есть — он приходит из настройки и не зависит от сессии.
        let vault = super::roots::sync_vault(&state, &mut notices);
        return RestoredSession {
            buffers: Vec::new(),
            layout: Layout::default(),
            pane_views: Vec::new(),
            roots: vault.into_iter().collect(),
            sidebar: false,
            sidebar_width: 0,
            sidebar_panel: String::new(),
            notices,
        };
    };

    // Корни восстанавливаются до файлов: открываемый файл должен уже знать
    // свой проект, иначе подсказка по кодировке опоздает ровно на один запуск.
    let restored_roots: Vec<Root> = snapshot
        .roots
        .iter()
        .map(|item| Root::load(item.id, item.path.clone()))
        .collect();

    for root in &restored_roots {
        // Недоступную папку из списка не выбрасываем: это может быть
        // отключённый диск или сетевой ресурс (Р-052). Но и молчать о ней
        // нельзя — пустое дерево без объяснений выглядит как поломка.
        if !root.available {
            notices.push(format!("папка недоступна: {}", root.path.display()));
        }
        for problem in &root.problems {
            notices.push(problem.clone());
        }
    }

    {
        let mut watchers = state.watchers.lock().expect("наблюдатели повреждены");
        for root in &restored_roots {
            if root.available {
                watchers.watch(root.id, &root.path);
            }
        }
    }

    let available: Vec<_> = restored_roots
        .iter()
        .filter(|root| root.available)
        .map(|root| root.id)
        .collect();

    *state.roots.lock().expect("реестр корней повреждён") =
        Roots::restore(restored_roots, snapshot.next_root_id);

    // Папка заметок (задача 94) приходит из настройки, а не из сессии:
    // в снимке она лежит обычным корнем и потому сохраняет свой номер —
    // по номеру названы записи индекса, и корень, получающий новый номер
    // при каждом запуске, переиндексировался бы целиком каждый раз.
    super::roots::sync_vault(&state, &mut notices);

    let root_views: Vec<RootView> = {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        roots.list().iter().map(RootView::of).collect()
    };

    // Индексация восстановленных корней идёт в фоне и старт не задерживает:
    // цель по тёплому старту — 800 мс, а обход хранилища столько не стоит.
    // Полный проход дешёв, потому что сверяет время и размер и перечитывает
    // только изменившееся за время простоя.
    for id in available {
        super::index::schedule_scan(&state, id);
    }

    let mut buffers = Vec::new();
    let mut restored = Vec::new();

    for item in &snapshot.buffers {
        let Some(kind) = TabKind::parse(&item.kind) else {
            // Вкладка из более новой версии: показать её нечем. Пропускаем
            // одну, а не отвергаем снимок целиком, — иначе откат на прошлую
            // версию закрывал бы человеку все вкладки разом.
            notices.push(format!(
                "вкладка «{}» пропущена: неизвестный вид «{}»",
                item.title, item.kind
            ));
            continue;
        };

        // Вид решает, как вкладку поднимать. `match`, а не `if`: картинка
        // в задаче 70 обязана заставить вспомнить и про это место.
        match kind {
            // Вкладка, которая не текст, собирается из одного вида: ни файла
            // читать, ни черновика поднимать у неё нечего. Собирает её та же
            // функция, что и при создании нажатием, — иначе восстановленная
            // вкладка однажды отличилась бы от созданной.
            TabKind::Settings => {
                let buffer = Buffer::settings(item.id);
                restored.push(RestoredBuffer {
                    buffer: BufferWithText {
                        buffer: buffer.clone(),
                        text: String::new(),
                    },
                    cursor: 0,
                    scroll_top: 0.0,
                    language: None,
                    bookmarks: Vec::new(),
                });
                buffers.push(buffer);
                continue;
            }
            // У картинки и PDF файл есть, и состояние на диске берётся свежее:
            // за время простоя их могли подменить. Байты не читаются —
            // их возьмёт показ, когда вкладка окажется на экране.
            TabKind::Image | TabKind::Pdf => {
                let Some(path) = item.path.clone() else {
                    notices.push(format!("вкладка «{}» без файла пропущена", item.title));
                    continue;
                };

                match text_file::DiskState::of(&path) {
                    Ok(disk) => {
                        let buffer = Buffer::viewed(item.id, path, disk, kind);
                        restored.push(RestoredBuffer {
                            buffer: BufferWithText {
                                buffer: buffer.clone(),
                                text: String::new(),
                            },
                            cursor: 0,
                            scroll_top: 0.0,
                            language: None,
                            bookmarks: Vec::new(),
                        });
                        buffers.push(buffer);
                    }
                    Err(e) => {
                        notices.push(format!("не удалось открыть {}: {e}", path.display()));
                    }
                }
                continue;
            }
            TabKind::Text => {}
        }

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
            (None, Some(path)) => match text_file::open_with_hint(path, state.encoding_hint(path)) {
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
            language: item.language.clone(),
            bookmarks: item.bookmarks.clone(),
        });
        buffers.push(buffer);
    }

    let ids: Vec<BufferId> = buffers.iter().map(|b| b.id).collect();

    // Активной могла быть вкладка, которую не удалось восстановить.
    let active = snapshot.active.filter(|id| ids.contains(id));

    // Раскладка: из снимка, если он есть и цел, иначе одна область
    // со всеми вкладками в порядке списка — так читается и сессия 0.10.0,
    // и испорченное дерево. Потерять дерево — потеря формы окна;
    // отвергнуть сессию из-за дерева — потеря вкладок. Выбор очевиден.
    let layout = snapshot
        .layout
        .as_ref()
        .and_then(|item| Layout::from_snapshot(item, &ids))
        .unwrap_or_else(|| Layout::single(ids.clone(), active));

    *state.buffers.lock().expect("реестр буферов повреждён") =
        Buffers::restore(buffers, snapshot.next_id, snapshot.next_untitled);
    *state.layout.lock().expect("раскладка повреждена") = layout.clone();

    // Черновики без буфера мог оставить сбой между записью черновика
    // и записью снимка. Копить их незачем.
    session::prune_drafts(data, &ids);

    RestoredSession {
        buffers: restored,
        pane_views: snapshot
            .layout
            .as_ref()
            .map(layout::views_of_snapshot)
            .unwrap_or_default(),
        layout,
        roots: root_views,
        sidebar: snapshot.sidebar,
        sidebar_width: snapshot.sidebar_width,
        sidebar_panel: snapshot.sidebar_panel,
        notices,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// У вкладки, которая не текст, черновика нет.
    ///
    /// Проверка стоит того: пути у такой вкладки тоже нет, и по остальным
    /// признакам она неотличима от безымянного буфера — а тому черновик как
    /// раз нужен. Ошибка здесь означала бы файл в папке данных, который
    /// никто не читает и никто не удаляет.
    #[test]
    fn tab_that_is_not_text_gets_no_draft() {
        let snapshot = snapshot_of(&Buffer::settings(1), None);

        assert_eq!(snapshot.kind, "settings");
        assert!(!snapshot.has_draft);
    }

    /// А безымянный текстовый буфер черновик получает — иначе проверка выше
    /// проходила бы и на правиле, запрещающем черновики вообще.
    #[test]
    fn untitled_text_buffer_still_gets_a_draft() {
        let mut buffers = Buffers::new();
        let buffer = buffers.create_untitled(crate::text::eol::DEFAULT).clone();

        let snapshot = snapshot_of(&buffer, None);

        assert!(snapshot.kind.is_empty(), "вид текста в снимок не пишется");
        assert!(snapshot.has_draft);
    }
}

/// Текстовый буфер из снимка. Вкладки других видов сюда не доходят:
/// их поднимает `match` по виду выше.
fn buffer_from(item: &BufferSnapshot, from_draft: bool) -> Buffer {
    Buffer {
        id: item.id,
        kind: TabKind::Text,
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
