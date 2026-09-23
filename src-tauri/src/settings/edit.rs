//! Правка `settings.toml` с сохранением того, что написал пользователь.
//!
//! Файл — основной интерфейс настройки, а окно параметров — надстройка над ним
//! (Р-077). Отсюда главное требование: после записи из окна файл должен
//! остаться тем же файлом. Комментарии, порядок ключей, пустые строки,
//! кавычки — всё на месте, изменилось только одно значение.
//!
//! Обычный `toml` через serde так не умеет: он собирает документ заново из
//! структуры, и всё, чего нет в структуре, исчезает. Поэтому `toml_edit`,
//! который правит разобранный документ, а не пересобирает его (Р-013).

use toml_edit::{DocumentMut, Item, Table, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditError {
    /// Файл не разбирается. Писать в него нельзя: мы не знаем, что именно
    /// сломано, и любая запись рискует затереть то, что человек не дописал.
    Parse(String),
    /// На пути к ключу оказалось не то: `[appearance]` есть, но это строка,
    /// а не таблица. Чинить такое за пользователя мы не будем.
    NotATable(String),
}

impl std::fmt::Display for EditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EditError::Parse(message) => {
                write!(f, "settings.toml не разбирается, правка отменена: {message}")
            }
            EditError::NotATable(path) => write!(
                f,
                "в settings.toml по пути {path} лежит не таблица, правка отменена"
            ),
        }
    }
}

impl std::error::Error for EditError {}

/// Что можно записать. Ровно то, что встречается в наших настройках.
///
/// Список появился с задачей 102: состав панели инструментов — перечень
/// команд, и писать его по одной строке значило бы получить в файле
/// промежуточные состояния, которые никто не собирал.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(untagged)]
pub enum Setting {
    Text(String),
    Number(i64),
    Flag(bool),
    List(Vec<String>),
}

impl From<&Setting> for Value {
    fn from(setting: &Setting) -> Self {
        match setting {
            Setting::Text(text) => Value::from(text.as_str()),
            Setting::Number(number) => Value::from(*number),
            Setting::Flag(flag) => Value::from(*flag),
            Setting::List(items) => {
                let mut array = toml_edit::Array::new();
                for item in items {
                    array.push(item.as_str());
                }
                // По строке на элемент: список правят и руками, а строка
                // в тридцать команд длиной в полэкрана не читается вовсе.
                for value in array.iter_mut() {
                    value.decor_mut().set_prefix("\n    ");
                }
                array.set_trailing_comma(true);
                array.set_trailing("\n");
                Value::Array(array)
            }
        }
    }
}

/// Записать значение по пути вида `["appearance", "theme"]`.
///
/// Недостающие таблицы создаются. Существующее значение подменяется на месте:
/// `toml_edit` сохраняет за ключом его окружение — отступ, комментарий в конце
/// строки, — и правка выглядит так, будто её сделали руками.
///
/// Закомментированный ключ остаётся закомментированным, а рядом появляется
/// настоящий. Это не оплошность: `# size = 13` в образце — это пояснение,
/// а не выключенная настройка, и раскомментировать его значило бы решать
/// за пользователя, что он имел в виду.
pub fn set(source: &str, path: &[&str], value: &Setting) -> Result<String, EditError> {
    let mut document: DocumentMut = source
        .parse()
        .map_err(|e: toml_edit::TomlError| EditError::Parse(e.to_string()))?;

    let (last, parents) = path.split_last().expect("путь к настройке не бывает пустым");

    // Спускаемся по таблицам, создавая недостающие. `item` каждый раз
    // указывает на текущий уровень; заимствование переносится с одного
    // уровня на следующий, поэтому цикл, а не рекурсия.
    let mut item: &mut Item = document.as_item_mut();
    for (depth, key) in parents.iter().enumerate() {
        if item.get(key).is_none() {
            let table = item
                .as_table_mut()
                .ok_or_else(|| EditError::NotATable(path[..depth].join(".")))?;
            // Неявная таблица печатается как `[a.b]`, а не как пустая `[a]`
            // плюс `[a.b]`: заголовка, которого пользователь не писал,
            // в файле появиться не должно.
            let mut fresh = Table::new();
            fresh.set_implicit(true);
            table.insert(key, Item::Table(fresh));
        }

        item = item
            .get_mut(key)
            .expect("таблица только что создана или уже была");

        if !item.is_table_like() {
            return Err(EditError::NotATable(path[..=depth].join(".")));
        }
    }

    let table = item
        .as_table_like_mut()
        .ok_or_else(|| EditError::NotATable(parents.join(".")))?;

    match table.get_mut(last) {
        // Ключ есть: меняем только значение, не трогая ни ключ, ни то,
        // что написано вокруг него.
        Some(existing) if existing.is_value() => {
            let old = existing.as_value().expect("проверено условием");
            // Оформление (пробелы и комментарий после значения) переносим
            // со старого значения на новое, иначе `theme = "dark"  # тёмная`
            // превратилось бы в `theme = "dark"`.
            let mut fresh = Value::from(value);
            fresh = fresh.decorated(
                old.decor().prefix().and_then(|s| s.as_str()).unwrap_or(" "),
                old.decor().suffix().and_then(|s| s.as_str()).unwrap_or(""),
            );
            *existing = Item::Value(fresh);
        }
        // Ключ есть, но это таблица: подменять её значением нельзя.
        Some(_) => return Err(EditError::NotATable(path.join("."))),
        None => {
            table.insert(last, Item::Value(Value::from(value)));
        }
    }

    Ok(document.to_string())
}

/// Убрать ключ. Нужно настройкам вида «не задано — значит из темы»:
/// пустое поле шрифта означает не пустую строку, а отсутствие ключа.
pub fn unset(source: &str, path: &[&str]) -> Result<String, EditError> {
    let mut document: DocumentMut = source
        .parse()
        .map_err(|e: toml_edit::TomlError| EditError::Parse(e.to_string()))?;

    let (last, parents) = path.split_last().expect("путь к настройке не бывает пустым");

    let mut item: &mut Item = document.as_item_mut();
    for key in parents {
        // Нет таблицы — нечего и убирать. Это не ошибка: настройка и так
        // не задана, а именно этого от нас и хотели.
        if item.get(key).is_none() {
            return Ok(document.to_string());
        }
        item = item.get_mut(key).expect("проверено условием");
    }

    if let Some(table) = item.as_table_mut() {
        remove_keeping_comment(table, last);
    }

    Ok(document.to_string())
}

/// Убрать ключ, не потеряв написанное о нём пользователем.
///
/// `toml_edit` держит комментарий перед ключом как его собственное оформление,
/// поэтому обычное удаление уносит и комментарий. А комментарий писал человек,
/// и стирать его за него мы не будем — это то же самое, чего мы не делаем
/// с чужими файлами по инварианту 1.
///
/// Поэтому перед удалением оформление снимается и приписывается следующему
/// ключу. Если удаляемый ключ последний в разделе, приписать некому — тогда
/// он остаётся у предыдущего, в конце строки.
fn remove_keeping_comment(table: &mut Table, name: &str) {
    let prefix = table
        .key(name)
        .and_then(|key| key.leaf_decor().prefix())
        .and_then(|raw| raw.as_str())
        .unwrap_or("")
        .to_owned();

    let order: Vec<String> = table.iter().map(|(key, _)| key.to_owned()).collect();
    let at = order.iter().position(|key| key == name);

    table.remove(name);

    // Пустое оформление или просто перевод строки уносить незачем.
    if !prefix.contains('#') {
        return;
    }

    let Some(at) = at else { return };

    if let Some(next) = order.get(at + 1)
        && let Some(mut key) = table.key_mut(next)
    {
        let existing = key
            .leaf_decor()
            .prefix()
            .and_then(|raw| raw.as_str())
            .unwrap_or("")
            .to_owned();
        key.leaf_decor_mut().set_prefix(format!("{prefix}{existing}"));
        return;
    }

    if at > 0
        && let Some(previous) = order.get(at - 1)
        && let Some(item) = table.get_mut(previous)
        && let Some(value) = item.as_value_mut()
    {
        let existing = value
            .decor()
            .suffix()
            .and_then(|raw| raw.as_str())
            .unwrap_or("")
            .to_owned();
        value.decor_mut().set_suffix(format!("{existing}{prefix}"));
    }
}

/// Проверить правку из окна параметров перед записью.
///
/// Итог обязан читаться нашим разбором **и не добавлять новых жалоб**.
/// Второе стало нужно с Р-248: разбор больше не отвергает файл с негодным
/// значением, а берёт вместо него умолчание — и без этой проверки окно
/// параметров записало бы в файл «очень плотную» плотность, а человек
/// увидел бы на экране обычную.
///
/// Сравнение «до и после», а не «жалоб нет вовсе»: опечатка, сделанная
/// руками в другом ключе, не должна запирать всё окно. До Р-248 запирала —
/// одна строка с ошибкой делала параметры только для чтения.
pub fn verify(before: &str, after: &str) -> Result<(), String> {
    let known: Vec<String> = crate::settings::parse(before)
        .map(|loaded| loaded.problems)
        .unwrap_or_default();

    let loaded = crate::settings::parse(after).map_err(|e| e.to_string())?;

    match loaded.problems.into_iter().find(|problem| !known.contains(problem)) {
        Some(problem) => Err(problem),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Главное требование задачи: комментарии переживают запись.
    #[test]
    fn comments_and_order_survive() {
        let source = "\
# Настройки ZeroNote.
# Второй строкой пояснение.

schema = 1

[appearance]
# Какую тему брать.
theme = \"system\"
density = \"normal\"
";

        let out = set(source, &["appearance", "theme"], &Setting::Text("pine".into())).unwrap();

        assert!(out.contains("# Настройки ZeroNote."));
        assert!(out.contains("# Второй строкой пояснение."));
        assert!(out.contains("# Какую тему брать."));
        assert!(out.contains("theme = \"pine\""));
        assert!(out.contains("density = \"normal\""));
        // Порядок не переставлен: schema по-прежнему до раздела.
        assert!(out.find("schema = 1").unwrap() < out.find("[appearance]").unwrap());
    }

    /// Комментарий в конце строки принадлежит значению, и его легко потерять.
    #[test]
    fn trailing_comment_stays_with_the_key() {
        let source = "[appearance]\ntheme = \"dark\"  # мой выбор\n";

        let out = set(source, &["appearance", "theme"], &Setting::Text("light".into())).unwrap();

        assert_eq!(out, "[appearance]\ntheme = \"light\"  # мой выбор\n");
    }

    /// Ключа нет — дописывается в существующий раздел.
    #[test]
    fn missing_key_is_added_to_existing_table() {
        let source = "[appearance]\ntheme = \"dark\"\n";

        let out = set(source, &["appearance", "density"], &Setting::Text("compact".into())).unwrap();

        assert!(out.contains("theme = \"dark\""));
        assert!(out.contains("density = \"compact\""));
    }

    /// Раздела нет — создаётся, и файл остаётся разбираемым.
    #[test]
    fn missing_table_is_created() {
        let source = "schema = 1\n";

        let out = set(source, &["font", "ui", "size"], &Setting::Number(15)).unwrap();

        let parsed = crate::settings::parse(&out).expect("итог должен разбираться");
        assert_eq!(parsed.settings.font.ui.size, Some(15));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        // Раздел напечатан один раз и полным путём, а не двумя заголовками.
        assert_eq!(out.matches('[').count(), 1, "{out}");
    }

    /// Закомментированный ключ трогать нельзя: это пояснение в образце,
    /// а не выключенная настройка.
    #[test]
    fn commented_out_key_is_left_alone() {
        let source = "[font.ui]\n# Шрифт интерфейса.\n# family = \"Segoe UI\"\n";

        let out = set(source, &["font", "ui", "family"], &Setting::Text("Verdana".into())).unwrap();

        assert!(out.contains("# family = \"Segoe UI\""), "{out}");
        assert!(out.contains("family = \"Verdana\""), "{out}");
    }

    /// Битый файл не переписывается: мы не знаем, что в нём хотел сказать
    /// человек, и запись стёрла бы недописанное.
    #[test]
    fn broken_file_is_not_rewritten() {
        let error = set("это не toml = = =", &["appearance", "theme"], &Setting::Text("x".into()))
            .expect_err("должна быть ошибка");

        assert!(matches!(error, EditError::Parse(_)));
    }

    /// Ключ занят таблицей — правка отменяется, а не сносит таблицу.
    #[test]
    fn value_does_not_overwrite_a_table() {
        let source = "[appearance]\n[appearance.theme]\nx = 1\n";

        let error = set(source, &["appearance", "theme"], &Setting::Text("dark".into()))
            .expect_err("должна быть ошибка");

        assert_eq!(
            error,
            EditError::NotATable("appearance.theme".to_owned())
        );
    }

    /// Числа и признаки записываются своим типом, а не строкой.
    #[test]
    fn numbers_and_flags_keep_their_type() {
        let out = set("", &["font", "ui", "size"], &Setting::Number(17)).unwrap();
        assert!(out.contains("size = 17"), "{out}");

        let out = set("", &["x", "flag"], &Setting::Flag(true)).unwrap();
        assert!(out.contains("flag = true"), "{out}");
    }

    /// Убрать ключ — это «взять значение из темы», а не «записать пустую строку».
    #[test]
    fn unset_removes_the_key_and_keeps_the_rest() {
        let source = "[font.ui]\n# пояснение\nfamily = \"Verdana\"\nsize = 15\n";

        let out = unset(source, &["font", "ui", "family"]).unwrap();

        assert!(!out.contains("family = \"Verdana\""), "{out}");
        assert!(out.contains("size = 15"), "{out}");
        assert!(out.contains("# пояснение"), "{out}");
    }

    /// Убирать то, чего нет, — не ошибка: результат тот же, которого хотели.
    #[test]
    fn unset_of_a_missing_key_is_not_an_error() {
        let source = "schema = 1\n";
        assert_eq!(unset(source, &["font", "ui", "family"]).unwrap(), source);
    }

    /// Запись за записью не должна накапливать мусор: файл после двух правок
    /// выглядит так же, как после одной.
    #[test]
    fn repeated_writes_are_stable() {
        let source = "schema = 1\n\n[appearance]\ntheme = \"system\"\n";

        let once = set(source, &["appearance", "theme"], &Setting::Text("pine".into())).unwrap();
        let twice = set(&once, &["appearance", "theme"], &Setting::Text("pine".into())).unwrap();

        assert_eq!(once, twice);
    }

    /// Комментарий не теряется и когда убираемый ключ последний в разделе:
    /// приписать его следующему некому, значит остаётся у предыдущего.
    #[test]
    fn unset_keeps_the_comment_of_the_last_key() {
        let source = "[font.ui]
size = 15
# мой шрифт
family = \"Verdana\"
";

        let out = unset(source, &["font", "ui", "family"]).unwrap();

        assert!(out.contains("# мой шрифт"), "{out}");
        assert!(!out.contains("Verdana"), "{out}");
        // Файл обязан остаться разбираемым: комментарий в конце строки — это
        // комментарий, а не мусор.
        crate::settings::parse(&format!("schema = 1
{out}")).expect("итог должен разбираться");
    }

    /// Образец, который кладётся при первом запуске, правится без сюрпризов.
    #[test]
    fn default_template_can_be_edited() {
        let out = set(
            crate::settings::DEFAULT_TEMPLATE,
            &["appearance", "density"],
            &Setting::Text("compact".into()),
        )
        .unwrap();

        let parsed = crate::settings::parse(&out).expect("итог должен разбираться");
        assert_eq!(parsed.settings.appearance.density, crate::theme::Density::Compact);
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        // Пояснения образца на месте.
        assert!(out.contains("# Настройки ZeroNote."));
        assert!(out.contains("# Плотность интерфейса"));
    }

    /// Годная правка проходит проверку.
    #[test]
    fn verify_accepts_a_good_edit() {
        let before = "schema = 1\n[appearance]\ndensity = \"normal\"\n";
        let after = set(before, &["appearance", "density"], &Setting::Text("compact".into())).unwrap();
        assert_eq!(verify(before, &after), Ok(()));
    }

    /// Значение, верное по TOML, но неверное по смыслу, до файла не доходит —
    /// и отказ называет, что не так.
    #[test]
    fn verify_rejects_a_nonsense_value() {
        let before = "schema = 1\n[appearance]\ndensity = \"normal\"\n";
        let after = set(
            before,
            &["appearance", "density"],
            &Setting::Text("очень плотная".into()),
        )
        .expect("по TOML это верная правка");

        let error = verify(before, &after).expect_err("по смыслу правка негодна");
        assert!(error.contains("density"), "{error}");
    }

    /// Опечатка, сделанная руками в другом ключе, окно не запирает:
    /// до Р-248 одна такая строка делала все параметры только для чтения.
    #[test]
    fn verify_ignores_a_typo_that_was_already_there() {
        let before = "schema = 1\n[editor]\nwrapp = true\n[appearance]\ndensity = \"normal\"\n";
        let after = set(before, &["appearance", "density"], &Setting::Text("compact".into())).unwrap();
        assert_eq!(verify(before, &after), Ok(()));
    }

    /// Список пишется по строке на элемент и читается обратно тем же.
    #[test]
    fn list_is_written_one_item_per_line() {
        let source = "schema = 1\n";
        let items = Setting::List(vec!["md.bold".into(), "separator".into(), "path".into()]);

        let out = set(source, &["toolbar", "items"], &items).unwrap();

        assert!(out.contains("\n    \"md.bold\",\n"), "{out}");
        let parsed = crate::settings::parse(&out).expect("итог должен разбираться");
        assert_eq!(parsed.settings.toolbar.items, vec!["md.bold", "separator", "path"]);
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);

        // Второй раз тот же список — тот же файл: правка не копит пустоты.
        let again = set(&out, &["toolbar", "items"], &items).unwrap();
        assert_eq!(again, out);
    }
}
