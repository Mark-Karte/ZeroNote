//! Корень как область поиска: что в него входит — решает путь, а не номер.
//!
//! Задача 140, находка Я8. Строка индекса одна на файл (`path UNIQUE`),
//! и номер корня в ней — тот, кто проиндексировал файл первым. При вложенных
//! корнях (`D:\Заметки` и `D:\Заметки\Работа`, законный сценарий — В18) это случай:
//! файлы «Работы» могли достаться «Заметкам», и тогда ссылка из «Работы»
//! искала среди файлов «Работы» и не находила ничего — висела, `Ctrl`+щелчок
//! создавал пустышку рядом, переименование не видело ссылок.
//!
//! Поэтому принадлежность считается **при запросе, по пути**: область корня —
//! все файлы под его папкой, кто бы их ни проиндексировал. Ссылка ищет
//! в области самого глубокого корня своего файла — как настройки проекта
//! (`Roots::for_path`). Заметка внешней папки при этом видит и файлы
//! вложенной: они лежат в её папке. Номер корня в строке остаётся только
//! для обслуживания индекса — сверки с диском и забывания убранного корня.

use std::path::Path;

use crate::model::root::RootId;

use super::writer::path_key;

/// Экранирование строки для `LIKE`.
///
/// Та же беда, что с запросом к FTS5, только тише: `_` в `LIKE` означает
/// «любой символ», а `%` — «любая строка». Тег `план_б`, набранный как есть,
/// нашёл бы и `планаб`, и `план-б`, а путь с подчёркиванием — чужую папку.
/// Экранируем сами и объявляем escape-символ в запросе (`ESCAPE '\'`) —
/// иначе он тоже был бы обычным символом.
pub fn escape_like(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if ch == '\\' || ch == '%' || ch == '_' {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Корень как область.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scope {
    pub id: RootId,
    /// Путь корня как его хранит реестр — в настоящем регистре: от него
    /// считается путь внутри проекта, который видит человек.
    pub path: String,
    /// Ключ папки с разделителем на конце: `d:\заметки\`. Разделитель
    /// обязателен — иначе `d:\проект-2` оказался бы внутри `d:\проект`.
    key: String,
}

impl Scope {
    pub fn new(id: RootId, path: &Path) -> Scope {
        // У корня диска разделитель уже есть (`D:\`) — второй не нужен.
        let mut key = path_key(path).trim_end_matches('\\').to_owned();
        key.push('\\');
        Scope {
            id,
            path: path.to_string_lossy().into_owned(),
            key,
        }
    }

    /// Лежит ли файл внутри корня.
    pub fn contains(&self, path: &str) -> bool {
        path_key(Path::new(path)).starts_with(&self.key)
    }

    /// Ключ файла по пути внутри корня: `работа/Планы` → `d:\заметки\работа\планы`.
    pub fn key_of(&self, relative: &str) -> String {
        format!("{}{}", self.key, relative.replace('/', "\\"))
    }

    /// Шаблон `LIKE` для «всё под этой папкой» — к запросу с `ESCAPE '\'`.
    pub fn like_pattern(&self) -> String {
        format!("{}%", escape_like(&self.key))
    }

    /// Путь внутри корня в настоящем регистре. `None` — файл не отсюда.
    pub fn relative(&self, path: &str) -> Option<String> {
        if !self.contains(path) {
            return None;
        }
        // Длина ключа совпадает с длиной пути корня плюс разделитель, только
        // если регистр не менял длину строки; поэтому срез считаем по пути
        // корня без разделителя, а разделители снимаем отдельно.
        let root = self.path.trim_end_matches(['\\', '/']);
        Some(path.get(root.len()..)?.trim_start_matches(['\\', '/']).to_owned())
    }
}

/// Все корни рабочего пространства как области.
#[derive(Debug, Clone, Default)]
pub struct Scopes {
    items: Vec<Scope>,
}

impl Scopes {
    pub fn new(items: Vec<Scope>) -> Scopes {
        Scopes { items }
    }

    pub fn list(&self) -> &[Scope] {
        &self.items
    }

    pub fn get(&self, id: RootId) -> Option<&Scope> {
        self.items.iter().find(|scope| scope.id == id)
    }

    /// Область файла — самый глубокий корень, в котором он лежит. `None` —
    /// файл вне всех корней: ссылаться из него не на что.
    pub fn for_path(&self, path: &str) -> Option<&Scope> {
        self.items
            .iter()
            .filter(|scope| scope.contains(path))
            .max_by_key(|scope| scope.key.len())
    }

    /// Все корни, в которых лежит файл: внешний и вложенные.
    pub fn containing<'a>(&'a self, path: &'a str) -> impl Iterator<Item = &'a Scope> + 'a {
        self.items.iter().filter(move |scope| scope.contains(path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scopes() -> Scopes {
        Scopes::new(vec![
            Scope::new(1, Path::new(r"D:\Заметки")),
            Scope::new(2, Path::new(r"D:\Заметки\Работа")),
            Scope::new(3, Path::new(r"D:\Заметки-2")),
        ])
    }

    /// Самый глубокий корень побеждает — как у настроек проекта.
    #[test]
    fn nested_root_owns_its_files() {
        let scopes = scopes();
        assert_eq!(scopes.for_path(r"D:\Заметки\Работа\План.md").map(|s| s.id), Some(2));
        assert_eq!(scopes.for_path(r"d:\заметки\личное.md").map(|s| s.id), Some(1));
        assert_eq!(scopes.for_path(r"C:\чужое.md"), None);
    }

    /// Папка с похожим именем — другая папка.
    #[test]
    fn similar_folder_name_is_not_inside() {
        let scopes = scopes();
        assert_eq!(scopes.for_path(r"D:\Заметки-2\а.md").map(|s| s.id), Some(3));
        assert!(!scopes.get(1).unwrap().contains(r"D:\Заметки-2\а.md"));
    }

    /// Внешний корень видит и файлы вложенного: они лежат в его папке.
    #[test]
    fn outer_root_contains_nested_files() {
        let scopes = scopes();
        let ids: Vec<_> = scopes.containing(r"D:\Заметки\Работа\План.md").map(|s| s.id).collect();
        assert_eq!(ids, vec![1, 2]);
    }

    #[test]
    fn relative_path_keeps_the_case() {
        let scope = Scope::new(1, Path::new(r"D:\Заметки"));
        assert_eq!(scope.relative(r"d:\заметки\Работа\План.md").as_deref(), Some(r"Работа\План.md"));
    }

    /// У корня диска разделитель уже есть.
    #[test]
    fn drive_root_is_a_scope_too() {
        let scope = Scope::new(1, Path::new(r"D:\"));
        assert!(scope.contains(r"D:\а\б.md"));
        assert_eq!(scope.relative(r"D:\а\б.md").as_deref(), Some(r"а\б.md"));
    }

    /// Подчёркивание в пути — буква, а не «любой знак».
    #[test]
    fn like_pattern_escapes_wildcards() {
        let scope = Scope::new(1, Path::new(r"D:\мои_заметки"));
        assert_eq!(scope.like_pattern(), r"d:\\мои\_заметки\\%");
    }
}
