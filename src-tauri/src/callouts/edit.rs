//! Правка `callouts.toml` из окна параметров.
//!
//! Тот же принцип, что у настроек (Р-089): файл правится, а не
//! пересобирается, — комментарии образца и порядок записей остаются
//! на месте, меняется ровно одна запись.

use toml_edit::{ArrayOfTables, DocumentMut, Item, Table, value};

use super::{Callout, parse, valid_color, valid_id};

/// Найти запись по типу. Сравнение без регистра: так читает разбор.
fn position(list: &ArrayOfTables, id: &str) -> Option<usize> {
    list.iter().position(|table| {
        table
            .get("id")
            .and_then(|item| item.as_str())
            .is_some_and(|known| known.trim().to_lowercase() == id)
    })
}

/// Список записей; нет — пустой. Раздел не списком — отказ: чинить такое
/// за человека мы не будем.
fn entries(document: &mut DocumentMut) -> Result<&mut ArrayOfTables, String> {
    if !document.contains_key("callout") {
        document.insert("callout", Item::ArrayOfTables(ArrayOfTables::new()));
    }
    document["callout"]
        .as_array_of_tables_mut()
        .ok_or_else(|| "в callouts.toml «callout» записан не списком [[callout]]".to_owned())
}

/// Записать коллаут: новый — в конец, существующий (по типу `original`) —
/// на своё место.
///
/// Тип можно сменить; тогда новый не должен совпадать с чужим — иначе
/// один из двух не рисовался бы никогда.
pub fn upsert(source: &str, original: Option<&str>, callout: &Callout) -> Result<String, String> {
    let id = callout.id.trim().to_lowercase();
    if !valid_id(&id) {
        return Err("тип коллаута не может быть пустым, содержать пробел или скобки".to_owned());
    }
    if !valid_color(&callout.color) {
        return Err(format!(
            "«{}» — не роль темы и не цвет вида #rrggbb",
            callout.color
        ));
    }

    let mut document: DocumentMut = source
        .parse()
        .map_err(|e: toml_edit::TomlError| format!("callouts.toml не разбирается: {e}"))?;
    let list = entries(&mut document)?;

    let original = original.map(|id| id.trim().to_lowercase());
    let here = original.as_deref().and_then(|id| position(list, id));

    if let Some(other) = position(list, &id)
        && Some(other) != here
    {
        return Err(format!("коллаут с типом «{id}» уже есть"));
    }

    let table: &mut Table = match here {
        Some(index) => list.get_mut(index).expect("позиция найдена в этом же списке"),
        None => {
            list.push(Table::new());
            let last = list.len() - 1;
            list.get_mut(last).expect("запись только что добавлена")
        }
    };

    // Ключи по одному, а не заменой таблицы: у записи могут быть
    // комментарии, и замена стёрла бы их.
    table["id"] = value(id.as_str());
    table["title"] = value(callout.title.as_str());
    table["icon"] = value(callout.icon.as_str());
    table["color"] = value(callout.color.as_str());

    let out = document.to_string();
    verify(source, &out)?;
    Ok(out)
}

/// Убрать коллаут. Нет такого — ничего не меняется.
pub fn remove(source: &str, id: &str) -> Result<String, String> {
    let mut document: DocumentMut = source
        .parse()
        .map_err(|e: toml_edit::TomlError| format!("callouts.toml не разбирается: {e}"))?;
    let list = entries(&mut document)?;

    let id = id.trim().to_lowercase();
    if let Some(index) = position(list, &id) {
        list.remove(index);
    }
    Ok(document.to_string())
}

/// Итог обязан читаться и не добавлять новых жалоб — то же правило,
/// что у правки настроек (`settings::edit::verify`).
fn verify(before: &str, after: &str) -> Result<(), String> {
    let known = parse(before).map(|loaded| loaded.problems).unwrap_or_default();
    let loaded = parse(after).map_err(|e| e.to_string())?;
    match loaded.problems.into_iter().find(|problem| !known.contains(problem)) {
        Some(problem) => Err(problem),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::callouts::DEFAULT_TEMPLATE;

    fn callout(id: &str, title: &str, color: &str) -> Callout {
        Callout {
            id: id.to_owned(),
            title: title.to_owned(),
            icon: "md.callout-note".to_owned(),
            color: color.to_owned(),
        }
    }

    /// Правка одной записи оставляет остальной файл как был — комментарии
    /// образца на месте.
    #[test]
    fn editing_keeps_the_comments_and_the_rest() {
        let out = upsert(DEFAULT_TEMPLATE, Some("tip"), &callout("tip", "Совет дня", "success")).unwrap();

        assert!(out.contains("# Коллауты ZeroNote."));
        let loaded = parse(&out).unwrap();
        assert_eq!(loaded.callouts.len(), 27);
        let tip = loaded.callouts.iter().find(|c| c.id == "tip").unwrap();
        assert_eq!(tip.title, "Совет дня");
        assert_eq!(tip.color, "success");
        // Порядок не изменился: «tip» стоит на своём месте.
        assert_eq!(loaded.callouts[6].id, "tip");
    }

    #[test]
    fn new_callout_goes_to_the_end() {
        let out = upsert(DEFAULT_TEMPLATE, None, &callout("идея", "Идея", "#ff8800")).unwrap();
        let loaded = parse(&out).unwrap();
        assert_eq!(loaded.callouts.last().unwrap().id, "идея");
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
    }

    #[test]
    fn works_on_an_empty_file() {
        let out = upsert("", None, &callout("tip", "Совет", "accent")).unwrap();
        assert_eq!(parse(&out).unwrap().callouts.len(), 1);
    }

    /// Смена типа на чужой отвергается: один из двух не рисовался бы никогда.
    #[test]
    fn renaming_onto_another_type_is_refused() {
        let error = upsert(DEFAULT_TEMPLATE, Some("tip"), &callout("note", "Совет", "accent"))
            .expect_err("тип «note» уже занят");
        assert!(error.contains("note"), "{error}");
    }

    #[test]
    fn renaming_keeps_the_place() {
        let out = upsert(DEFAULT_TEMPLATE, Some("tip"), &callout("совет", "Совет", "accent")).unwrap();
        let loaded = parse(&out).unwrap();
        assert_eq!(loaded.callouts[6].id, "совет");
        assert!(!loaded.callouts.iter().any(|c| c.id == "tip"));
    }

    #[test]
    fn bad_type_and_color_are_refused_before_writing() {
        assert!(upsert("", None, &callout("два слова", "", "accent")).is_err());
        assert!(upsert("", None, &callout("мой", "", "оранжевый")).is_err());
    }

    #[test]
    fn removal_takes_out_one_entry() {
        let out = remove(DEFAULT_TEMPLATE, "bug").unwrap();
        let loaded = parse(&out).unwrap();
        assert_eq!(loaded.callouts.len(), 26);
        assert!(!loaded.callouts.iter().any(|c| c.id == "bug"));
    }
}
