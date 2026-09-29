//! Команды работы с файлами и буферами.
//!
//! Логики здесь нет: чтение и запись делают `fsx/`, разбор — `text/`,
//! список буферов ведёт `model/`. Этот слой только переводит между ними
//! и фронтендом.

use std::path::{Path, PathBuf};

use crate::fsx::text_file;
use crate::model::buffer::{Buffer, BufferId, TabKind};
use crate::model::layout::Layout;
use crate::session;
use crate::state::AppState;
use crate::text::encoding::Encoding;
use crate::text::eol::{self, Eol};
use crate::text::{document, encoding as enc};

/// Буфер вместе с содержимым. Отдаётся при открытии и при повторном
/// прочтении; в остальное время текстом владеет фронтенд (решение Р-002).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BufferWithText {
    #[serde(flatten)]
    pub buffer: Buffer,
    pub text: String,
}

/// Ответ на открытие файла.
///
/// `reused` — файл уже был открыт текстом: ядро только показало вкладку,
/// диска не читало, и `text` пуст (задача 135). Текстом открытого буфера
/// владеет фронтенд, и в нём могут быть несохранённые правки. До задачи 135
/// повторное открытие перечитывало файл и снимало признак изменения —
/// правки пропадали без вопроса.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    #[serde(flatten)]
    pub content: BufferWithText,
    pub reused: bool,
}

/// Ошибка, пригодная к показу пользователю.
///
/// Команды Tauri возвращают `Result<_, String>`: всё, что дойдёт до
/// интерфейса, — это текст сообщения. Поэтому сообщения пишутся сразу
/// по-человечески, а не «Io(Os { code: 2 })».
type Fallible<T> = Result<T, String>;

/// Файлы, переданные в командной строке: «Открыть с помощью» из проводника,
/// перетаскивание на значок, запуск из консоли.
#[tauri::command]
pub fn startup_paths() -> Vec<String> {
    let args: Vec<String> = std::env::args().collect();
    crate::cli::file_paths(&args)
}

/// Пути, которые вторые экземпляры оставили, пока окно запускалось (Я6
/// ревизии). Фронтенд зовёт это один раз, подписавшись на `OPEN_PATHS`;
/// дальше записки приходят событием.
#[tauri::command]
pub fn open_requests(
    mailbox: tauri::State<'_, crate::single::Mailbox>,
    state: tauri::State<'_, AppState>,
) -> Vec<String> {
    mailbox.open(&state.data_dir.path)
}

#[tauri::command]
pub fn list_buffers(state: tauri::State<'_, AppState>) -> Vec<Buffer> {
    let buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    buffers.list().to_vec()
}

/// Показать буфер: открыть его вкладку в активной области (Р-207).
///
/// Все команды открытия заканчиваются здесь, и это единственное место,
/// где буфер попадает в раскладку. Блокировка раскладки берётся после
/// блокировки реестра и всегда отдельно — см. правило порядка в `AppState`.
fn show(state: &AppState, id: BufferId) {
    let mut layout = state.layout.lock().expect("layout lock poisoned");
    layout.open(id);
}

#[tauri::command]
pub fn new_buffer(state: tauri::State<'_, AppState>) -> Buffer {
    let buffer = {
        let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        buffers.create_untitled(eol::DEFAULT).clone()
    };
    show(&state, buffer.id);
    buffer
}

/// Открыть параметры.
///
/// Вкладкой, а не режимом окна: до задачи 68 параметры занимали рабочую
/// область и закрывались повторным нажатием той же кнопки — так их и просил
/// переделать владелец, работающий в программе каждый день.
///
/// Вкладка одна на окно: если она уже открыта, возвращается та же.
#[tauri::command]
pub fn open_settings(state: tauri::State<'_, AppState>) -> Buffer {
    let buffer = {
        let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        buffers.create_settings().clone()
    };
    show(&state, buffer.id);
    buffer
}

/// Открыть файл.
///
/// Если файл уже открыт, новая вкладка не заводится — возвращается та же.
/// Две вкладки с одним путём означали бы два источника истины и потерю
/// правок при сохранении.
#[tauri::command]
pub fn open_file(state: tauri::State<'_, AppState>, path: String) -> Fallible<Opened> {
    // `&state` — ссылка на обёртку Tauri, а функция ждёт `&AppState`:
    // обёртка отдаёт ссылку на содержимое сама (`Deref`). Тело вынесено,
    // чтобы его можно было проверить тестом без запущенного приложения.
    open_path(&state, PathBuf::from(path))
}

fn open_path(state: &AppState, path: PathBuf) -> Fallible<Opened> {
    // Неполный путь не открывается (Ф5 ревизии): разрешился бы он от текущей
    // папки процесса, а она — чья угодно, только не того, кто путь дал.
    // Полным его делает тот, кто знает свою папку, — разбор командной
    // строки (`cli::file_paths`); сюда такой доехать не должен, и если
    // доехал, в буфер, сессию и недавнее он не попадёт.
    if !path.is_absolute() {
        return Err(tr_with("error.open.relative", &[("file", &path.display().to_string())]));
    }

    // Сначала смотрим, не открыт ли уже. Блокировку сразу отпускаем:
    // дальше идёт работа с диском, а под блокировкой её держать нельзя.
    let already_open = {
        let buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        buffers.find_by_path(&path).map(|b| (b.id, b.kind))
    };

    if let Some((id, kind)) = already_open {
        // В историю попадает и повторное открытие: пользователь только что
        // выбрал этот файл, и в списке недавнего он должен оказаться сверху.
        remember_recent(state, &path);
        // И в активную область тоже: файл, открытый в соседней, отсюда
        // получает зеркало (Р-209), а открытый здесь — просто активируется.
        show(state, id);

        // Картинку и PDF перечитать не во вред: правок в них нет, а показ
        // заодно подхватит подменённый на диске файл.
        if kind != TabKind::Text {
            return Ok(Opened {
                content: reload(state, id)?,
                reused: false,
            });
        }

        // Текст — нет (задача 135): в буфере могут быть несохранённые
        // правки, и перечитывание их стирало. Изменения снаружи ловит
        // проверка при возврате фокуса — и спрашивает (Р-014).
        let buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        let buffer = buffers
            .get(id)
            .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?
            .clone();
        return Ok(Opened {
            content: BufferWithText {
                buffer,
                text: String::new(),
            },
            reused: true,
        });
    }

    // Картинка и PDF открываются вкладками своего вида (Р-180). Файл на этом
    // шаге не читается вовсе: текста в нём нет, а байты понадобятся только
    // показу и только пока вкладка на экране (Р-193).
    let kind = TabKind::for_path(&path);
    if kind != TabKind::Text {
        let disk = text_file::DiskState::of(&path)
            .map_err(|e| tr_with(
                "error.open.failed",
                &[("file", &path.display().to_string()), ("error", &e.to_string())],
            ))?;

        let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        let buffer = buffers.create_viewed(path.clone(), disk, kind).clone();
        drop(buffers);

        show(state, buffer.id);
        remember_recent(state, &path);
        return Ok(Opened {
            content: BufferWithText {
                buffer,
                text: String::new(),
            },
            reused: false,
        });
    }

    // Проект, которому файл принадлежит, может знать его кодировку лучше
    // эвристики. Подсказка берётся до чтения и только помогает угадать —
    // см. `document::read_with_hint`.
    //
    // Отказ начинается теми же словами, что у картинки: интерфейс
    // показывает его как есть (С9 ревизии), а голое «C:\x.md: не найден»
    // не говорит, что именно не вышло.
    let opened = text_file::open_with_hint(&path, state.encoding_hint(&path))
        .map_err(|e| tr_with("error.open.plain", &[("error", &e.to_string())]))?;

    let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    let buffer = buffers
        .create_from_file(
            opened.path,
            opened.document.encoding,
            opened.document.bom,
            opened.document.eol,
            opened.document.lossy,
            opened.document.encoding_confident,
            opened.read_only,
            opened.large,
            opened.disk,
        )
        .clone();

    // История пишется после успешного чтения: файла, который не открылся,
    // в списке недавнего быть не должно.
    drop(buffers);
    show(state, buffer.id);
    remember_recent(state, &path);

    Ok(Opened {
        content: BufferWithText {
            buffer,
            text: opened.document.text,
        },
        reused: false,
    })
}

/// Записать файл в историю. Неудача записи не должна мешать открытию:
/// список недавнего — удобство, а открытый файл — работа.
fn remember_recent(state: &AppState, path: &std::path::Path) {
    let _ = session::recent::remember(&state.data_dir.path, path, session::recent::now_ms());
}

/// Недавний файл в том виде, в каком его ждёт интерфейс.
///
/// Отдельно от записи в файле истории: там имена ключей в стиле TOML
/// (`opened-at`), потому что файл читается и человеком тоже. Тащить это имя
/// в JavaScript значило бы писать `entry['opened-at']` в каждом месте.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    pub opened_at: u64,
}

/// Недавно открытые файлы для стартового экрана.
#[tauri::command]
pub fn recent_files(state: tauri::State<'_, AppState>) -> Vec<RecentFile> {
    session::recent::read(&state.data_dir.path)
        .into_iter()
        .map(|entry| RecentFile {
            path: entry.path.display().to_string(),
            opened_at: entry.opened_at,
        })
        .collect()
}

/// Перечитать содержимое с диска, сохранив идентификатор буфера и вкладку.
#[tauri::command]
pub fn reload_buffer(
    state: tauri::State<'_, AppState>,
    id: BufferId,
) -> Fallible<BufferWithText> {
    reload(&state, id)
}

fn reload(state: &AppState, id: BufferId) -> Fallible<BufferWithText> {
    let (path, kind) = {
        let buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        let buffer = buffers
            .get(id)
            .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;
        (
            buffer
                .path
                .clone()
                .ok_or_else(|| tr("error.buffer.no-file"))?,
            buffer.kind,
        )
    };

    // Картинку и PDF перечитывать нечем: текста в них нет, а байты показ
    // берёт сам и каждый раз заново. Обновляется только состояние на диске —
    // из него берётся вес файла для строки состояния.
    if kind != TabKind::Text {
        let disk = text_file::DiskState::of(&path)
            .map_err(|e| tr_with(
                "error.open.failed",
                &[("file", &path.display().to_string()), ("error", &e.to_string())],
            ))?;

        let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        let buffer = buffers
            .get_mut(id)
            .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;
        buffer.disk = Some(disk);

        return Ok(BufferWithText {
            buffer: buffer.clone(),
            text: String::new(),
        });
    }

    let opened = text_file::open_with_hint(&path, state.encoding_hint(&path))
        .map_err(|e| e.to_string())?;

    let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;

    buffer.encoding = opened.document.encoding;
    buffer.bom = opened.document.bom;
    buffer.eol = opened.document.eol.dominant;
    buffer.eol_mixed = opened.document.eol.mixed;
    buffer.lossy = opened.document.lossy;
    buffer.encoding_confident = opened.document.encoding_confident;
    buffer.read_only = opened.read_only || opened.large;
    buffer.large = opened.large;
    buffer.disk = Some(opened.disk);
    buffer.modified = false;

    Ok(BufferWithText {
        buffer: buffer.clone(),
        text: opened.document.text,
    })
}

/// Прочитать те же байты другой кодировкой — «интерпретировать как».
///
/// Буфер остаётся чистым: файл не менялся, поменялось прочтение. Это одна
/// из двух разных операций смены кодировки; вторая — `convert_encoding`.
#[tauri::command]
pub fn reinterpret_encoding(
    state: tauri::State<'_, AppState>,
    id: BufferId,
    encoding: Encoding,
) -> Fallible<BufferWithText> {
    let path = {
        let buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        buffers
            .get(id)
            .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?
            .path
            .clone()
            .ok_or_else(|| tr("error.reread.no-file"))?
    };

    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let document = document::reinterpret(&bytes, encoding);

    let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;

    buffer.encoding = document.encoding;
    buffer.bom = document.bom;
    buffer.eol = document.eol.dominant;
    buffer.eol_mixed = document.eol.mixed;
    buffer.lossy = document.lossy;
    buffer.encoding_confident = true;
    buffer.modified = false;

    Ok(BufferWithText {
        buffer: buffer.clone(),
        text: document.text,
    })
}

/// Сменить кодировку записи, оставив текст как есть — «преобразовать в».
///
/// Текст не трогается, но файл на диске после сохранения станет другим,
/// поэтому буфер помечается изменённым.
#[tauri::command]
pub fn convert_encoding(
    state: tauri::State<'_, AppState>,
    id: BufferId,
    encoding: Encoding,
    text: String,
) -> Fallible<Buffer> {
    // Проверяем переводимость до того, как что-либо менять: узнать о
    // непереводимом символе в момент сохранения — слишком поздно.
    enc::encode(&text, encoding).map_err(|e| e.to_string())?;

    let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;

    // Метка порядка байтов имеет смысл не у всех кодировок. Переходя
    // на однобайтовую, снимаем её, иначе она уехала бы в файл как мусор.
    if encoding.bom_bytes().is_empty() {
        buffer.bom = false;
    }
    buffer.encoding = encoding;
    buffer.modified = true;

    Ok(buffer.clone())
}

/// Добавить или убрать метку порядка байтов при записи.
///
/// Отдельной командой, а не частью смены кодировки: это независимое свойство
/// файла, и менять его пользователь может не трогая кодировку.
#[tauri::command]
pub fn set_bom(state: tauri::State<'_, AppState>, id: BufferId, bom: bool) -> Fallible<Buffer> {
    let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;

    if bom && buffer.encoding.bom_bytes().is_empty() {
        return Err(tr_with("error.bom.impossible", &[("encoding", buffer.encoding.label())]));
    }

    buffer.bom = bom;
    buffer.modified = true;
    Ok(buffer.clone())
}

/// Сменить тип переноса строк для записи.
#[tauri::command]
pub fn set_line_ending(
    state: tauri::State<'_, AppState>,
    id: BufferId,
    line_ending: Eol,
) -> Fallible<Buffer> {
    let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;

    buffer.eol = line_ending;
    buffer.modified = true;
    // Выбор сделан явно — смешение перестало быть открытым вопросом.
    buffer.eol_mixed = false;

    Ok(buffer.clone())
}

/// Отметить буфер изменённым или чистым.
///
/// Зовётся фронтендом только на переходах, а не на каждое нажатие клавиши.
#[tauri::command]
pub fn set_modified(
    state: tauri::State<'_, AppState>,
    id: BufferId,
    modified: bool,
) -> Fallible<()> {
    let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;
    buffer.modified = modified;
    Ok(())
}

/// Чем кончилось сохранение.
///
/// Отдельный тип, а не строка ошибки: расхождение с диском — не сбой, а
/// вопрос к пользователю, и отличать его от настоящей ошибки записи надо
/// надёжно, а не разбором текста сообщения.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    /// Файл на диске изменился с момента чтения. Ничего не записано.
    pub conflict: bool,
    pub buffer: Option<Buffer>,
}

/// Сохранить буфер. `path` задан — это «сохранить как».
///
/// `force` пропускает проверку расхождения с диском: так вызывающий код
/// подтверждает перезапись после вопроса пользователю.
#[tauri::command]
pub fn save_buffer(
    state: tauri::State<'_, AppState>,
    id: BufferId,
    text: String,
    path: Option<String>,
    force: bool,
) -> Fallible<SaveResult> {
    let (target, encoding, bom, line_ending, read_only, known_disk) = {
        let buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        let buffer = buffers
            .get(id)
            .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;

        let target = match &path {
            Some(explicit) => PathBuf::from(explicit),
            None => buffer
                .path
                .clone()
                .ok_or_else(|| tr("error.save.no-file"))?,
        };

        (
            target,
            buffer.encoding,
            buffer.bom,
            buffer.eol,
            buffer.read_only,
            buffer.disk,
        )
    };

    // Упрощённый режим и файлы «только для чтения» не сохраняются.
    // «Сохранить как» разрешено: это запись в другой файл.
    if read_only && path.is_none() {
        return Err(tr("error.read-only"));
    }

    // Проверка прямо перед записью — последняя возможность заметить, что файл
    // изменили снаружи, пока мы его редактировали. Только для сохранения
    // в тот же файл: «сохранить как» пишет в другой, и сравнивать не с чем.
    if !force && path.is_none() {
        if let Some(known) = known_disk
            && let Ok(current) = text_file::DiskState::of(&target)
            && current != known
        {
            return Ok(SaveResult {
                conflict: true,
                buffer: None,
            });
        }
    }

    let disk = text_file::write(&target, &text, encoding, bom, line_ending)
        .map_err(|e| e.to_string())?;

    let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    buffers.mark_saved(id, target, disk);

    Ok(SaveResult {
        conflict: false,
        buffer: buffers.get(id).cloned(),
    })
}

// --- Отслеживание внешних изменений ---

use text_file::ExternalStatus;
use crate::l10n::{tr, tr_with};

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChange {
    pub id: BufferId,
    pub status: ExternalStatus,
}

/// Сверить состояние файлов на диске с тем, каким оно было при чтении.
///
/// Опрос, а не подписка на события файловой системы: см. DESIGN.md, решение
/// Р-014. Вызывается при получении окном фокуса — именно тогда, когда
/// пользователь мог что-то сделать с файлом в другой программе.
#[tauri::command]
pub fn check_external(state: tauri::State<'_, AppState>) -> Vec<ExternalChange> {
    let buffers = state.buffers.lock().expect("buffer registry lock poisoned");

    buffers
        .list()
        .iter()
        .filter_map(|buffer| {
            let path = buffer.path.as_ref()?;
            let known = buffer.disk?;

            match text_file::compare_with_disk(path, known) {
                ExternalStatus::Unchanged => None,
                status => Some(ExternalChange {
                    id: buffer.id,
                    status,
                }),
            }
        })
        .collect()
}

/// Принять текущее состояние файла как эталонное, не трогая содержимое буфера.
///
/// Нужно, когда пользователь решил оставить свои правки: без этого вопрос
/// повторялся бы при каждом возврате в окно.
#[tauri::command]
pub fn accept_external(state: tauri::State<'_, AppState>, id: BufferId) -> Fallible<Buffer> {
    let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;

    if let Some(path) = &buffer.path {
        buffer.disk = text_file::DiskState::of(path).ok();
    }
    // Содержимое буфера теперь заведомо расходится с файлом.
    buffer.modified = true;

    Ok(buffer.clone())
}

/// Файл исчез, а содержимое пользователь решил оставить.
///
/// Путь сохраняется — по нему буфер и запишется обратно при сохранении, —
/// но сведений о файле на диске больше нет, и сверять их не с чем.
#[tauri::command]
pub fn mark_detached(state: tauri::State<'_, AppState>, id: BufferId) -> Fallible<Buffer> {
    let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;

    buffer.disk = None;
    buffer.modified = true;
    Ok(buffer.clone())
}

/// Закрыть буфер совсем — из реестра и из всех областей, где он лежал.
///
/// Закрытие вкладки в одной области при живом зеркале в другой — это
/// не закрытие буфера, а правка раскладки; её делает `remove` в дереве,
/// и сюда она не доходит.
///
/// Возвращает раскладку: закрытие могло схлопнуть область, и фронтенду
/// нужна новая форма окна, а не признак «закрылось».
#[tauri::command]
pub fn close_buffer(state: tauri::State<'_, AppState>, id: BufferId) -> Layout {
    {
        let mut buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        buffers.close(id);
    }
    let mut layout = state.layout.lock().expect("layout lock poisoned");
    layout.remove_everywhere(id);
    layout.clone()
}

/// Список кодировок для меню.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodingOption {
    pub id: Encoding,
    pub label: String,
    /// У кодировки бывает метка порядка байтов.
    pub supports_bom: bool,
}

#[tauri::command]
pub fn list_encodings() -> Vec<EncodingOption> {
    Encoding::all()
        .iter()
        .map(|&encoding| EncodingOption {
            id: encoding,
            label: encoding.label().to_owned(),
            supports_bom: !encoding.bom_bytes().is_empty(),
        })
        .collect()
}

/// Предел на размер картинки — Р-193.
///
/// Картинка едет в окно строкой `data:`, а та на треть длиннее файла:
/// шестнадцать мегабайт превращаются в двадцать два миллиона знаков.
/// Настоящая цена ещё выше — в памяти окна лежит не файл, а разобранная
/// картинка, по четыре байта на точку, и её размер зависит от числа точек,
/// а не от веса файла. Предел поэтому приблизительный: он отсекает заведомо
/// неподъёмное, а не считает память.
const IMAGE_LIMIT: u64 = 16 * 1024 * 1024;

/// Картинка вкладки адресом `data:`.
///
/// Спрашивается показом при появлении вкладки на экране и не хранится в ядре:
/// байты живут ровно столько, сколько видна вкладка (Р-193). Политика
/// безопасности окна при этом не меняется — `img-src` разрешает `data:`
/// с третьего этапа (Р-182).
#[tauri::command]
pub fn image_source(state: tauri::State<'_, AppState>, id: BufferId) -> Fallible<String> {
    let path = {
        let buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        let buffer = buffers
            .get(id)
            .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;

        if buffer.kind != TabKind::Image {
            return Err(tr("error.not-image"));
        }
        buffer
            .path
            .clone()
            .ok_or_else(|| tr("error.tab.no-file"))?
    };

    image_data_url(&path)
}

/// Картинка из заметки — для живого превью markdown (задача 72).
///
/// Путь приходит таким, каким его написали в `![подпись](рисунок.png)`, и всё
/// про него решает ядро: относительный считается от папки заметки, абсолютный
/// берётся как есть. Гадать об этом во фронтенде нельзя — там нет ни файловой
/// системы, ни правил разбора путей Windows.
///
/// Читается тем же путём, что и вкладка с картинкой: один предел, один список
/// видов, один способ отдать байты (Р-201).
#[tauri::command]
pub fn preview_image(link: String, base: Option<String>) -> Fallible<String> {
    let link = PathBuf::from(link);

    // Сетевой путь из текста заметки не читается (задача 139, находки Р1
    // и Ф4 ревизии). Читая `\\сервер\папка\x.png`, Windows сама входит
    // на сервер и отдаёт ему хэш пароля (NTLM), а недоступный сервер держит
    // окно до тайм-аута, — и всё это без единого нажатия, просто оттого,
    // что заметку открыли. Р-202 запрещал сетевые **адреса**; сетевой
    // **путь** — то же самое. Относительный путь у заметки, которая сама
    // лежит на сетевой папке, остаётся: туда человек пришёл сам.
    if crate::fsx::network::is_network(&link) {
        return Err(tr_with("error.network-path", &[("path", &link.display().to_string())]));
    }

    let path = if link.is_absolute() {
        link
    } else {
        let note = base.ok_or_else(|| tr("error.note.unsaved"))?;
        PathBuf::from(note)
            .parent()
            .ok_or_else(|| tr("error.note.no-folder"))?
            .join(link)
    };

    image_data_url(&path)
}

/// Картинка вставкой Obsidian — `![[рисунок.png]]` (задача 83).
///
/// Отличие от `preview_image` одно, и оно всё: цель здесь не путь, а **имя**,
/// и превратить имя в путь умеет только индекс. Правила те же, по которым
/// разрешаются `[[ссылки]]`, — второго способа находить файл по имени
/// в проекте нет и быть не должно (Р-217).
///
/// Байты дальше идут тем же путём, что у вкладки с картинкой и у превью
/// по обычной записи (Р-201).
#[tauri::command]
pub fn preview_embed(
    state: tauri::State<'_, AppState>,
    target: String,
    from: String,
) -> Fallible<String> {
    let scope = super::index::scope_of(&state, &from)
        .ok_or_else(|| tr("error.note.outside"))?;

    let found = state
        .index
        .lock()
        .expect("index lock poisoned")
        .resolve_link(&target, &from, &scope)
        .ok_or_else(|| tr_with("error.link.no-file", &[("target", &target.to_string())]))?;

    image_data_url(std::path::Path::new(&found.path))
}

/// Байты картинки адресом `data:` — общая часть вкладки и превью.
fn image_data_url(path: &std::path::Path) -> Fallible<String> {
    let mime = TabKind::image_mime(path).ok_or_else(|| tr("error.image.unknown"))?;

    // Размер спрашивается до чтения: смысл предела в том, чтобы не прочитать
    // в память то, что показать всё равно нельзя.
    let size = std::fs::metadata(path)
        .map_err(|e| tr_with(
            "error.read.failed",
            &[("file", &path.display().to_string()), ("error", &e.to_string())],
        ))?
        .len();

    if size > IMAGE_LIMIT {
        return Err(tr_with(
            "error.image.too-big",
            &[
                ("size", &size.div_ceil(1024 * 1024).to_string()),
                ("limit", &(IMAGE_LIMIT / (1024 * 1024)).to_string()),
            ],
        ));
    }

    let bytes = std::fs::read(path)
        .map_err(|e| tr_with(
            "error.read.failed",
            &[("file", &path.display().to_string()), ("error", &e.to_string())],
        ))?;

    Ok(format!(
        "data:{mime};base64,{}",
        crate::text::base64::encode(&bytes)
    ))
}

/// Предел на размер PDF.
///
/// Больше, чем у картинки, и по понятной причине: PDF едет в окно двоичными
/// байтами, а не строкой `data:`, — той трети сверху, из-за которой предел
/// картинки такой строгий, здесь нет. Смысл предела остаётся тот же: не дать
/// одному файлу утянуть за собой окно. Отсканированная книга на полгигабайта
/// существует, и открывать её нам нечем.
const PDF_LIMIT: u64 = 64 * 1024 * 1024;

/// Байты PDF для показа.
///
/// Двоичным ответом, а не строкой: pdf.js принимает массив байтов, и гонять
/// его через base64 значило бы платить треть объёма и два преобразования
/// ни за что. Картинке строка нужна — она едет в адрес `data:`; здесь
/// не нужна (Р-196).
#[tauri::command]
pub fn pdf_bytes(
    state: tauri::State<'_, AppState>,
    id: BufferId,
) -> Result<tauri::ipc::Response, String> {
    let path = {
        let buffers = state.buffers.lock().expect("buffer registry lock poisoned");
        let buffer = buffers
            .get(id)
            .ok_or_else(|| tr_with("error.buffer.missing", &[("id", &id.to_string())]))?;

        if buffer.kind != TabKind::Pdf {
            return Err(tr("error.not-pdf"));
        }
        buffer
            .path
            .clone()
            .ok_or_else(|| tr("error.tab.no-file"))?
    };

    // Размер спрашивается до чтения: смысл предела в том, чтобы не прочитать
    // в память то, что показать всё равно нельзя.
    let size = std::fs::metadata(&path)
        .map_err(|e| tr_with(
            "error.read.failed",
            &[("file", &path.display().to_string()), ("error", &e.to_string())],
        ))?
        .len();

    if size > PDF_LIMIT {
        return Err(tr_with(
            "error.pdf.too-big",
            &[
                ("size", &size.div_ceil(1024 * 1024).to_string()),
                ("limit", &(PDF_LIMIT / (1024 * 1024)).to_string()),
            ],
        ));
    }

    let bytes = std::fs::read(&path)
        .map_err(|e| tr_with(
            "error.read.failed",
            &[("file", &path.display().to_string()), ("error", &e.to_string())],
        ))?;

    Ok(tauri::ipc::Response::new(bytes))
}

/// Показать путь в проводнике: папку — открыть, файл — выделить в его папке.
#[tauri::command]
pub fn reveal_path(path: String) -> Fallible<()> {
    crate::fsx::reveal::reveal(std::path::Path::new(&path)).map_err(|error| error.to_string())
}

/// Пути, разложенные на файлы и папки.
#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPaths {
    pub files: Vec<String>,
    pub folders: Vec<String>,
}

/// Разложить пути на файлы и папки — для перетаскивания в окно.
///
/// Одним вызовом на все пути, а не по одному: в окно роняют и десяток файлов
/// сразу, и десять обращений через IPC ради десяти системных вызовов —
/// это плата ни за что.
///
/// Несуществующий путь считается файлом сознательно: он уедет в открытие
/// и вернётся оттуда внятным «файл не найден». Молча выбросить его значило бы
/// сделать вид, что ничего не роняли.
#[tauri::command]
pub fn split_paths(paths: Vec<String>) -> SplitPaths {
    let mut out = SplitPaths::default();

    for path in paths {
        if std::path::Path::new(&path).is_dir() {
            out.folders.push(path);
        } else {
            out.files.push(path);
        }
    }

    out
}

/// Файл по ссылке markdown `[текст](путь)` — для перехода (задача 148).
///
/// Путь считается как у картинки (`preview_image`): относительный — от папки
/// заметки, абсолютный — как есть. Сетевой путь не открывается сам по себе
/// (Р-300). `None` — файла нет.
#[tauri::command]
pub fn resolve_path_link(link: String, from: String) -> Option<String> {
    path_link_target(Path::new(&link), Path::new(&from)).map(|path| path.to_string_lossy().into_owned())
}

/// Существующий файл, на который ведёт путь из ссылки заметки `from`.
///
/// `..` снимается (`std::path::absolute` — `GetFullPathNameW` без обращения
/// к диску): вкладка по пути с `..` была бы второй вкладкой того же файла.
/// Без расширения пробуется `.md` — так пишут ссылки на заметки.
fn path_link_target(link: &Path, from: &Path) -> Option<PathBuf> {
    if crate::fsx::network::is_network(link) {
        return None;
    }
    let joined = if link.is_absolute() {
        link.to_path_buf()
    } else {
        from.parent()?.join(link)
    };
    let full = std::path::absolute(joined).ok()?;
    if full.is_file() {
        return Some(full);
    }
    if full.extension().is_none() {
        let note = full.with_extension("md");
        if note.is_file() {
            return Some(note);
        }
    }
    None
}

/// Текст из буфера обмена — для пункта «Вставить» (Р-109).
#[tauri::command]
pub fn clipboard_text() -> Fallible<String> {
    crate::clipboard::text()
}

/// Картинка из буфера обмена — для «Вставить» в заметку (задача 146):
/// PNG или растр файлом BMP, пусто — картинки нет. Байтами, как PDF
/// (`pdf_bytes`): снимок экрана весит мегабайты, и числами JSON он вырос бы
/// вчетверо.
#[tauri::command]
pub fn clipboard_image() -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(crate::clipboard::image()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-split-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Ссылка markdown на файл (задача 148): относительно папки заметки,
    /// с `..`, без расширения — к заметке `.md`; сетевой путь и чего нет —
    /// никуда.
    #[test]
    fn path_links_resolve_from_the_note_folder() {
        let dir = temp_dir("path-link");
        std::fs::create_dir_all(dir.join("Заметки")).unwrap();
        std::fs::write(dir.join("Заметки").join("План.md"), "# План").unwrap();
        std::fs::write(dir.join("отчёт.pdf"), "pdf").unwrap();
        let from = dir.join("Заметки").join("Сегодня.md");

        assert_eq!(path_link_target(Path::new("План.md"), &from), Some(dir.join("Заметки").join("План.md")));
        assert_eq!(path_link_target(Path::new("План"), &from), Some(dir.join("Заметки").join("План.md")));
        assert_eq!(path_link_target(Path::new("../отчёт.pdf"), &from), Some(dir.join("отчёт.pdf")));
        assert_eq!(path_link_target(Path::new("Нет.md"), &from), None);
        assert_eq!(path_link_target(Path::new(r"\\сервер\папка\x.md"), &from), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Папка, брошенная в окно, обязана отличаться от файла: иначе она уедет
    /// в чтение и вернётся оттуда «Отказано в доступе».
    #[test]
    fn folders_are_told_from_files() {
        let dir = temp_dir("kinds");
        let file = dir.join("заметка.md");
        let nested = dir.join("Архив");
        std::fs::write(&file, "текст").unwrap();
        std::fs::create_dir_all(&nested).unwrap();

        let split = split_paths(vec![
            file.display().to_string(),
            nested.display().to_string(),
            dir.display().to_string(),
        ]);

        assert_eq!(split.files, vec![file.display().to_string()]);
        assert_eq!(
            split.folders,
            vec![nested.display().to_string(), dir.display().to_string()]
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Несуществующий путь считается файлом: он уедет в открытие и вернётся
    /// внятной ошибкой. Молча выбросить его — сделать вид, что ничего
    /// не роняли.
    #[test]
    fn missing_path_goes_to_files() {
        let split = split_paths(vec!["C:/нет/такого/пути.md".to_owned()]);

        assert_eq!(split.files.len(), 1);
        assert!(split.folders.is_empty());
    }

    /// Пустой список — пустой ответ, а не ошибка: в окно можно уронить
    /// и то, у чего нет пути вовсе.
    #[test]
    fn nothing_dropped_is_not_an_error() {
        assert_eq!(split_paths(Vec::new()), SplitPaths::default());
    }

    /// Картинка по сетевому пути из текста заметки не читается (задача 139,
    /// находки Р1 и Ф4): отказ приходит до всякого обращения к диску,
    /// и называет причину — до задачи 139 здесь было «не удалось прочитать»
    /// после попытки входа на сервер.
    #[test]
    fn network_image_is_refused_before_reading() {
        let error = preview_image(r"\\127.0.0.1\нет-такой-папки\x.png".to_owned(), None)
            .expect_err("сетевой путь обязан отвергаться");
        assert!(error.contains("сетевой путь"), "{error}");
    }

    /// Повторное открытие открытого файла не читает диск и не снимает
    /// признак изменения (задача 135, находка Ф1 ревизии).
    ///
    /// Щелчок в дереве по уже открытому файлу — как и переход по ссылке,
    /// быстрое открытие, выдача поиска — приходит сюда. До задачи 135 здесь
    /// стояло перечитывание: текст с диска и `modified = false`. Фронтенд
    /// подменял им вкладку, и несохранённые правки пропадали без вопроса;
    /// ядро при этом считало буфер чистым, и черновик после сбоя
    /// не поднялся бы тоже.
    #[test]
    fn reopening_an_open_file_keeps_unsaved_edits() {
        let dir = temp_dir("reopen");
        let file = dir.join("заметка.md");
        std::fs::write(&file, "диск").unwrap();
        let state = AppState::for_tests(dir.join("data"));

        let first = open_path(&state, file.clone()).unwrap();
        assert!(!first.reused);
        assert_eq!(first.content.text, "диск");
        let id = first.content.buffer.id;

        // Человек правит — фронтенд сообщает ядру о переходе в «изменён».
        state.buffers.lock().unwrap().get_mut(id).unwrap().modified = true;
        let disk_before = state.buffers.lock().unwrap().get(id).unwrap().disk;

        // Файл тем временем меняют снаружи. Повторное открытие — не повод
        // его перечитать: это дело проверки при возврате фокуса (Р-014).
        std::fs::write(&file, "чужое").unwrap();

        let again = open_path(&state, file.clone()).unwrap();
        assert!(again.reused);
        assert_eq!(again.content.buffer.id, id);
        assert_eq!(again.content.text, "");
        // Фронтенд читает плоский объект: `reused` рядом с `id` и `text`,
        // а не во вложенном `content` — его прячет `serde(flatten)`.
        let json = serde_json::to_value(&again).unwrap();
        assert_eq!(json["reused"], true);
        assert_eq!(json["id"], id);
        assert_eq!(json["text"], "");
        assert_eq!(json["modified"], true);

        let buffers = state.buffers.lock().unwrap();
        let buffer = buffers.get(id).unwrap();
        assert!(buffer.modified, "признак изменения снят повторным открытием");
        // Сверка с диском осталась прежней: проверка при возврате фокуса
        // увидит внешнюю правку и спросит.
        assert_eq!(buffer.disk, disk_before);
        drop(buffers);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Относительный путь не открывается (Ф5 ревизии): он разрешился бы
    /// от текущей папки процесса — у тестов это папка крейта, где
    /// `Cargo.toml` есть, — и остался бы относительным в буфере и сессии.
    #[test]
    fn relative_path_is_not_opened() {
        let dir = temp_dir("relative");
        let state = AppState::for_tests(dir.join("data"));

        assert!(std::path::Path::new("Cargo.toml").exists());
        let refused = open_path(&state, PathBuf::from("Cargo.toml"));

        assert!(refused.is_err(), "относительный путь открылся");
        assert!(state.buffers.lock().unwrap().list().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Картинку повторное открытие перечитывает, как и раньше: правок в ней
    /// нет, а подменённый на диске файл показ заодно подхватит.
    #[test]
    fn reopening_an_image_refreshes_it() {
        let dir = temp_dir("reopen-image");
        let file = dir.join("рисунок.png");
        std::fs::write(&file, [0u8; 4]).unwrap();
        let state = AppState::for_tests(dir.join("data"));

        let first = open_path(&state, file.clone()).unwrap();
        let again = open_path(&state, file.clone()).unwrap();

        assert!(!again.reused);
        assert_eq!(again.content.buffer.id, first.content.buffer.id);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
