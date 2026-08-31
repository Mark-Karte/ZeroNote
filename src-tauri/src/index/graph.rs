//! Разрешение ссылок и обратные ссылки.
//!
//! Правила наши (Р-022, пункт 3) и записаны здесь явно:
//!
//! 1. Цель с косой чертой — путь от корня.
//! 2. Иначе — имя файла без расширения, без учёта регистра.
//! 3. Иначе — псевдоним из frontmatter.
//! 4. Несколько кандидатов — побеждает ближайший к ссылающемуся файлу,
//!    при равной близости — с более коротким путём.
//! 5. Не нашлось — ссылка висячая.
//!
//! Ссылки не разрешаются при записи в индекс, только при запросе. Заметка,
//! на которую ссылались, могла ещё не появиться; появившись, она делает
//! висячую ссылку рабочей. Разрешение при запросе отвечает по нынешнему
//! состоянию проекта, а не по тому, каким оно было в момент индексации.

use rusqlite::Connection;

use crate::markdown::links::link_key;
use crate::model::root::RootId;

/// Файл-кандидат при разрешении ссылки.
#[derive(Debug, Clone)]
struct Candidate {
    id: i64,
    path: String,
}

/// Куда ведёт ссылка.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub path: String,
    pub name: String,
}

/// Одна обратная ссылка: кто и как сослался.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub root_id: RootId,
    pub path: String,
    pub name: String,
    /// Как ссылка записана в тексте — вместе с разделом и подписью.
    pub text: String,
    /// Вставка `![[...]]`, а не обычная ссылка.
    pub embed: bool,
}

/// Разбить путь на части в нижнем регистре — для сравнения близости.
fn parts(path: &str) -> Vec<String> {
    path.to_lowercase()
        .split(['\\', '/'])
        .filter(|p| !p.is_empty())
        .map(|p| p.to_owned())
        .collect()
}

/// Сколько начальных частей пути общие у двух файлов.
///
/// Чем больше, тем ближе файл к ссылающемуся — и тем вероятнее, что имелся
/// в виду именно он. Так же выбирает Obsidian, и ожидание пользователя именно
/// такое: `[[Задачи]]` из папки «работа» ведёт в «работа/Задачи», а не
/// в «личное/Задачи».
fn shared_prefix(a: &[String], b: &[String]) -> usize {
    a.iter().zip(b.iter()).take_while(|(x, y)| x == y).count()
}

/// Выбрать лучшего кандидата относительно ссылающегося файла.
fn nearest(mut candidates: Vec<Candidate>, from: &str) -> Option<Candidate> {
    if candidates.len() <= 1 {
        return candidates.pop();
    }

    let source = parts(from);
    candidates.sort_by(|a, b| {
        let near_a = shared_prefix(&parts(&a.path), &source);
        let near_b = shared_prefix(&parts(&b.path), &source);

        near_b
            .cmp(&near_a)
            .then_with(|| a.path.len().cmp(&b.path.len()))
            // Последний рубеж, чтобы порядок не зависел от порядка строк
            // в базе: одинаковые по близости и длине пути должны выбираться
            // одинаково от запроса к запросу.
            .then_with(|| a.path.cmp(&b.path))
    });
    candidates.into_iter().next()
}

fn query_candidates(
    connection: &Connection,
    sql: &str,
    key: &str,
    root_id: RootId,
) -> Result<Vec<Candidate>, rusqlite::Error> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map(rusqlite::params![key, root_id as i64], |row| {
        Ok(Candidate {
            id: row.get(0)?,
            path: row.get(1)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Найти файл, на который указывает цель ссылки.
///
/// `from` — путь ссылающегося файла: по нему выбирается ближайший кандидат.
fn resolve_id(
    connection: &Connection,
    target: &str,
    from: &str,
    root_id: RootId,
) -> Result<Option<Candidate>, rusqlite::Error> {
    let key = link_key(target);
    if key.is_empty() {
        return Ok(None);
    }

    // Путь от корня — если в цели есть косая черта, имя файла тут ни при чём.
    if key.contains('/') {
        let by_path = query_candidates(
            connection,
            "SELECT id, path FROM files WHERE rel_key = ?1 AND root_id = ?2",
            &key,
            root_id,
        )?;
        return Ok(nearest(by_path, from));
    }

    let by_name = query_candidates(
        connection,
        "SELECT id, path FROM files WHERE name_key = ?1 AND root_id = ?2",
        &key,
        root_id,
    )?;
    if let Some(found) = nearest(by_name, from) {
        return Ok(Some(found));
    }

    // Псевдоним из frontmatter — последняя попытка: имя файла главнее.
    let by_alias = query_candidates(
        connection,
        "SELECT f.id, f.path FROM aliases a
         JOIN files f ON f.id = a.file_id
         WHERE a.alias_key = ?1 AND f.root_id = ?2",
        &key,
        root_id,
    )?;
    Ok(nearest(by_alias, from))
}

/// Куда ведёт ссылка. `None` — ссылка висячая.
pub fn resolve(
    connection: &Connection,
    target: &str,
    from: &str,
    root_id: RootId,
) -> Result<Option<Resolved>, rusqlite::Error> {
    let Some(found) = resolve_id(connection, target, from, root_id)? else {
        return Ok(None);
    };

    let name = std::path::Path::new(&found.path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    Ok(Some(Resolved {
        path: found.path,
        name,
    }))
}

/// Кто ссылается на этот файл.
///
/// Берутся ссылки, чья цель совпадает с одним из имён файла, — а затем каждая
/// разрешается по-настоящему. Без второго шага `[[Задачи]]` из другой папки
/// попал бы в обратные ссылки заметки, на которую он не ведёт.
pub fn backlinks(
    connection: &Connection,
    path: &str,
) -> Result<Vec<Backlink>, rusqlite::Error> {
    let Some((file_id, root_id, rel_key, name_key)) = file_keys(connection, path)? else {
        return Ok(Vec::new());
    };

    let mut keys = vec![rel_key, name_key];

    let mut statement =
        connection.prepare("SELECT alias_key FROM aliases WHERE file_id = ?1")?;
    let aliases = statement.query_map([file_id], |row| row.get::<_, String>(0))?;
    for alias in aliases {
        keys.push(alias?);
    }
    keys.retain(|k| !k.is_empty());
    keys.sort();
    keys.dedup();

    if keys.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = vec!["?"; keys.len()].join(", ");
    let sql = format!(
        "SELECT f.id, f.root_id, f.path, f.name, l.target_raw, l.heading, l.alias, l.embed
         FROM links l
         JOIN files f ON f.id = l.source_id
         WHERE l.target_key IN ({placeholders}) AND f.root_id = ?{}",
        keys.len() + 1
    );

    let mut params: Vec<Box<dyn rusqlite::ToSql>> = keys
        .iter()
        .map(|k| Box::new(k.clone()) as Box<dyn rusqlite::ToSql>)
        .collect();
    params.push(Box::new(root_id as i64));

    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(rusqlite::params_from_iter(params.iter()), |row| {
        Ok((
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, i64>(7)? != 0,
        ))
    })?;

    let mut out = Vec::new();
    for row in rows {
        let (source_path, name, target_raw, heading, alias, embed) = row?;

        // Ссылка могла разрешиться не в наш файл: в проекте бывают две
        // заметки с одним именем в разных папках.
        let resolved = resolve_id(connection, &target_raw, &source_path, root_id)?;
        if resolved.map(|c| c.id) != Some(file_id) {
            continue;
        }

        let mut text = target_raw;
        if let Some(heading) = heading {
            text.push('#');
            text.push_str(&heading);
        }
        if let Some(alias) = alias {
            text.push('|');
            text.push_str(&alias);
        }

        out.push(Backlink {
            root_id,
            path: source_path,
            name,
            text,
            embed,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.path.cmp(&b.path)));
    Ok(out)
}

/// Найти файл в индексе по пути.
///
/// Путь сверяется не побайтно. Windows не различает регистр и принимает обе
/// косые черты, а путь приходит откуда угодно: из дерева, из редактора, из
/// буфера обмена. Требовать точного совпадения с тем видом, в котором путь
/// попал в базу, значило бы отвечать «такого файла нет» на файл, который
/// открыт прямо сейчас.
fn file_keys(
    connection: &Connection,
    path: &str,
) -> Result<Option<(i64, RootId, String, String)>, rusqlite::Error> {
    use rusqlite::OptionalExtension;

    let normalized = crate::index::writer::path_key(std::path::Path::new(path));

    connection
        .query_row(
            "SELECT id, root_id, rel_key, name_key FROM files WHERE path_key = ?1",
            [normalized],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)? as RootId,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
}

/// Файл, помеченный тегом.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tagged {
    pub root_id: RootId,
    pub path: String,
    pub name: String,
}

/// Файлы с этим тегом. Вложенные теги считаются: `#работа` находит
/// и `#работа/срочное` — так же считает Obsidian.
pub fn files_with_tag(
    connection: &Connection,
    tag: &str,
    limit: u32,
) -> Result<Vec<Tagged>, rusqlite::Error> {
    let tag = crate::markdown::links::normalize_tag(tag);
    if tag.is_empty() {
        return Ok(Vec::new());
    }

    let mut statement = connection.prepare(
        "SELECT DISTINCT f.root_id, f.path, f.name
         FROM tags t JOIN files f ON f.id = t.file_id
         WHERE t.tag = ?1 OR t.tag LIKE ?2
         ORDER BY f.name
         LIMIT ?3",
    )?;

    let rows = statement.query_map(
        rusqlite::params![tag, format!("{tag}/%"), limit as i64],
        |row| {
            Ok(Tagged {
                root_id: row.get::<_, i64>(0)? as RootId,
                path: row.get(1)?,
                name: row.get(2)?,
            })
        },
    )?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_prefers_the_closer_folder() {
        let candidates = vec![
            Candidate {
                id: 1,
                path: r"C:\п\личное\Задачи.md".to_owned(),
            },
            Candidate {
                id: 2,
                path: r"C:\п\работа\Задачи.md".to_owned(),
            },
        ];

        let chosen = nearest(candidates, r"C:\п\работа\Планы.md").unwrap();

        assert_eq!(chosen.id, 2);
    }

    /// При равной близости побеждает более короткий путь: он «выше»
    /// в дереве, и это ожидаемее.
    #[test]
    fn equal_distance_prefers_shorter_path() {
        let candidates = vec![
            Candidate {
                id: 1,
                path: r"C:\п\а\б\Заметка.md".to_owned(),
            },
            Candidate {
                id: 2,
                path: r"C:\п\Заметка.md".to_owned(),
            },
        ];

        let chosen = nearest(candidates, r"C:\п\другое\Файл.md").unwrap();

        assert_eq!(chosen.id, 2);
    }

    /// Порядок кандидатов из базы не гарантирован, а ответ обязан быть
    /// одним и тем же от запроса к запросу.
    #[test]
    fn choice_does_not_depend_on_input_order() {
        let make = || {
            vec![
                Candidate {
                    id: 1,
                    path: r"C:\п\а\Заметка.md".to_owned(),
                },
                Candidate {
                    id: 2,
                    path: r"C:\п\б\Заметка.md".to_owned(),
                },
            ]
        };

        let first = nearest(make(), r"C:\п\Файл.md").unwrap();
        let mut reversed = make();
        reversed.reverse();
        let second = nearest(reversed, r"C:\п\Файл.md").unwrap();

        assert_eq!(first.id, second.id);
    }
}
