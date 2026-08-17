//! Слежение за корнями через `notify`.
//!
//! Задача: файл, созданный или удалённый в другой программе, должен появиться
//! или исчезнуть в дереве сам. Опрашивать дерево на десятки тысяч файлов
//! нельзя — это и есть тот самый фоновый обход, которого мы избегаем
//! (инвариант 6). Поэтому подписка: на Windows один рекурсивный наблюдатель
//! на корень стоит один дескриптор, а не один обход.
//!
//! Устройство потоков:
//!
//! * `notify` держит свой поток и зовёт оттуда наше замыкание. Работать в нём
//!   нельзя — он общий на все события.
//! * Замыкание только кладёт путь в канал. `mpsc::Sender` можно копировать
//!   и передавать между потоками, поэтому каждому наблюдателю достаётся
//!   своя копия отправителя, а получатель один.
//! * Отдельный поток-сборщик достаёт пути из канала, сглаживает всплеск
//!   и посылает фронтенду одно событие вместо сотни. Без этого распаковка
//!   архива в папке проекта означала бы тысячу перерисовок дерева.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::fsx::atomic_save;
use crate::model::root::RootId;
use crate::project::ignore::IgnoreRules;

/// Событие фронтенду: список папок, содержимое которых могло измениться.
pub const TREE_CHANGED: &str = "tree-changed";

/// Сколько ждать тишины, прежде чем разослать накопленное.
const QUIET: Duration = Duration::from_millis(150);

/// Предел ожидания при непрерывном потоке событий.
///
/// Без него распаковка архива или `npm install` в папке проекта откладывали бы
/// обновление дерева до самого конца работы: тишины не наступает, а окно
/// сдвигается на каждом событии.
const MAX_WINDOW: Duration = Duration::from_millis(1000);

/// Наблюдатели по корням.
///
/// Наблюдатель прекращает работу, когда его уничтожают, — поэтому удаление
/// из этого отображения и есть снятие слежения. Отдельного `unwatch` у нас
/// не будет: одно действие вместо двух согласуемых.
#[derive(Default)]
pub struct Watchers {
    items: HashMap<RootId, RecommendedWatcher>,
    /// Появляется при запуске приложения. До этого момента следить не за чем
    /// и некому: корни восстанавливаются уже после `setup`.
    sender: Option<Sender<PathBuf>>,
}

impl Watchers {
    /// Запустить поток-сборщик. Зовётся один раз, при запуске приложения.
    pub fn start(&mut self, app: AppHandle) {
        let (tx, rx) = std::sync::mpsc::channel();
        self.sender = Some(tx);
        std::thread::spawn(move || collect(app, rx));
    }

    /// Начать следить за корнем. Повторный вызов заменяет наблюдателя.
    pub fn watch(&mut self, id: RootId, path: &Path) {
        let Some(sender) = self.sender.clone() else {
            return;
        };

        // Замыкание уезжает в поток `notify` и живёт там сколько угодно долго,
        // поэтому оно обязано владеть всем, чем пользуется: отсюда `move`
        // и своя копия отправителя.
        let handler = move |event: notify::Result<notify::Event>| {
            let Ok(event) = event else {
                return;
            };
            for path in event.paths {
                let _ = sender.send(path);
            }
        };

        match notify::recommended_watcher(handler) {
            Ok(mut watcher) => {
                if watcher.watch(path, RecursiveMode::Recursive).is_ok() {
                    self.items.insert(id, watcher);
                }
                // Не получилось — молчим: недоступная папка уже помечена
                // недоступной (Р-052), и вторая жалоба про неё ничего
                // не добавит. Появится диск — корень перечитается,
                // и наблюдатель поставится заново.
            }
            Err(_) => {
                // Наблюдателей в системе ограниченное число. Дерево при этом
                // работает, просто не обновляется само.
            }
        }
    }

    pub fn unwatch(&mut self, id: RootId) {
        self.items.remove(&id);
    }

    pub fn is_watching(&self, id: RootId) -> bool {
        self.items.contains_key(&id)
    }

    /// Оставить наблюдение только за перечисленными корнями.
    pub fn retain(&mut self, keep: &[RootId]) {
        self.items.retain(|id, _| keep.contains(id));
    }
}

/// Какую папку перечитывать из-за события по этому пути.
///
/// Всегда родительскую: список, в котором путь виден, — это содержимое его
/// родителя. Для удалённого файла спросить что-либо о нём самом уже нельзя,
/// а родитель есть всегда.
fn affected_dir(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy();
    if atomic_save::is_temp_name(&name) {
        return None;
    }
    path.parent().map(|p| p.to_path_buf())
}

/// Поток-сборщик: копит пути, пока идёт всплеск, и шлёт одно событие.
fn collect(app: AppHandle, rx: Receiver<PathBuf>) {
    loop {
        // Блокирующее ожидание первого события. Ошибка означает, что все
        // отправители уничтожены, то есть приложение закрывается.
        let Ok(first) = rx.recv() else {
            return;
        };

        let mut dirs = BTreeSet::new();
        let started = Instant::now();
        if let Some(dir) = affected_dir(&first) {
            dirs.insert(dir);
        }

        // Добираем всё, что придёт за окном тишины, но не дольше предела.
        while started.elapsed() < MAX_WINDOW {
            match rx.recv_timeout(QUIET) {
                Ok(path) => {
                    if let Some(dir) = affected_dir(&path) {
                        dirs.insert(dir);
                    }
                }
                Err(_) => break,
            }
        }

        if dirs.is_empty() {
            continue;
        }

        // Индекс перечитывает те же папки — но, в отличие от дерева, все,
        // а не только раскрытые: файл, не попавший в индекс, не найдётся
        // никогда, и то, что его сейчас не видно на экране, тут ни при чём.
        reindex(&app, &dirs);

        let payload: Vec<String> = dirs.iter().map(|p| p.display().to_string()).collect();
        // Само событие несёт только имена папок: содержимое фронтенд
        // запрашивает сам и только для раскрытых. Присылать содержимое
        // означало бы слать то, что никто не смотрит.
        let _ = app.emit(TREE_CHANGED, payload);
    }
}

/// Отправить изменившиеся папки на переиндексацию, разложив их по корням.
///
/// Папки группируются по корню-хозяину: правила игнорирования и предел размера
/// у каждого корня свои, и задание должно приехать с настройками того корня,
/// которому папка принадлежит.
fn reindex(app: &AppHandle, dirs: &BTreeSet<PathBuf>) {
    let state = app.state::<crate::state::AppState>();

    // Под блокировкой реестра — только раскладка по корням; на диск отсюда
    // не ходим.
    let mut jobs: HashMap<RootId, (Vec<PathBuf>, Arc<IgnoreRules>, u64)> = HashMap::new();
    {
        let roots = state.roots.lock().expect("реестр корней повреждён");
        for dir in dirs {
            let Some(root) = roots.for_path(dir) else {
                continue;
            };
            jobs.entry(root.id)
                .or_insert_with(|| {
                    (
                        Vec::new(),
                        root.rules.clone(),
                        root.project.index.max_file_size,
                    )
                })
                .0
                .push(dir.clone());
        }
    }

    let index = state.index.lock().expect("индекс повреждён");
    for (root_id, (dirs, rules, max_size)) in jobs {
        index.rescan_dirs(root_id, dirs, rules, max_size);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Событие по файлу перечитывает папку, в которой он лежит.
    #[test]
    fn event_points_at_the_parent_directory() {
        let dir = affected_dir(Path::new(r"C:\заметки\раздел\файл.md"));
        assert_eq!(dir, Some(PathBuf::from(r"C:\заметки\раздел")));
    }

    /// Наш временный файл живёт миллисекунды и перерисовки не стоит.
    #[test]
    fn our_own_temporary_files_are_ignored() {
        let path = Path::new(r"C:\заметки\.файл.md.zeronote-1234-5678.tmp");
        assert_eq!(affected_dir(path), None);
    }
}
