//! Правка `keymap.toml` из окна параметров.
//!
//! Та же задача, что у `settings/edit.rs`, и то же требование: после записи
//! из окна файл должен остаться тем же файлом — с комментариями, порядком
//! ключей и всем, что человек написал руками (Р-013, Р-077). Поэтому
//! `toml_edit`, а не сериализация через serde.
//!
//! Но устроено сложнее, и вот почему. В `settings.toml` ключ — это настройка,
//! и записать её значит записать одно значение. Здесь ключ — **сочетание**,
//! а не команда: файл отвечает на вопрос «что делает Ctrl+S», а окно
//! параметров спрашивает обратное — «чем нажимается „Сохранить“». Плюс
//! умолчания живут не в файле, а в коде, и снять умолчание можно только
//! написав про него в файле явно.
//!
//! Отсюда правило: **правка выражается через сочетания, а не через команду.**
//! Назначить команде новое сочетание — это убрать всё, что файл говорил
//! о ней раньше, снять её умолчания и записать новое. Каждый из этих шагов
//! по отдельности оставил бы файл в состоянии, которого пользователь
//! не просил.

use toml_edit::{DocumentMut, Item, Table, value};

use super::{DEFAULTS, normalize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditError {
    /// Файл не разбирается как TOML. Писать в него нельзя: мы не знаем, что
    /// именно сломано, и любая запись рискует затереть недописанное.
    Parse(String),
    /// `bindings` в файле есть, но это не таблица. Чинить за пользователя
    /// мы не будем.
    NotATable,
    /// Сочетание не разбирается. Приходит из окна параметров, где нажатие
    /// уже разобрано, — то есть означает расхождение между разбором во
    /// фронтенде и словарём клавиш в ядре.
    BadBinding(String),
    /// Команды с таким именем не существует.
    UnknownCommand(String),
}

impl std::fmt::Display for EditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EditError::Parse(message) => {
                write!(f, "keymap.toml не разбирается, правка отменена: {message}")
            }
            EditError::NotATable => {
                write!(f, "в keymap.toml раздел bindings — не таблица, правка отменена")
            }
            EditError::BadBinding(binding) => {
                write!(f, "не удалось разобрать сочетание «{binding}»")
            }
            EditError::UnknownCommand(command) => {
                write!(f, "неизвестная команда «{command}»")
            }
        }
    }
}

impl std::error::Error for EditError {}

/// Сочетания, которые команда получает по умолчанию.
///
/// У команды их может быть несколько: «перейти к парной скобке» нажимается
/// и `Ctrl+Alt+B`, и `Ctrl+Shift+\`. Поэтому список, а не одно значение.
/// Порядок — по алфавиту, а не как в таблице умолчаний: редактор клавиш
/// сравнивает этот список с тем, что действует сейчас, а тот приходит
/// отсортированным. Сравнение двух списков в разном порядке показывало бы
/// «изменено» там, где ничего не менялось.
pub fn defaults_for(command: &str) -> Vec<String> {
    let mut found: Vec<String> = DEFAULTS
        .iter()
        .filter(|(_, id)| *id == command)
        .map(|(binding, _)| normalize(binding).expect("умолчания обязаны разбираться"))
        .collect();
    found.sort();
    found
}

fn known(command: &str) -> bool {
    super::COMMANDS.iter().any(|(id, _)| *id == command)
}

fn document(source: &str) -> Result<DocumentMut, EditError> {
    source
        .parse()
        .map_err(|e: toml_edit::TomlError| EditError::Parse(e.to_string()))
}

/// Таблица `[bindings]`, создаваемая при отсутствии.
fn bindings_table(document: &mut DocumentMut) -> Result<&mut Table, EditError> {
    if document.get("bindings").is_none() {
        document.insert("bindings", Item::Table(Table::new()));
    }
    document
        .get_mut("bindings")
        .and_then(Item::as_table_mut)
        .ok_or(EditError::NotATable)
}

/// Ключи таблицы, за которыми стоит эта команда.
fn keys_of(table: &Table, command: &str) -> Vec<String> {
    table
        .iter()
        .filter(|(_, item)| item.as_str() == Some(command))
        .map(|(key, _)| key.to_owned())
        .collect()
}

/// Занято ли сочетание в файле какой-нибудь командой.
///
/// Пустая строка не занятость, а наоборот — снятие умолчания.
fn claimed(table: &Table, binding: &str) -> bool {
    table
        .get(binding)
        .and_then(Item::as_str)
        .is_some_and(|command| !command.is_empty())
}

/// Назначить команде сочетание. `None` означает «снять вовсе».
///
/// Порядок шагов важен, и каждый из них закрывает свой случай:
///
/// 1. забыть всё, что файл говорил об этой команде раньше — иначе у неё
///    осталось бы старое сочетание вдобавок к новому;
/// 2. отнять новое сочетание у того, кто держал его в файле, — иначе
///    назначение молча не сработало бы: в файле осталась бы чужая строка;
/// 3. снять умолчания команды, кроме того, которое ей и назначают. Но только
///    те, что ещё никем не заняты: если сочетание уже забрала другая команда,
///    снимать нечего, а запись `""` отняла бы его и у неё;
/// 4. записать новое сочетание — если только оно не совпало с умолчанием.
///    Совпало — записи не нужно, умолчание и так действует, а лишняя строка
///    в файле человека сбивает с толку.
pub fn assign(source: &str, command: &str, binding: Option<&str>) -> Result<String, EditError> {
    if !known(command) {
        return Err(EditError::UnknownCommand(command.to_owned()));
    }

    let wanted = match binding {
        Some(binding) => Some(
            normalize(binding).ok_or_else(|| EditError::BadBinding(binding.to_owned()))?,
        ),
        None => None,
    };

    let mut document = document(source)?;
    let defaults = defaults_for(command);
    let table = bindings_table(&mut document)?;

    for key in keys_of(table, command) {
        table.remove(&key);
    }

    if let Some(wanted) = &wanted {
        table.remove(wanted);
    }

    for default in &defaults {
        if wanted.as_deref() == Some(default.as_str()) || claimed(table, default) {
            continue;
        }
        table.insert(default, value(""));
    }

    if let Some(wanted) = &wanted {
        if !defaults.contains(wanted) {
            table.insert(wanted, value(command));
        }
    }

    Ok(document.to_string())
}

/// Вернуть команде умолчание.
///
/// Убирается и то, чем её переназначили, и снятие её умолчаний. Чужие строки
/// не трогаются: сброс одной команды не должен возвращать сочетание,
/// которое пользователь осознанно отдал другой.
pub fn reset(source: &str, command: &str) -> Result<String, EditError> {
    if !known(command) {
        return Err(EditError::UnknownCommand(command.to_owned()));
    }

    let mut document = document(source)?;
    let defaults = defaults_for(command);
    let table = bindings_table(&mut document)?;

    for key in keys_of(table, command) {
        table.remove(&key);
    }

    for default in &defaults {
        // Снятие умолчания — это пустая строка. Если по этому сочетанию
        // стоит чужая команда, она там не случайно.
        if table.get(default).and_then(Item::as_str) == Some("") {
            table.remove(default);
        }
    }

    Ok(document.to_string())
}

/// Убрать все переназначения разом.
///
/// Комментарии вне таблицы остаются: шапка файла объясняет его формат
/// и к настройкам пользователя отношения не имеет.
pub fn reset_all(source: &str) -> Result<String, EditError> {
    let mut document = document(source)?;
    let table = bindings_table(&mut document)?;
    table.clear();
    Ok(document.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keymap;

    /// Разобрать итог так же, как это сделает приложение.
    fn resolved(source: &str) -> std::collections::BTreeMap<String, String> {
        let file = keymap::parse(source).expect("итог правки обязан разбираться");
        keymap::resolve(Some(&file)).expect("итог правки обязан собираться")
    }

    const EMPTY: &str = "schema = 1\n\n[bindings]\n";

    #[test]
    fn assigning_a_free_binding_writes_one_line() {
        let out = assign(EMPTY, "file.save", Some("ctrl+alt+q")).unwrap();
        let map = resolved(&out);

        assert_eq!(map["ctrl+alt+q"], "file.save");
        // Умолчание снято, иначе у команды стало бы два сочетания.
        assert!(!map.contains_key("ctrl+s"));
    }

    /// Возврат к умолчанию не оставляет в файле строки про него: умолчание
    /// и так действует, а лишняя строка сбивает с толку того, кто правит файл
    /// руками.
    #[test]
    fn assigning_the_default_back_leaves_no_trace() {
        let moved = assign(EMPTY, "file.save", Some("ctrl+alt+q")).unwrap();
        let back = assign(&moved, "file.save", Some("ctrl+s")).unwrap();

        assert_eq!(resolved(&back)["ctrl+s"], "file.save");
        assert!(!back.contains("ctrl+alt+q"), "{back}");
        assert!(!back.contains("ctrl+s"), "умолчание не надо записывать: {back}");
    }

    #[test]
    fn assigning_none_takes_the_binding_away() {
        let out = assign(EMPTY, "file.save", None).unwrap();
        let map = resolved(&out);

        assert!(!map.contains_key("ctrl+s"));
        assert!(!map.values().any(|command| command == "file.save"));
    }

    /// Команда с двумя умолчаниями получает ровно одно новое сочетание,
    /// а второе умолчание снимается: окно параметров показывает и назначает
    /// одно, и оставить второе значило бы соврать в подписи.
    #[test]
    fn a_command_with_two_defaults_keeps_only_the_chosen_one() {
        assert_eq!(defaults_for("view.go-to-bracket").len(), 2);

        let out = assign(EMPTY, "view.go-to-bracket", Some("ctrl+alt+q")).unwrap();
        let map = resolved(&out);

        assert_eq!(map["ctrl+alt+q"], "view.go-to-bracket");
        assert!(!map.contains_key("ctrl+alt+b"));
        assert!(!map.contains_key("ctrl+shift+backslash"));
    }

    /// Отнять сочетание у другой команды можно — окно параметров об этом
    /// предупреждает. Но отнимается ровно одно сочетание, а не команда целиком.
    #[test]
    fn taking_a_busy_binding_leaves_the_other_command_alive() {
        let out = assign(EMPTY, "file.save-all", Some("ctrl+s")).unwrap();
        let map = resolved(&out);

        assert_eq!(map["ctrl+s"], "file.save-all");
        // «Сохранить» лишилась сочетания, но осталась командой.
        assert!(!map.values().any(|command| command == "file.save"));
        // А её собственное прежнее сочетание досталось не ей.
        assert_eq!(map.get("ctrl+shift+s"), None, "второе умолчание снято");
    }

    /// Самый тонкий случай: сочетание уже отдано другой команде, и теперь
    /// его хозяин сбрасывается. Снимать умолчание записью `""` здесь нельзя —
    /// это отняло бы сочетание у того, кому его отдали осознанно.
    #[test]
    fn unbinding_does_not_steal_from_the_new_owner() {
        let taken = assign(EMPTY, "file.save-all", Some("ctrl+s")).unwrap();
        let out = assign(&taken, "file.save", Some("ctrl+alt+q")).unwrap();
        let map = resolved(&out);

        assert_eq!(map["ctrl+s"], "file.save-all", "чужое сочетание не тронуто");
        assert_eq!(map["ctrl+alt+q"], "file.save");
    }

    #[test]
    fn reset_returns_the_default() {
        let moved = assign(EMPTY, "file.save", Some("ctrl+alt+q")).unwrap();
        let back = reset(&moved, "file.save").unwrap();
        let map = resolved(&back);

        assert_eq!(map["ctrl+s"], "file.save");
        assert!(!map.contains_key("ctrl+alt+q"));
    }

    /// Сброс возвращает умолчание, но не отбирает сочетание у того, кому
    /// пользователь отдал его сам.
    #[test]
    fn reset_does_not_take_a_binding_from_another_command() {
        let taken = assign(EMPTY, "file.save-all", Some("ctrl+s")).unwrap();
        let back = reset(&taken, "file.save").unwrap();
        let map = resolved(&back);

        assert_eq!(map["ctrl+s"], "file.save-all");
        assert!(!map.values().any(|command| command == "file.save"));
    }

    #[test]
    fn reset_all_removes_every_override() {
        let one = assign(EMPTY, "file.save", Some("ctrl+alt+q")).unwrap();
        let two = assign(&one, "file.open", None).unwrap();
        let clean = reset_all(&two).unwrap();

        assert_eq!(resolved(&clean), resolved(EMPTY));
    }

    /// Комментарии пользователя переживают правку — то же требование, что
    /// и у settings.toml (Р-013).
    #[test]
    fn comments_survive() {
        let source = "# мой файл раскладки\nschema = 1\n\n[bindings]\n# так удобнее\n\"ctrl+alt+q\" = \"file.save\"\n";

        let out = assign(source, "file.open", Some("ctrl+alt+w")).unwrap();

        assert!(out.contains("# мой файл раскладки"), "{out}");
        assert!(out.contains("# так удобнее"), "{out}");
    }

    /// Файла раскладки может не быть вовсе — тогда правится образец, и в нём
    /// уже есть и схема, и таблица.
    #[test]
    fn the_template_can_be_edited() {
        let out = assign(keymap::DEFAULT_TEMPLATE, "file.save", Some("ctrl+alt+q")).unwrap();

        assert_eq!(resolved(&out)["ctrl+alt+q"], "file.save");
        assert!(out.contains("# Горячие клавиши ZeroNote."), "{out}");
    }

    #[test]
    fn nonsense_is_refused() {
        assert!(matches!(
            assign(EMPTY, "file.save", Some("ctrl+щщщ")),
            Err(EditError::BadBinding(_))
        ));
        assert!(matches!(
            assign(EMPTY, "file.saveee", Some("ctrl+alt+q")),
            Err(EditError::UnknownCommand(_))
        ));
        assert!(matches!(
            assign("= = =", "file.save", Some("ctrl+alt+q")),
            Err(EditError::Parse(_))
        ));
    }
}
