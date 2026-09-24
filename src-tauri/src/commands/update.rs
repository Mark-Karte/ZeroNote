//! Обновление из GitHub: проверка, загрузка с отменой, установка
//! (задачи 44 и 104).
//!
//! До отмены загрузки всё это звало окно — через JS-часть плагина. Отмена
//! вернула работу сюда: JS-часть плагина прервать загрузку не умеет, а здесь
//! загрузка — обычная асинхронная задача, и её можно снять. Снятая задача
//! бросает запрос посреди ответа, соединение закрывается — отмена настоящая,
//! а не «перестали ждать, а загрузка идёт дальше» (Р-257).
//!
//! Логики здесь нет, как и во всём `commands/`: проверку подписи, сеть
//! и запуск установщика делает плагин. Здесь только кто что держит между
//! вызовами и как снять идущую работу.

use std::future::Future;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Как снять идущую работу.
///
/// Коробка с замыканием, а не сама ручка отмены: ручка — тип tokio, а tokio
/// у нас не прямая зависимость, и назвать его тип в поле значило бы её
/// завести. Замыкание прячет тип внутри себя. `FnOnce` — снять можно один
/// раз; `Send` — вызовет её другая команда, то есть другой поток.
type Abort = Box<dyn FnOnce() + Send>;

/// Что держится между вызовами окна.
///
/// Три `Mutex`, а не один на всё: команды берут их по отдельности и ненадолго,
/// а главное — ни одна не держит замок через `await`. Замок, удержанный
/// на время загрузки, запер бы и отмену: она ждала бы конца того, что
/// должна остановить.
#[derive(Default)]
pub struct UpdateState {
    /// Найденная проверкой версия: ждёт «Установить».
    found: Mutex<Option<Update>>,
    /// Скачанный пакет с проверенной подписью: ждёт установки.
    bytes: Mutex<Option<Vec<u8>>>,
    /// Идущая проверка или загрузка — её можно снять.
    abort: Mutex<Option<Abort>>,
}

/// Ход загрузки — в том же виде, в каком его присылала JS-часть плагина:
/// окно разбирает его тем же кодом (`ui/download.ts`).
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    /// Приходит вместе с первым куском, а не при соединении.
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize },
    /// Последний кусок пришёл; подпись ещё не проверена.
    Finished,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CheckOutcome {
    UpToDate,
    Found { version: String, notes: Option<String> },
    Cancelled,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadOutcome {
    /// Скачано, подпись сошлась — можно ставить.
    Ready,
    Cancelled,
}

/// Запустить работу отдельной задачей и дождаться её, оставив ручку отмены.
///
/// `Ok(None)` — задачу сняли. Почему отдельная задача, а не просто `await`:
/// снять можно только задачу. Будущее, которое ждёт сама команда, другой
/// вызов не достанет — а задачу достаёт через ручку, оставленную в состоянии.
///
/// `'static` у работы — потому что задача живёт сама по себе: компилятор
/// не может доказать, что она кончится раньше команды, и запрещает ей
/// ссылаться на то, что принадлежит команде. Поэтому работа забирает всё
/// нужное себе (`async move`).
async fn cancellable<T: Send + 'static>(
    state: &UpdateState,
    work: impl Future<Output = T> + Send + 'static,
) -> Result<Option<T>, String> {
    let handle = tauri::async_runtime::spawn(work);
    let abort = handle.inner().abort_handle();
    *state.abort.lock().expect("состояние обновления повреждено") =
        Some(Box::new(move || abort.abort()));

    let result = handle.await;
    state.abort.lock().expect("состояние обновления повреждено").take();

    match result {
        Ok(value) => Ok(Some(value)),
        Err(tauri::Error::JoinError(error)) if error.is_cancelled() => Ok(None),
        // Паника внутри плагина: сказать словами, а не уронить окно.
        Err(error) => Err(error.to_string()),
    }
}

/// Проверить, есть ли новая версия. `timeout_ms` — срок у запроса.
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    timeout_ms: u64,
) -> Result<CheckOutcome, String> {
    let updater = app
        .updater_builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| error.to_string())?;

    let Some(result) = cancellable(&state, async move { updater.check().await }).await? else {
        return Ok(CheckOutcome::Cancelled);
    };
    let found = result.map_err(|error| error.to_string())?;

    let outcome = match &found {
        None => CheckOutcome::UpToDate,
        Some(update) => CheckOutcome::Found {
            version: update.version.clone(),
            notes: update.body.clone(),
        },
    };
    *state.found.lock().expect("состояние обновления повреждено") = found;
    *state.bytes.lock().expect("состояние обновления повреждено") = None;
    Ok(outcome)
}

/// Скачать найденную версию и проверить подпись; ход — в `on_event`.
///
/// Срок у загрузки общий, от запроса до последнего байта: так устроен
/// клиент плагина.
#[tauri::command]
pub async fn download_update(
    state: State<'_, UpdateState>,
    timeout_ms: u64,
    on_event: Channel<DownloadEvent>,
) -> Result<DownloadOutcome, String> {
    // Копия, а не заём: работа уходит в отдельную задачу и забирает всё
    // своё с собой. Замок отпускается в конце этой же строки.
    let mut update = state
        .found
        .lock()
        .expect("состояние обновления повреждено")
        .clone()
        .ok_or("Новая версия не найдена: сначала нужна проверка обновлений.")?;
    update.timeout = Some(Duration::from_millis(timeout_ms));

    let work = async move {
        let mut first = true;
        update
            .download(
                |chunk_length, content_length| {
                    // Письма в окно не ждут ответа; закрытое окно — не повод
                    // бросать загрузку, поэтому ошибка отправки не важна.
                    if first {
                        first = false;
                        let _ = on_event.send(DownloadEvent::Started { content_length });
                    }
                    let _ = on_event.send(DownloadEvent::Progress { chunk_length });
                },
                || {
                    let _ = on_event.send(DownloadEvent::Finished);
                },
            )
            .await
    };

    match cancellable(&state, work).await? {
        None => Ok(DownloadOutcome::Cancelled),
        Some(Ok(bytes)) => {
            *state.bytes.lock().expect("состояние обновления повреждено") = Some(bytes);
            Ok(DownloadOutcome::Ready)
        }
        Some(Err(error)) => Err(error.to_string()),
    }
}

/// Снять идущую проверку или загрузку. Нечего снимать — ничего и не делаем.
#[tauri::command]
pub fn cancel_update(state: State<'_, UpdateState>) {
    let abort = state.abort.lock().expect("состояние обновления повреждено").take();
    if let Some(abort) = abort {
        abort();
    }
}

/// Поставить скачанное. На Windows запускает установщик и завершает процесс:
/// сюда управление уже не вернётся.
#[tauri::command]
pub async fn install_update(state: State<'_, UpdateState>) -> Result<(), String> {
    let update = state
        .found
        .lock()
        .expect("состояние обновления повреждено")
        .clone()
        .ok_or("Новая версия не найдена.")?;
    let bytes = state
        .bytes
        .lock()
        .expect("состояние обновления повреждено")
        .take()
        .ok_or("Пакет не скачан.")?;

    update.install(bytes).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Окно разбирает ход загрузки кодом, написанным под JS-часть плагина.
    /// Вид сообщений обязан остаться тем же — иначе полоска замрёт молча.
    #[test]
    fn download_events_look_like_the_plugin_ones() {
        let started = DownloadEvent::Started { content_length: Some(5) };
        let unknown = DownloadEvent::Started { content_length: None };
        let progress = DownloadEvent::Progress { chunk_length: 7 };

        assert_eq!(
            serde_json::to_value(started).unwrap(),
            json!({ "event": "Started", "data": { "contentLength": 5 } })
        );
        assert_eq!(
            serde_json::to_value(unknown).unwrap(),
            json!({ "event": "Started", "data": { "contentLength": null } })
        );
        assert_eq!(
            serde_json::to_value(progress).unwrap(),
            json!({ "event": "Progress", "data": { "chunkLength": 7 } })
        );
        assert_eq!(
            serde_json::to_value(DownloadEvent::Finished).unwrap(),
            json!({ "event": "Finished" })
        );
    }

    #[test]
    fn outcomes_are_tagged_for_the_window() {
        let found = CheckOutcome::Found { version: "0.15.0".into(), notes: None };
        assert_eq!(
            serde_json::to_value(found).unwrap(),
            json!({ "kind": "found", "version": "0.15.0", "notes": null })
        );
        assert_eq!(
            serde_json::to_value(CheckOutcome::UpToDate).unwrap(),
            json!({ "kind": "upToDate" })
        );
        assert_eq!(serde_json::to_value(DownloadOutcome::Ready).unwrap(), json!("ready"));
        assert_eq!(serde_json::to_value(DownloadOutcome::Cancelled).unwrap(), json!("cancelled"));
    }

    #[test]
    fn finished_work_is_returned() {
        let state = UpdateState::default();
        let result = tauri::async_runtime::block_on(cancellable(&state, async { 42 }));

        assert_eq!(result, Ok(Some(42)));
        assert!(state.abort.lock().unwrap().is_none(), "ручка отмены осталась после конца работы");
    }

    /// Главное свойство: снятая работа действительно снимается, а не
    /// дожидается конца. Работа здесь не кончается никогда — без отмены
    /// тест висел бы вечно.
    #[test]
    fn cancelled_work_stops_and_answers_none() {
        let state = UpdateState::default();

        std::thread::scope(|scope| {
            // Второй поток — это «другая команда»: ждёт, пока появится
            // ручка, и снимает работу.
            scope.spawn(|| loop {
                let abort = state.abort.lock().unwrap().take();
                if let Some(abort) = abort {
                    abort();
                    break;
                }
                std::thread::sleep(Duration::from_millis(1));
            });

            let result = tauri::async_runtime::block_on(cancellable(
                &state,
                std::future::pending::<()>(),
            ));
            assert_eq!(result, Ok(None));
        });
    }
}
