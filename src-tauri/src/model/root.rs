//! Корни рабочего пространства — папки, открытые как проекты.
//!
//! Корень знает свой путь, своё имя, свой файл проекта (`zeronote.toml`)
//! и свои правила игнорирования. Содержимого папки здесь нет: обход дерева
//! и индекс — задачи 10 и 11.
//!
//! Устройство повторяет реестр буферов намеренно: тот же способ выдачи
//! номеров, то же восстановление счётчиков из сессии, тот же вид у команд.
//! Два похожих реестра, устроенных по-разному, — лишняя работа для памяти.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::project::ignore::{self, IgnoreRules};
use crate::project::{self, Project};

pub type RootId = u64;

/// Привести путь к тому виду, в котором его можно сравнивать и хранить.
///
/// `canonicalize` разворачивает `..`, короткие имена вида `PROGRA~1` и связи,
/// но возвращает путь в «дословном» виде `\\?\C:\...`. Показывать такое
/// пользователю и класть в файл сессии не стоит, поэтому приставку снимаем —
/// но только у обычных дисковых путей: у сетевых (`\\?\UNC\...`) она несёт
/// смысл, и снятие сломало бы путь.
///
/// Путь, которого нет на диске, остаётся как есть: несуществующую папку
/// разворачивать не в чем, а отказываться от неё нельзя (Р-052).
pub fn normalize(path: &Path) -> PathBuf {
    let Ok(full) = std::fs::canonicalize(path) else {
        return path.to_path_buf();
    };

    let text = full.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        // `C:\...` — второй знак двоеточие. Так отличается дисковый путь
        // от `UNC\сервер\ресурс`.
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => full.clone(),
    }
}

/// Один ли это путь. Windows не различает регистр в именах файлов, и `C:\Заметки`
/// с `c:\заметки` — одна и та же папка. Сравнение по байтам добавило бы её
/// вторым корнем.
pub fn same_path(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// Лежит ли путь внутри корня (или равен ему).
fn inside(root: &Path, path: &Path) -> bool {
    let root_text = root.to_string_lossy().to_lowercase();
    let path_text = path.to_string_lossy().to_lowercase();

    if path_text == root_text {
        return true;
    }

    // Разделитель обязателен: иначе `C:\проект-2` попал бы внутрь `C:\проект`.
    let with_sep = if root_text.ends_with('\\') || root_text.ends_with('/') {
        root_text
    } else {
        format!("{root_text}\\")
    };
    path_text.starts_with(&with_sep)
}

/// Корень рабочего пространства.
///
/// Без `serde`: наружу корень отдаётся отдельным видом в `commands/roots.rs`.
/// Половина полей — правила игнорирования и разобранный файл проекта — нужна
/// ядру и бессмысленна фронтенду, а структура, у которой половина полей помечена
/// «не сериализовать», рано или поздно уедет наружу целиком по недосмотру.
pub struct Root {
    pub id: RootId,
    pub path: PathBuf,
    /// Что показывать в панели: имя из файла проекта либо имя папки.
    pub name: String,
    /// В папке есть `zeronote.toml`.
    pub has_project_file: bool,
    /// В папке есть `.obsidian`.
    ///
    /// Это факт о папке, а не «режим Obsidian»: режима нет и не будет
    /// (Р-022). Нужен ровно для одного — предложить один раз перенести
    /// настройки в наш файл проекта.
    pub has_obsidian_config: bool,
    /// Папка сейчас читается. `false` — например, отключён сетевой диск;
    /// корень при этом остаётся в списке (Р-052).
    pub available: bool,
    /// Что не так с файлом проекта или его правилами. Едет пользователю
    /// полосой предупреждений, а не в лог.
    pub problems: Vec<String>,
    pub project: Project,
    /// Правила в общем владении.
    ///
    /// `Arc` здесь не украшение: чтение папки лезет на диск, а держать при
    /// этом блокировку реестра корней нельзя — медленный сетевой диск
    /// заморозил бы все остальные команды. Поэтому под блокировкой берётся
    /// дешёвая копия указателя, блокировка отпускается, и папка читается уже
    /// без неё. Само правило при этом не копируется.
    pub rules: Arc<IgnoreRules>,
}

impl std::fmt::Debug for Root {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Root")
            .field("id", &self.id)
            .field("path", &self.path)
            .field("name", &self.name)
            .field("available", &self.available)
            .finish()
    }
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        // У корня диска имени файла нет — показываем путь целиком.
        .unwrap_or_else(|| path.display().to_string())
}

impl Root {
    /// Прочитать состояние корня с диска: файл проекта, правила, доступность.
    ///
    /// Дешёвая операция: читается один небольшой файл, содержимое папки
    /// не обходится.
    pub fn load(id: RootId, path: PathBuf) -> Root {
        let available = path.is_dir();
        let loaded = project::load(&path);
        let rules = ignore::build(&path, &loaded.project.ignore);

        let mut problems = Vec::new();
        if let Some(problem) = loaded.problem {
            problems.push(problem);
        }
        problems.extend(rules.problems().iter().cloned());

        let name = loaded
            .project
            .project
            .name
            .clone()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| folder_name(&path));

        Root {
            id,
            name,
            has_project_file: loaded.present,
            has_obsidian_config: project::obsidian::detect(&path),
            available,
            problems,
            project: loaded.project,
            rules: Arc::new(rules),
            path,
        }
    }

    /// Перечитать файл проекта, сохранив номер корня.
    pub fn reload(&mut self) {
        let fresh = Root::load(self.id, self.path.clone());
        *self = fresh;
    }
}

/// Список корней рабочего пространства.
#[derive(Debug, Default)]
pub struct Roots {
    next_id: RootId,
    items: Vec<Root>,
}

impl Roots {
    pub fn new() -> Roots {
        Roots {
            next_id: 1,
            items: Vec::new(),
        }
    }

    /// Восстановить из сессии. Номера берутся оттуда же: по ним будут названы
    /// файлы индекса (задача 11), и перевыдача сломала бы связь.
    pub fn restore(items: Vec<Root>, next_id: RootId) -> Roots {
        let highest = items.iter().map(|r| r.id).max().unwrap_or(0);
        Roots {
            next_id: next_id.max(highest + 1),
            items,
        }
    }

    pub fn list(&self) -> &[Root] {
        &self.items
    }

    pub fn next_id(&self) -> RootId {
        self.next_id
    }

    pub fn get(&self, id: RootId) -> Option<&Root> {
        self.items.iter().find(|r| r.id == id)
    }

    pub fn get_mut(&mut self, id: RootId) -> Option<&mut Root> {
        self.items.iter_mut().find(|r| r.id == id)
    }

    pub fn find_by_path(&self, path: &Path) -> Option<&Root> {
        self.items.iter().find(|r| same_path(&r.path, path))
    }

    /// Добавить папку корнем.
    ///
    /// Уже добавленная папка возвращается прежним корнем, а не удваивается:
    /// два корня на одну папку означали бы два индекса одних и тех же файлов.
    /// Вложенные корни при этом разрешены — это законный сценарий (В18).
    pub fn add(&mut self, path: PathBuf) -> &Root {
        let path = normalize(&path);

        if let Some(position) = self.items.iter().position(|r| same_path(&r.path, &path)) {
            return &self.items[position];
        }

        let id = self.next_id;
        self.next_id += 1;

        self.items.push(Root::load(id, path));
        self.items.last().expect("корень только что добавлен")
    }

    pub fn remove(&mut self, id: RootId) -> bool {
        let before = self.items.len();
        self.items.retain(|r| r.id != id);
        self.items.len() != before
    }

    /// Перечитать все корни: файлы проектов и доступность папок.
    pub fn reload_all(&mut self) {
        for root in &mut self.items {
            root.reload();
        }
    }

    /// Корень, которому принадлежит файл.
    ///
    /// При вложенных корнях побеждает самый глубокий: настройки ближней папки
    /// конкретнее настроек дальней, и ожидание пользователя именно такое.
    pub fn for_path(&self, path: &Path) -> Option<&Root> {
        self.items
            .iter()
            .filter(|r| inside(&r.path, path))
            .max_by_key(|r| r.path.as_os_str().len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::encoding::Encoding;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-root-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn name_comes_from_the_folder() {
        let root = Root::load(1, PathBuf::from(r"C:\заметки\рабочие"));
        assert_eq!(root.name, "рабочие");
    }

    /// Имя из файла проекта главнее имени папки: пользователь мог назвать
    /// папку `notes-2`, а проект — «Рабочие заметки».
    #[test]
    fn name_from_project_file_wins() {
        let dir = temp_dir("name");
        std::fs::write(
            project::project_path(&dir),
            "schema = 1\n[project]\nname = \"Рабочие заметки\"\n",
        )
        .unwrap();

        let root = Root::load(1, dir.clone());

        assert_eq!(root.name, "Рабочие заметки");
        assert!(root.has_project_file);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Папку, добавленную дважды, нельзя удваивать: это два индекса одних
    /// и тех же файлов и два дерева, расходящихся между собой.
    #[test]
    fn adding_the_same_folder_twice_changes_nothing() {
        let mut roots = Roots::new();

        let first = roots.add(PathBuf::from(r"C:\заметки")).id;
        let second = roots.add(PathBuf::from(r"C:\заметки")).id;

        assert_eq!(first, second);
        assert_eq!(roots.list().len(), 1);
    }

    /// Windows не различает регистр: `C:\Заметки` и `c:\заметки` — одна папка.
    #[test]
    fn paths_are_compared_without_case() {
        let mut roots = Roots::new();

        roots.add(PathBuf::from(r"C:\Заметки"));
        roots.add(PathBuf::from(r"c:\заметки"));

        assert_eq!(roots.list().len(), 1);
    }

    /// Вложенные корни разрешены (В18): в VS Code это законно и иногда осмысленно.
    #[test]
    fn nested_roots_are_allowed() {
        let mut roots = Roots::new();

        roots.add(PathBuf::from(r"C:\проект"));
        roots.add(PathBuf::from(r"C:\проект\заметки"));

        assert_eq!(roots.list().len(), 2);
    }

    /// При вложенных корнях у файла хозяин — ближний корень: его настройки
    /// конкретнее.
    #[test]
    fn deepest_root_owns_the_file() {
        let mut roots = Roots::new();
        let outer = roots.add(PathBuf::from(r"C:\проект")).id;
        let inner = roots.add(PathBuf::from(r"C:\проект\заметки")).id;

        let owner = roots.for_path(Path::new(r"C:\проект\заметки\список.md"));
        assert_eq!(owner.map(|r| r.id), Some(inner));

        let other = roots.for_path(Path::new(r"C:\проект\readme.md"));
        assert_eq!(other.map(|r| r.id), Some(outer));
    }

    /// Похожее имя рядом — не вложенность. `C:\проект-2` не принадлежит
    /// корню `C:\проект`.
    #[test]
    fn similar_neighbour_is_not_inside() {
        let mut roots = Roots::new();
        roots.add(PathBuf::from(r"C:\проект"));

        assert!(roots.for_path(Path::new(r"C:\проект-2\файл.md")).is_none());
    }

    #[test]
    fn file_outside_any_root_has_no_owner() {
        let mut roots = Roots::new();
        roots.add(PathBuf::from(r"C:\проект"));

        assert!(roots.for_path(Path::new(r"D:\случайный\файл.md")).is_none());
    }

    /// Номера не переиспользуются: по ним будут названы файлы индекса.
    #[test]
    fn identifiers_are_unique_even_after_removal() {
        let mut roots = Roots::new();

        let first = roots.add(PathBuf::from(r"C:\один")).id;
        roots.remove(first);
        let second = roots.add(PathBuf::from(r"C:\два")).id;

        assert_ne!(first, second);
    }

    /// Счётчик после восстановления обязан быть больше любого выданного
    /// номера, даже если снимок испорчен.
    #[test]
    fn restore_repairs_a_broken_counter() {
        let items = vec![Root::load(7, PathBuf::from(r"C:\заметки"))];
        let mut roots = Roots::restore(items, 1);

        let fresh = roots.add(PathBuf::from(r"C:\другое")).id;

        assert!(fresh > 7, "новый корень затёр бы существующий: {fresh}");
    }

    /// Несуществующая папка помечается недоступной, но остаётся корнем:
    /// это может быть отключённый диск (Р-052).
    #[test]
    fn missing_folder_stays_a_root() {
        let mut roots = Roots::new();

        let root = roots.add(PathBuf::from(r"Z:\нет-такого-диска\заметки"));

        assert!(!root.available);
        assert_eq!(roots.list().len(), 1);
    }

    /// Настройки проекта доезжают до корня: на них опирается выбор кодировки.
    #[test]
    fn project_settings_reach_the_root() {
        let dir = temp_dir("settings");
        std::fs::write(
            project::project_path(&dir),
            "schema = 1\n[editor]\ndefault_encoding = \"windows1251\"\n",
        )
        .unwrap();

        let root = Root::load(1, dir.clone());

        assert_eq!(
            root.project.editor.default_encoding,
            Some(Encoding::Windows1251)
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Правка файла проекта подхватывается перечитыванием, а номер корня
    /// при этом сохраняется.
    #[test]
    fn reload_picks_up_changes_and_keeps_the_id() {
        let dir = temp_dir("reload");
        let mut root = Root::load(5, dir.clone());
        assert!(!root.has_project_file);

        std::fs::write(
            project::project_path(&dir),
            "schema = 1\n[project]\nname = \"Новое имя\"\n",
        )
        .unwrap();
        root.reload();

        assert_eq!(root.id, 5);
        assert_eq!(root.name, "Новое имя");
        assert!(root.has_project_file);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
