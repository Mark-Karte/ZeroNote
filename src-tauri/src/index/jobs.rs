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

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tauri::{AppHandle, Emitter};

use crate::model::root::RootId;
use crate::project::ignore::IgnoreRules;

use super::scope::{Scope, Scopes};
use super::{query, schema, writer};

/// Как давно корень сверялся с диском, чтобы при возвращении фокуса
/// сверить его снова (задача 140, находка Я15).
///
/// Слежение за папкой теряет события молча: на всплеске — `git checkout`,
/// распаковка архива — буфер `ReadDirectoryChangesW` переполняется, и `notify`
/// не сообщает ни события, ни ошибки, а на неизвестной ошибке снимает
/// наблюдателя, тоже молча. Полный проход сверяет только время и размер,
/// поэтому дёшев; пять минут — чтобы переключение окон не гоняло его зря,
/// а потерянное находилось в пределах перерыва на чай.
pub const CATCH_UP: Duration = Duration::from_secs(5 * 60);

/// Куда сообщать о ходе работы. В приложении — событием окну, в тестах —
/// никуда: рабочему потоку окно не нужно, и проверять очередь без него
/// тоже можно.
type Report = Box<dyn Fn(Progress) + Send>;

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
        /// Не показывать ход работы: догоняющая сверка (Я15) — уборка,
        /// а не работа, о которой человеку нужно знать; строка состояния
        /// мигала бы индексацией на каждом пятиминутном переключении окон.
        quiet: bool,
    },
    /// Перечитать конкретные папки — пришли события файловой системы.
    RescanDirs {
        root_id: RootId,
        dirs: Vec<PathBuf>,
        rules: Arc<IgnoreRules>,
        max_size: u64,
    },
    /// Корень убрали из рабочего пространства.
    ForgetRoot { root_id: RootId },
    /// Забыть записи всех корней, кроме живых: при запуске, когда реестр
    /// восстановлен (Я10).
    KeepOnly { live: Vec<RootId> },
    /// Отметка в очереди: ответить, когда до неё дошло. Нужна тестам,
    /// чтобы дождаться конца работы, а не гадать о нём по времени.
    #[cfg(test)]
    Barrier(Sender<()>),
}

impl Task {
    /// Задание, которое отмена не снимает (Я10).
    ///
    /// Отмена — просьба не тратить время на индексацию, а не на уборку:
    /// снятое «забыть корень» оставляло записи убранной папки в поиске
    /// навсегда. Уборка короткая, и прервать её ради скорости нечем.
    fn survives_cancel(&self) -> bool {
        match self {
            Task::ForgetRoot { .. } | Task::KeepOnly { .. } => true,
            #[cfg(test)]
            Task::Barrier(_) => true,
            Task::ScanRoot { .. } | Task::RescanDirs { .. } => false,
        }
    }
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
    /// Убранные корни (Я10): их идущий проход прерывается, а стоящие
    /// в очереди задания не берутся — иначе проход дописал бы записи
    /// корня уже после того, как их забыли. Новый проход корня снимает
    /// с него пометку: корень вернули.
    gone: Arc<Mutex<HashSet<RootId>>>,
    /// Когда корень последний раз ставился на полный проход (Я15).
    scanned: HashMap<RootId, Instant>,
}

impl Index {
    /// Открыть базу и запустить рабочий поток. Зовётся один раз при старте.
    ///
    /// Ошибку открытия не превращаем в панику: без индекса приложение
    /// работает, просто не ищет по проекту. Молча — нельзя, поэтому вызов
    /// возвращает сообщение для полосы предупреждений.
    pub fn start(&mut self, app: AppHandle, data_dir: &Path) -> Result<(), String> {
        self.start_with(
            data_dir,
            Box::new(move |value| {
                let _ = app.emit(INDEX_PROGRESS, value);
            }),
        )
    }

    /// То же для тестов: ход работы никуда не сообщается.
    #[cfg(test)]
    pub fn start_for_tests(&mut self, data_dir: &Path) {
        self.start_with(data_dir, Box::new(|_| {})).expect("индекс для теста");
    }

    fn start_with(&mut self, data_dir: &Path, report: Report) -> Result<(), String> {
        let connection = schema::open(&schema::index_path(data_dir))
            .map_err(|e| format!("индекс недоступен, поиск по проекту не работает: {e}"))?;

        let connection = Arc::new(Mutex::new(connection));
        let (tx, rx) = std::sync::mpsc::channel();

        self.connection = Some(connection.clone());
        self.sender = Some(tx);

        let shared = Shared {
            generation: self.generation.clone(),
            progress: self.progress.clone(),
            gone: self.gone.clone(),
            report,
        };
        std::thread::spawn(move || work(connection, rx, shared));
        Ok(())
    }

    /// Дождаться, пока очередь дойдёт до этого места.
    #[cfg(test)]
    pub fn wait_idle(&self) {
        let (tx, rx) = std::sync::mpsc::channel();
        self.submit(Task::Barrier(tx));
        let _ = rx.recv_timeout(Duration::from_secs(30));
    }

    /// Отодвинуть время последнего прохода — проверить догоняющий без
    /// пяти минут ожидания.
    #[cfg(test)]
    pub fn backdate_scan(&mut self, root_id: RootId, by: Duration) {
        if let Some(at) = self.scanned.get_mut(&root_id)
            && let Some(earlier) = at.checked_sub(by)
        {
            *at = earlier;
        }
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
        &mut self,
        root_id: RootId,
        path: PathBuf,
        rules: Arc<IgnoreRules>,
        max_size: u64,
        quiet: bool,
    ) {
        // Проход корня, который забывали, — корень вернули. В приложении
        // номер не переиспользуется, а замерочный стенд берёт один и тот же.
        self.gone.lock().expect("индекс повреждён").remove(&root_id);
        self.scanned.insert(root_id, Instant::now());
        self.submit(Task::ScanRoot {
            root_id,
            path,
            rules,
            max_size,
            quiet,
        });
    }

    /// Пора ли сверить корень с диском заново (Я15): полного прохода
    /// не было дольше `CATCH_UP`. Корень, которого индекс ещё не видел,
    /// тоже пора.
    pub fn needs_catch_up(&self, root_id: RootId) -> bool {
        self.scanned
            .get(&root_id)
            .is_none_or(|at| at.elapsed() >= CATCH_UP)
    }

    pub fn rescan_dirs(
        &self,
        root_id: RootId,
        dirs: Vec<PathBuf>,
        rules: Arc<IgnoreRules>,
        max_size: u64,
    ) {
        if dirs.is_empty() {
            return;
        }
        self.submit(Task::RescanDirs {
            root_id,
            dirs,
            rules,
            max_size,
        });
    }

    /// Внести в индекс файлы, созданные только что, — сразу, в этом потоке
    /// (задачи 146 и 147).
    ///
    /// Ссылку на вставленную картинку или брошенный файл вписывают в тот же
    /// миг, и превью спрашивает индекс раньше, чем слежение (`tree/watch.rs`)
    /// успеет его известить: картинка показывалась «нет» и такой оставалась.
    /// Слежение потом увидит те же файлы и пропустит их — время и размер
    /// совпадут. Ошибка — не беда: файл догонит обычный путь.
    pub fn index_now(&self, root_id: RootId, paths: &[PathBuf], max_size: u64) {
        let Some(connection) = self.connection.as_ref() else {
            return;
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        for path in paths {
            let _ = super::writer::index_file(&connection, root_id, path, max_size);
        }
    }

    /// Забыть убранный корень (Я10). Его идущий проход прерывается сразу,
    /// а само забывание отмена не снимает.
    pub fn forget_root(&mut self, root_id: RootId) {
        self.gone.lock().expect("индекс повреждён").insert(root_id);
        self.scanned.remove(&root_id);
        self.submit(Task::ForgetRoot { root_id });
    }

    /// Забыть записи корней, которых нет в реестре (Я10). Зовётся при
    /// запуске: забывание убранного корня могло не дойти до базы, если
    /// приложение закрыли раньше.
    pub fn keep_only(&self, live: Vec<RootId>) {
        self.submit(Task::KeepOnly { live });
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
        scope: Option<&Scope>,
        limit: u32,
    ) -> Result<Vec<query::Hit>, String> {
        let Some(connection) = &self.connection else {
            return Ok(Vec::new());
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        query::search(&connection, input, scope, limit).map_err(|e| e.to_string())
    }

    /// Куда ведёт `[[ссылка]]` из этого файла. `None` — ссылка висячая.
    /// `scope` — область самого глубокого корня ссылающегося файла.
    pub fn resolve_link(
        &self,
        target: &str,
        from: &str,
        scope: &Scope,
    ) -> Option<super::graph::Resolved> {
        let connection = self.connection.as_ref()?;
        let connection = connection.lock().expect("соединение с индексом повреждено");
        super::graph::resolve(&connection, target, from, scope)
            .ok()
            .flatten()
    }

    /// Какие ссылки придётся поправить, если переименовать это (Р-137).
    ///
    /// Соединение берётся изменяемым: внутри идёт откатываемая транзакция.
    /// Мьютекс держится всё это время — тем и обеспечивается, что подмены
    /// путей не увидит никто, включая индексацию в фоне.
    pub fn rename_plan(
        &self,
        scopes: &Scopes,
        from: &str,
        to: &str,
        hint: Option<crate::text::encoding::Encoding>,
    ) -> Option<super::rename::RenamePlan> {
        let connection = self.connection.as_ref()?;
        let mut connection = connection.lock().expect("соединение с индексом повреждено");
        super::rename::plan(&mut connection, scopes, from, to, hint).ok()
    }

    /// Каким текстом сослаться на этот файл из того (Р-134).
    pub fn link_text(
        &self,
        path: &str,
        from: &str,
        scope: &Scope,
        relative: &str,
    ) -> Option<String> {
        let connection = self.connection.as_ref()?;
        let connection = connection.lock().expect("соединение с индексом повреждено");
        super::graph::link_text(&connection, path, from, scope, relative).ok()
    }

    /// Кто ссылается на этот файл.
    pub fn backlinks(&self, path: &str, scopes: &Scopes) -> Vec<super::graph::Backlink> {
        let Some(connection) = &self.connection else {
            return Vec::new();
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        super::graph::backlinks(&connection, path, scopes).unwrap_or_default()
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

    /// Все файлы индекса, включая те, у которых прочитано только имя
    /// (задача 82). Нужно быстрому открытию и подсказке имён.
    pub fn files(&self) -> Vec<writer::FileRow> {
        let Some(connection) = &self.connection else {
            return Vec::new();
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        writer::all_files(&connection).unwrap_or_default()
    }

    /// Только те файлы, содержимое которых прочитано. Нужно подсказке
    /// имён при `[[`: ссылка на вложение — задача 83.
    pub fn text_files(&self) -> Vec<writer::FileRow> {
        let Some(connection) = &self.connection else {
            return Vec::new();
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        writer::text_files(&connection).unwrap_or_default()
    }

    /// Сколько файлов корня лежит в индексе — всё под его папкой. Нужно
    /// строке состояния.
    pub fn count(&self, scope: &Scope) -> u64 {
        let Some(connection) = &self.connection else {
            return 0;
        };
        let connection = connection.lock().expect("соединение с индексом повреждено");
        writer::count_under(&connection, scope).unwrap_or(0)
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

/// Записать партию файлов. Возвращает `false`, если работу отменили
/// или корень убрали.
fn write_batch(
    connection: &Mutex<Connection>,
    root_id: RootId,
    paths: &[PathBuf],
    max_size: u64,
    should_stop: &dyn Fn() -> bool,
) -> bool {
    let db = connection.lock().expect("соединение с индексом повреждено");

    // `unchecked_transaction` берёт сделку по общей ссылке — обычная требует
    // `&mut`, а соединение у нас за блокировкой и раздаётся по ссылке.
    let Ok(transaction) = db.unchecked_transaction() else {
        return true;
    };

    for path in paths {
        if should_stop() {
            // Незаконченную партию не сохраняем: недописанное состояние хуже
            // отсутствующего, потому что выглядит завершённым.
            return false;
        }
        // Ошибка на отдельном файле — не повод бросать всю индексацию:
        // файл могли удалить прямо сейчас или закрыть к нему доступ.
        let _ = writer::index_file(&db, root_id, path, max_size);
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
    let seen: HashSet<String> = seen
        .iter()
        .map(|p| p.to_string_lossy().to_lowercase())
        .collect();

    for path in known {
        if !seen.contains(&path.to_lowercase()) {
            let _ = writer::forget_file(&db, Path::new(&path));
        }
    }
}

/// Что рабочий поток делит с `Index`.
///
/// Всё в `Arc`: поток живёт отдельно от `Index` и обязан владеть тем,
/// чем пользуется, а `Index` в это время продолжает ставить задания,
/// отменять и спрашивать о ходе работы.
struct Shared {
    generation: Arc<AtomicU64>,
    progress: Arc<Mutex<Progress>>,
    gone: Arc<Mutex<HashSet<RootId>>>,
    report: Report,
}

impl Shared {
    fn publish(&self, value: Progress) {
        *self.progress.lock().expect("состояние индекса повреждено") = value;
        (self.report)(value);
    }

    /// Задание больше не нужно: его отменили или убрали его корень.
    fn stale(&self, mine: u64, root_id: RootId) -> bool {
        self.generation.load(Ordering::SeqCst) != mine
            || self.gone.lock().expect("индекс повреждён").contains(&root_id)
    }
}

fn work(connection: Arc<Mutex<Connection>>, rx: Receiver<Job>, shared: Shared) {
    const RUNNING: Progress = Progress {
        running: true,
        done: 0,
        total: 0,
    };

    // Ошибка получения означает, что отправители уничтожены: приложение
    // закрывается.
    while let Ok(job) = rx.recv() {
        let mine = job.generation;
        if !job.task.survives_cancel() && shared.generation.load(Ordering::SeqCst) != mine {
            // Задание из отменённого поколения. Именно ради этого случая
            // отмена — счётчик, а не флаг.
            continue;
        }

        match job.task {
            Task::ForgetRoot { root_id } => {
                let db = connection.lock().expect("соединение с индексом повреждено");
                let _ = writer::forget_root(&db, root_id);
            }

            Task::KeepOnly { live } => {
                let db = connection.lock().expect("соединение с индексом повреждено");
                let _ = writer::forget_roots_except(&db, &live);
            }

            #[cfg(test)]
            Task::Barrier(done) => {
                let _ = done.send(());
            }

            Task::ScanRoot {
                root_id,
                path,
                rules,
                max_size,
                quiet,
            } => {
                if shared.stale(mine, root_id) {
                    continue;
                }
                // Тихий проход хода работы не показывает вовсе — ни начала,
                // ни шагов, ни конца.
                let publish = |value: Progress| {
                    if !quiet {
                        shared.publish(value);
                    }
                };
                publish(RUNNING);

                let stale = || shared.stale(mine, root_id);
                let Some(files) = collect_files(&path, &rules, &stale) else {
                    publish(Progress::default());
                    continue;
                };

                let total = files.len() as u64;
                let mut done = 0u64;
                let mut last_report = Instant::now();
                let mut cancelled = false;

                for chunk in files.chunks(BATCH) {
                    if !write_batch(&connection, root_id, chunk, max_size, &stale) {
                        cancelled = true;
                        break;
                    }

                    done += chunk.len() as u64;
                    if last_report.elapsed() >= PROGRESS_INTERVAL {
                        last_report = Instant::now();
                        publish(Progress {
                            running: true,
                            done,
                            total,
                        });
                    }
                }

                if !cancelled {
                    forget_missing(&connection, root_id, &files);
                }
                publish(Progress::default());
            }

            Task::RescanDirs {
                root_id,
                dirs,
                rules,
                max_size,
            } => {
                if shared.stale(mine, root_id) {
                    continue;
                }
                shared.publish(RUNNING);

                let stale = || shared.stale(mine, root_id);
                for dir in dirs {
                    if stale() {
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

                    write_batch(&connection, root_id, &files, max_size, &stale);
                    forget_missing_in_dir(&connection, root_id, &dir, &files);
                }

                shared.publish(Progress::default());
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{IgnoreSettings, ignore};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-jobs-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Папка с заметками и индекс на отдельной папке данных — чтобы файл
    /// базы не попал в обход.
    fn setup(tag: &str, files: usize) -> (PathBuf, PathBuf, Index) {
        let root = temp_dir(&format!("{tag}-root"));
        for i in 0..files {
            std::fs::write(root.join(format!("заметка-{i}.md")), "текст").unwrap();
        }
        let data = temp_dir(&format!("{tag}-data"));
        let mut index = Index::default();
        index.start_for_tests(&data);
        (root, data, index)
    }

    fn scan(index: &mut Index, id: RootId, root: &Path) {
        let rules = Arc::new(ignore::build(root, &IgnoreSettings::default()));
        index.scan_root(id, root.to_path_buf(), rules, 2 * 1024 * 1024, false);
    }

    /// Отмена не снимает забывание убранного корня (Я10): иначе записи
    /// папки оставались в быстром открытии и поиске навсегда.
    #[test]
    fn forgetting_a_root_survives_cancel() {
        let (root, data, mut index) = setup("forget-cancel", 3);
        scan(&mut index, 5, &root);
        index.wait_idle();
        let scope = Scope::new(5, &root);
        assert_eq!(index.count(&scope), 3);

        index.forget_root(5);
        index.cancel();
        index.wait_idle();

        assert_eq!(index.count(&scope), 0, "записи убранного корня остались");
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&data);
    }

    /// Файл, на который ссылку вписали только что (задачи 146 и 147),
    /// находится по имени сразу — без прохода и без слежения: иначе превью
    /// спрашивало индекс раньше и оставляло картинку «нет» (Р-310).
    #[test]
    fn index_now_makes_a_new_file_resolvable_at_once() {
        let (root, data, mut index) = setup("index-now", 1);
        scan(&mut index, 8, &root);
        index.wait_idle();
        let note = root.join("заметка-0.md").to_string_lossy().into_owned();
        let scope = Scope::new(8, &root);

        let picture = root.join("Pasted image 20260928143012.png");
        std::fs::write(&picture, b"png").unwrap();
        assert!(index.resolve_link("Pasted image 20260928143012.png", &note, &scope).is_none());

        index.index_now(8, std::slice::from_ref(&picture), 2 * 1024 * 1024);

        let found = index
            .resolve_link("Pasted image 20260928143012.png", &note, &scope)
            .expect("свежий файл обязан находиться по имени");
        assert_eq!(found.path, picture.to_string_lossy());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&data);
    }

    /// Проход убранного корня, стоявший в очереди, записей не дописывает.
    #[test]
    fn scan_of_a_removed_root_writes_nothing() {
        let (root, data, mut index) = setup("forget-queued", 50);
        scan(&mut index, 6, &root);
        index.forget_root(6);
        index.wait_idle();

        assert_eq!(index.count(&Scope::new(6, &root)), 0);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&data);
    }

    /// При запуске записи корней, которых нет в реестре, уходят (Я10):
    /// забывание могло не дойти до базы до закрытия приложения.
    #[test]
    fn keep_only_forgets_roots_missing_from_the_registry() {
        let (root, data, mut index) = setup("keep-only", 2);
        scan(&mut index, 7, &root);
        index.wait_idle();

        index.keep_only(vec![1, 2]);
        index.wait_idle();

        assert_eq!(index.count(&Scope::new(7, &root)), 0);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&data);
    }

    /// Догоняющий проход (Я15): корень, сверенный только что, ждёт; сверенный
    /// давно или ни разу — пора.
    #[test]
    fn catch_up_is_due_after_the_interval() {
        let (root, data, mut index) = setup("catch-up", 1);
        assert!(index.needs_catch_up(8), "корень без прохода — пора");

        scan(&mut index, 8, &root);
        assert!(!index.needs_catch_up(8), "только что сверенный — не пора");

        index.backdate_scan(8, CATCH_UP);
        assert!(index.needs_catch_up(8));
        index.wait_idle();
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&data);
    }
}
