//! Фоновая индексация: очередь заданий, отмена, ход работы.
//!
//! Это первое место в приложении, где тяжёлая работа идёт по-настоящему долго,
//! и потому первая настоящая проверка инварианта 6: ввод пользователя не должен
//! её ждать ни секунды.
//!
//! Устройство:
//!
//! * Задания уходят в канал и исполняются одним рабочим потоком по очереди.
//!   Второй поток не ускорил бы ничего: упирается всё в диск, а не в счёт.
//! * Отмена — номер поколения, а не флаг. Флага хватило бы, чтобы прервать
//!   текущее задание, но не чтобы выбросить те, что уже стоят в очереди:
//!   пришлось бы вычерпывать канал руками. Задание помнит номер поколения,
//!   с которым его поставили, и устаревшее просто не берётся в работу.
//! * Соединение с базой — одно, под блокировкой. Индексация берёт её
//!   короткими партиями и отпускает: иначе поиск ждал бы конца индексации,
//!   то есть ровно того, ради чего он и нужен.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tauri::{AppHandle, Emitter};

use crate::model::root::RootId;
use crate::project::ignore::IgnoreRules;

use super::{query, schema, writer};

/// Событие фронтенду: ход индексации.
pub const INDEX_PROGRESS: &str = "index-progress";

/// Сколько файлов пишется в одной сделке.
///
/// Сделка на файл означала бы сброс на диск на каждый файл — на десяти тысячах
/// это минуты. Сделка на всё — блокировку базы на всё время индексации.
const BATCH: usize = 100;

/// Как часто сообщать о ходе работы. Чаще — бессмысленно: глаз не различает,
/// а событий получается тысячи.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(120);

/// Ход работы, каким его видит интерфейс.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub running: bool,
    pub done: u64,
    pub total: u64,
}

enum Task {
    /// Полный проход по корню: сверка с диском и дозапись изменившегося.
    ScanRoot {
        root_id: RootId,
        path: PathBuf,
        rules: Arc<IgnoreRules>,
        max_size: u64,
    },
    /// Перечитать конкретные папки — пришли события файловой системы.
    RescanDirs {
        root_id: RootId,
        /// Путь корня: по нему считается путь внутри проекта, а по нему
        /// разрешаются `[[ссылки]]`.
        root_path: PathBuf,
        dirs: Vec<PathBuf>,
        rules: Arc<IgnoreRules>,
        max_size: u64,
    },
    /// Корень убрали из рабочего пространства.
    ForgetRoot { root_id: RootId },
}

struct Job {
    task: Task,
    /// Поколение, в котором задание поставили. Отмена увеличивает счётчик,
    /// и все задания прошлых поколений становятся неактуальными.
    generation: u64,
}

/// Индекс: соединение, очередь и состояние.
#[derive(Default)]
pub struct Index {
    connection: Option<Arc<Mutex<Connection>>>,
    sender: Option<Sender<Job>>,
    generation: Arc<AtomicU64>,
    progress: Arc<Mutex<Progress>>,
}

impl Index {
    /// Открыть базу и запустить рабочий поток. Зовётся один раз при старте.
    ///
    /// Ошибку открытия не превращаем в панику: без индекса приложение
    /// работает, просто не ищет по проекту. Молча — нельзя, поэтому вызов
    /// возвращает сообщение для полосы предупреждений.
    pub fn start(&mut self, app: AppHandle, data_dir: &Path) -> Result<(), String> {
        let connection = schema::open(&schema::index_path(data_dir))
            .map_err(|e| format!("индекс недоступен, поиск по проекту не работает: {e}"))?;

        let connection = Arc::new(Mutex::new(connection));
        let (tx, rx) = std::sync::mpsc::channel();

        self.connection = Some(connection.clone());
        self.sender = Some(tx);

        let generation = self.generation.clone();
        let progress = self.progress.clone();
        std::thread::spawn(move || work(app, connection, rx, generation, progress));
        Ok(())
    }

    fn submit(&self, task: Task) {
        let Some(sender) = &self.sender else {
            return;
        };
        let job = Job {
            task,
            generation: self.generation.load(Ordering::SeqCst),
        };
        // Ошибка отправки означает, что рабочий поток закончился, — приложение
        // закрывается, и жаловаться некому.
        let _ = sender.send(job);
    }

    pub fn scan_root(
        &self,
        root_id: RootId,
        path: PathBuf,
        rules: Arc<IgnoreRules>,
        max_size: u64,
    ) {
        self.submit(Task::ScanRoot {
            root_id,
            path,
            rules,
            max_size,
        });
    }

    pub fn rescan_dirs(
        &self,
        root_id: RootId,
        root_path: PathBuf,
        dirs: Vec<PathBuf>,
        rules: Arc<IgnoreRules>,
        max_size: u64,
    ) {
        if dirs.is_empty() {
            return;
        }
        self.submit(Task::RescanDirs {
            root_id,
            root_path,
            dirs,
            rules,
            max_size,
        });
    }

    pub fn forget_root(&self, root_id: RootId) {
        self.submit(Task::ForgetRoot { root_id });
    }

    /// Отменить всё, что идёт и что стоит в очереди.
    pub fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    pub fn progress(&self) -> Progress {
        *self.progress.lock().expect("состояние индекса повреждено")
    }

    /// Поиск по индексу. Идёт в потоке команды, а не в рабочем: запрос —
    /// это миллисекунды, и гонять его через очередь незачем.
    pub fn search(
        &self,
        input: &str,
        root_id: Option<RootId>,
        limit: u32,
    ) -> Result<Vec<query::Hit>, String> {
        let Some(connection) = &self.connection else {
            return Ok(Vec::new());
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        query::search(&connection, input, root_id, limit).map_err(|e| e.to_string())
    }

    /// Куда ведёт `[[ссылка]]` из этого файла. `None` — ссылка висячая.
    pub fn resolve_link(
        &self,
        target: &str,
        from: &str,
        root_id: RootId,
    ) -> Option<super::graph::Resolved> {
        let connection = self.connection.as_ref()?;
        let connection = connection.lock().expect("соединение с индексом повреждено");
        super::graph::resolve(&connection, target, from, root_id)
            .ok()
            .flatten()
    }

    /// Кто ссылается на этот файл.
    pub fn backlinks(&self, path: &str) -> Vec<super::graph::Backlink> {
        let Some(connection) = &self.connection else {
            return Vec::new();
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        super::graph::backlinks(&connection, path).unwrap_or_default()
    }

    /// Файлы, помеченные тегом.
    pub fn files_with_tag(&self, tag: &str, limit: u32) -> Vec<super::graph::Tagged> {
        let Some(connection) = &self.connection else {
            return Vec::new();
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        super::graph::files_with_tag(&connection, tag, limit).unwrap_or_default()
    }

    /// Теги проекта, подходящие под запрос. Нужно палитре в режиме `#`.
    pub fn find_tags(&self, query: &str, limit: u32) -> Vec<super::graph::TagHit> {
        let Some(connection) = &self.connection else {
            return Vec::new();
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        super::graph::find_tags(&connection, query, limit).unwrap_or_default()
    }

    /// Все файлы индекса: номер корня, путь, имя. Нужно быстрому открытию.
    pub fn files(&self) -> Vec<(RootId, String, String)> {
        let Some(connection) = &self.connection else {
            return Vec::new();
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        writer::all_files(&connection).unwrap_or_default()
    }

    /// Сколько файлов корня лежит в индексе. Нужно строке состояния.
    pub fn count(&self, root_id: RootId) -> u64 {
        let Some(connection) = &self.connection else {
            return 0;
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        writer::count(&connection, root_id).unwrap_or(0)
    }
}

/// Собрать пути всех файлов корня, учитывая правила игнорирования.
///
/// Это тот самый полный обход, которого нет у дерева (Р-054). Индексу он
/// нужен по-настоящему: файл, не попавший в обход, не найдётся никогда.
///
/// `should_stop` зовётся между папками — обход хранилища на сто тысяч файлов
/// обязан прерываться сразу, а не после окончания. `None` означает «прервали».
pub fn collect_files(
    root: &Path,
    rules: &IgnoreRules,
    should_stop: &dyn Fn() -> bool,
) -> Option<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        if should_stop() {
            return None;
        }

        let Ok(entries) = crate::tree::read_children(&dir, rules) else {
            continue;
        };

        for entry in entries {
            if entry.is_link {
                // Внутрь ссылки не идём: петля `ссылка → предок` бесконечна.
                continue;
            }
            if entry.is_dir {
                stack.push(entry.path);
            } else {
                files.push(entry.path);
            }
        }
    }

    Some(files)
}

/// Записать партию файлов. Возвращает `false`, если работу отменили.
fn write_batch(
    connection: &Mutex<Connection>,
    root_id: RootId,
    root_path: &Path,
    paths: &[PathBuf],
    max_size: u64,
    generation: &AtomicU64,
    mine: u64,
) -> bool {
    let db = connection.lock().expect("соединение с индексом повреждено");

    // `unchecked_transaction` берёт сделку по общей ссылке — обычная требует
    // `&mut`, а соединение у нас за блокировкой и раздаётся по ссылке.
    let Ok(transaction) = db.unchecked_transaction() else {
        return true;
    };

    for path in paths {
        if generation.load(Ordering::SeqCst) != mine {
            // Незаконченную партию не сохраняем: недописанное состояние хуже
            // отсутствующего, потому что выглядит завершённым.
            return false;
        }
        // Ошибка на отдельном файле — не повод бросать всю индексацию:
        // файл могли удалить прямо сейчас или закрыть к нему доступ.
        let _ = writer::index_file(&db, root_id, &root_path, path, max_size);
    }

    let _ = transaction.commit();
    true
}

/// Убрать из индекса записи о файлах, которых больше нет на диске.
fn forget_missing(connection: &Mutex<Connection>, root_id: RootId, seen: &[PathBuf]) {
    let db = connection.lock().expect("соединение с индексом повреждено");

    let Ok(known) = writer::known_paths(&db, root_id) else {
        return;
    };

    // Сравниваем по строкам, приведённым к нижнему регистру: Windows не
    // различает регистр путей, а в базу путь мог попасть в любом.
    let seen: std::collections::HashSet<String> = seen
        .iter()
        .map(|p| p.to_string_lossy().to_lowercase())
        .collect();

    for path in known {
        if !seen.contains(&path.to_lowercase()) {
            let _ = writer::forget_file(&db, Path::new(&path));
        }
    }
}

fn publish(app: &AppHandle, progress: &Mutex<Progress>, value: Progress) {
    *progress.lock().expect("состояние индекса повреждено") = value;
    let _ = app.emit(INDEX_PROGRESS, value);
}

fn work(
    app: AppHandle,
    connection: Arc<Mutex<Connection>>,
    rx: Receiver<Job>,
    generation: Arc<AtomicU64>,
    progress: Arc<Mutex<Progress>>,
) {
    // Ошибка получения означает, что отправители уничтожены: приложение
    // закрывается.
    while let Ok(job) = rx.recv() {
        let mine = job.generation;
        if generation.load(Ordering::SeqCst) != mine {
            // Задание из отменённого поколения. Именно ради этого случая
            // отмена — счётчик, а не флаг.
            continue;
        }

        match job.task {
            Task::ForgetRoot { root_id } => {
                let db = connection.lock().expect("соединение с индексом повреждено");
                let _ = writer::forget_root(&db, root_id);
            }

            Task::ScanRoot {
                root_id,
                path,
                rules,
                max_size,
            } => {
                publish(
                    &app,
                    &progress,
                    Progress {
                        running: true,
                        done: 0,
                        total: 0,
                    },
                );

                let stale = || generation.load(Ordering::SeqCst) != mine;
                let Some(files) = collect_files(&path, &rules, &stale) else {
                    publish(&app, &progress, Progress::default());
                    continue;
                };

                let total = files.len() as u64;
                let mut done = 0u64;
                let mut last_report = Instant::now();
                let mut cancelled = false;

                for chunk in files.chunks(BATCH) {
                    if !write_batch(
                        &connection,
                        root_id,
                        &path,
                        chunk,
                        max_size,
                        &generation,
                        mine,
                    ) {
                        cancelled = true;
                        break;
                    }

                    done += chunk.len() as u64;
                    if last_report.elapsed() >= PROGRESS_INTERVAL {
                        last_report = Instant::now();
                        publish(
                            &app,
                            &progress,
                            Progress {
                                running: true,
                                done,
                                total,
                            },
                        );
                    }
                }

                if !cancelled {
                    forget_missing(&connection, root_id, &files);
                }
                publish(&app, &progress, Progress::default());
            }

            Task::RescanDirs {
                root_id,
                root_path,
                dirs,
                rules,
                max_size,
            } => {
                publish(
                    &app,
                    &progress,
                    Progress {
                        running: true,
                        done: 0,
                        total: 0,
                    },
                );

                for dir in dirs {
                    if generation.load(Ordering::SeqCst) != mine {
                        break;
                    }

                    let Ok(entries) = crate::tree::read_children(&dir, &rules) else {
                        // Папку удалили целиком — уберём её файлы из индекса.
                        forget_under(&connection, root_id, &dir);
                        continue;
                    };

                    let files: Vec<PathBuf> = entries
                        .into_iter()
                        .filter(|e| !e.is_dir && !e.is_link)
                        .map(|e| e.path)
                        .collect();

                    write_batch(
                        &connection,
                        root_id,
                        &root_path,
                        &files,
                        max_size,
                        &generation,
                        mine,
                    );
                    forget_missing_in_dir(&connection, root_id, &dir, &files);
                }

                publish(&app, &progress, Progress::default());
            }
        }
    }
}

/// Убрать из индекса всё, что лежало внутри исчезнувшей папки.
fn forget_under(connection: &Mutex<Connection>, root_id: RootId, dir: &Path) {
    let db = connection.lock().expect("соединение с индексом повреждено");
    let Ok(known) = writer::known_paths(&db, root_id) else {
        return;
    };

    let prefix = format!("{}\\", dir.to_string_lossy().to_lowercase());
    for path in known {
        if path.to_lowercase().starts_with(&prefix) {
            let _ = writer::forget_file(&db, Path::new(&path));
        }
    }
}

/// Убрать записи о файлах, исчезнувших из конкретной папки.
///
/// Сравнение только по прямому содержимому папки: вложенные папки перечитает
/// своё событие, а трогать их отсюда значило бы вычистить то, чего мы сейчас
/// не смотрели.
fn forget_missing_in_dir(
    connection: &Mutex<Connection>,
    root_id: RootId,
    dir: &Path,
    seen: &[PathBuf],
) {
    let db = connection.lock().expect("соединение с индексом повреждено");
    let Ok(known) = writer::known_paths(&db, root_id) else {
        return;
    };

    let prefix = format!("{}\\", dir.to_string_lossy().to_lowercase());
    let seen: std::collections::HashSet<String> = seen
        .iter()
        .map(|p| p.to_string_lossy().to_lowercase())
        .collect();

    for path in known {
        let lower = path.to_lowercase();
        let Some(tail) = lower.strip_prefix(&prefix) else {
            continue;
        };
        // Только прямые дети: во вложенные папки мы сейчас не заглядывали.
        if tail.contains('\\') {
            continue;
        }
        if !seen.contains(&lower) {
            let _ = writer::forget_file(&db, Path::new(&path));
        }
    }
}
