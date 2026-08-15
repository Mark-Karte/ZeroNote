//! Команды работы с файлами и буферами.
//!
//! Логики здесь нет: чтение и запись делают `fsx/`, разбор — `text/`,
//! список буферов ведёт `model/`. Этот слой только переводит между ними
//! и фронтендом.

use std::path::PathBuf;

use crate::fsx::text_file;
use crate::model::buffer::{Buffer, BufferId};
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

#[tauri::command]
pub fn list_buffers(state: tauri::State<'_, AppState>) -> Vec<Buffer> {
    let buffers = state.buffers.lock().expect("реестр буферов повреждён");
    buffers.list().to_vec()
}

#[tauri::command]
pub fn new_buffer(state: tauri::State<'_, AppState>) -> Buffer {
    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    buffers.create_untitled(eol::DEFAULT).clone()
}

/// Открыть файл.
///
/// Если файл уже открыт, новая вкладка не заводится — возвращается та же.
/// Две вкладки с одним путём означали бы два источника истины и потерю
/// правок при сохранении.
#[tauri::command]
pub fn open_file(state: tauri::State<'_, AppState>, path: String) -> Fallible<BufferWithText> {
    let path = PathBuf::from(path);

    // Сначала смотрим, не открыт ли уже. Блокировку сразу отпускаем:
    // дальше идёт работа с диском, а под блокировкой её держать нельзя.
    let already_open = {
        let buffers = state.buffers.lock().expect("реестр буферов повреждён");
        buffers.find_by_path(&path).map(|b| b.id)
    };

    if let Some(id) = already_open {
        return reload_buffer(state, id);
    }

    let opened = text_file::open(&path).map_err(|e| e.to_string())?;

    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
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

    Ok(BufferWithText {
        buffer,
        text: opened.document.text,
    })
}

/// Перечитать содержимое с диска, сохранив идентификатор буфера и вкладку.
#[tauri::command]
pub fn reload_buffer(
    state: tauri::State<'_, AppState>,
    id: BufferId,
) -> Fallible<BufferWithText> {
    let path = {
        let buffers = state.buffers.lock().expect("реестр буферов повреждён");
        buffers
            .get(id)
            .ok_or_else(|| format!("буфер {id} не найден"))?
            .path
            .clone()
            .ok_or_else(|| "у буфера нет файла на диске".to_owned())?
    };

    let opened = text_file::open(&path).map_err(|e| e.to_string())?;

    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| format!("буфер {id} не найден"))?;

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
        let buffers = state.buffers.lock().expect("реестр буферов повреждён");
        buffers
            .get(id)
            .ok_or_else(|| format!("буфер {id} не найден"))?
            .path
            .clone()
            .ok_or_else(|| "перечитать можно только буфер с файлом на диске".to_owned())?
    };

    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let document = document::reinterpret(&bytes, encoding);

    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| format!("буфер {id} не найден"))?;

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

    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| format!("буфер {id} не найден"))?;

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
    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| format!("буфер {id} не найден"))?;

    if bom && buffer.encoding.bom_bytes().is_empty() {
        return Err(format!(
            "у кодировки {} не бывает метки порядка байтов",
            buffer.encoding.label()
        ));
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
    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| format!("буфер {id} не найден"))?;

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
    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| format!("буфер {id} не найден"))?;
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
        let buffers = state.buffers.lock().expect("реестр буферов повреждён");
        let buffer = buffers
            .get(id)
            .ok_or_else(|| format!("буфер {id} не найден"))?;

        let target = match &path {
            Some(explicit) => PathBuf::from(explicit),
            None => buffer
                .path
                .clone()
                .ok_or_else(|| "у буфера нет файла: нужно «сохранить как»".to_owned())?,
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
        return Err("файл открыт только для чтения".to_owned());
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

    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    buffers.mark_saved(id, target, disk);

    Ok(SaveResult {
        conflict: false,
        buffer: buffers.get(id).cloned(),
    })
}

// --- Отслеживание внешних изменений ---

use text_file::ExternalStatus;

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
    let buffers = state.buffers.lock().expect("реестр буферов повреждён");

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
    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| format!("буфер {id} не найден"))?;

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
    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    let buffer = buffers
        .get_mut(id)
        .ok_or_else(|| format!("буфер {id} не найден"))?;

    buffer.disk = None;
    buffer.modified = true;
    Ok(buffer.clone())
}

#[tauri::command]
pub fn close_buffer(state: tauri::State<'_, AppState>, id: BufferId) -> bool {
    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    buffers.close(id)
}

#[tauri::command]
pub fn reorder_buffer(state: tauri::State<'_, AppState>, id: BufferId, to: usize) -> Vec<Buffer> {
    let mut buffers = state.buffers.lock().expect("реестр буферов повреждён");
    buffers.reorder(id, to);
    buffers.list().to_vec()
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
