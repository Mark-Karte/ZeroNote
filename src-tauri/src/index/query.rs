//! Запрос к индексу.
//!
//! Ввод пользователя в запрос FTS5 не подставляется как есть, и это не только
//! про безопасность: у FTS5 свой язык запросов, и обычная скобка или дефис
//! в поисковой строке — синтаксическая ошибка, а не поиск скобки. Пользователь
//! ищет текст, а не пишет запрос, поэтому каждое слово оборачивается в кавычки.

use rusqlite::Connection;

use crate::model::root::RootId;

/// Чем в отрывке помечено совпадение.
///
/// Управляющие знаки, а не `<b>`: в текстах пользователя встречается что
/// угодно, включая разметку, и отличить свою метку от чужого текста надо
/// наверняка. Фронтенд разрезает отрывок по ним и рисует подсветку сам.
pub const MARK_START: &str = "\u{1}";
pub const MARK_END: &str = "\u{2}";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub root_id: RootId,
    pub path: String,
    pub name: String,
    /// Отрывок с пометками совпадений.
    pub snippet: String,
}

/// Превратить строку пользователя в запрос FTS5.
///
/// Каждое слово — кавычки и удвоение кавычек внутри; слова соединяются
/// неявным «и». Последнему слову дописывается звёздочка: человек, набравший
/// «метел», ждёт «метель», а не пустой список.
///
/// Пустая строка запросом не становится: `None` означает «искать нечего».
pub fn to_match_query(input: &str) -> Option<String> {
    let words: Vec<&str> = input.split_whitespace().collect();
    if words.is_empty() {
        return None;
    }

    let last = words.len() - 1;
    let mut parts = Vec::with_capacity(words.len());

    for (i, word) in words.iter().enumerate() {
        let escaped = word.replace('"', "\"\"");
        if i == last {
            parts.push(format!("\"{escaped}\"*"));
        } else {
            parts.push(format!("\"{escaped}\""));
        }
    }

    Some(parts.join(" "))
}

/// Найти файлы, содержащие все слова запроса.
///
/// `root_id` = `None` — искать во всех корнях сразу. Это и есть довод
/// за одну базу вместо файла на корень (Р-059): такой поиск — один запрос.
pub fn search(
    connection: &Connection,
    input: &str,
    root_id: Option<RootId>,
    limit: u32,
) -> Result<Vec<Hit>, rusqlite::Error> {
    let Some(query) = to_match_query(input) else {
        return Ok(Vec::new());
    };

    // Отрывок: 12 слов вокруг совпадения, многоточие по краям.
    // bm25 ранжирует по частоте слова в файле и редкости слова в проекте —
    // редкое слово весит больше частого, чего простой подсчёт не даёт.
    let sql = format!(
        "SELECT f.root_id, f.path, f.name,
                snippet(content, 0, '{MARK_START}', '{MARK_END}', '…', 12)
         FROM content
         JOIN files f ON f.id = content.rowid
         WHERE content MATCH ?1 {}
         ORDER BY bm25(content)
         LIMIT ?2",
        if root_id.is_some() {
            "AND f.root_id = ?3"
        } else {
            ""
        }
    );

    let mut statement = connection.prepare(&sql)?;

    let map = |row: &rusqlite::Row<'_>| {
        Ok(Hit {
            root_id: row.get::<_, i64>(0)? as RootId,
            path: row.get(1)?,
            name: row.get(2)?,
            snippet: row.get(3)?,
        })
    };

    let rows = match root_id {
        Some(id) => statement.query_map(
            rusqlite::params![query, limit as i64, id as i64],
            map,
        )?,
        None => statement.query_map(rusqlite::params![query, limit as i64], map)?,
    };

    let mut hits = Vec::new();
    for row in rows {
        hits.push(row?);
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{schema, writer};
    use std::path::{Path, PathBuf};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-query-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn with_files(dir: &Path, files: &[(&str, &str)]) -> Connection {
        let db = schema::open(&schema::index_path(dir)).unwrap();
        for (name, text) in files {
            let path = dir.join(name);
            std::fs::write(&path, text).unwrap();
            writer::index_file(&db, 1, dir, &path, 2 * 1024 * 1024).unwrap();
        }
        db
    }

    #[test]
    fn finds_a_word() {
        let dir = temp_dir("word");
        let db = with_files(
            &dir,
            &[
                ("первая.md", "сегодня была метель и ветер"),
                ("вторая.md", "завтра обещают солнце"),
            ],
        );

        let hits = search(&db, "метель", None, 20).unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "первая.md");
        assert!(hits[0].snippet.contains(MARK_START), "отрывок без пометки");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Несколько слов — это «и», а не «или»: иначе запрос из двух слов
    /// выдаёт больше, чем запрос из одного.
    #[test]
    fn several_words_narrow_the_search() {
        let dir = temp_dir("and");
        let db = with_files(
            &dir,
            &[
                ("обе.md", "метель и ветер вместе"),
                ("одна.md", "только ветер"),
            ],
        );

        let hits = search(&db, "метель ветер", None, 20).unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "обе.md");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Незаконченное слово должно находиться: человек ищет по мере набора.
    #[test]
    fn unfinished_word_matches_by_prefix() {
        let dir = temp_dir("prefix");
        let db = with_files(&dir, &[("файл.md", "сегодня была метель")]);

        assert_eq!(search(&db, "мете", None, 20).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Знаки, которые для FTS5 значат что-то своё, не должны ломать поиск.
    /// Пользователь ищет текст, а не пишет запрос.
    #[test]
    fn punctuation_does_not_break_the_query() {
        let dir = temp_dir("punct");
        let db = with_files(&dir, &[("файл.md", "функция main() возвращает ноль")]);

        for input in ["main()", "\"кавычки\"", "a-b", "NOT", "OR", "*"] {
            let result = search(&db, input, None, 20);
            assert!(result.is_ok(), "запрос «{input}» уронил поиск: {result:?}");
        }

        // И осмысленный случай ищется, а не просто не падает.
        assert_eq!(search(&db, "main()", None, 20).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_query_finds_nothing() {
        let dir = temp_dir("empty");
        let db = with_files(&dir, &[("файл.md", "текст")]);

        assert!(search(&db, "   ", None, 20).unwrap().is_empty());
        assert_eq!(to_match_query(""), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_can_be_limited_to_one_root() {
        let dir = temp_dir("root");
        let db = schema::open(&schema::index_path(&dir)).unwrap();

        for (root, name) in [(1u64, "первый.md"), (2, "второй.md")] {
            let path = dir.join(name);
            std::fs::write(&path, "общее слово метель").unwrap();
            writer::index_file(&db, root, &dir, &path, 2 * 1024 * 1024).unwrap();
        }

        assert_eq!(search(&db, "метель", None, 20).unwrap().len(), 2);
        let only = search(&db, "метель", Some(2), 20).unwrap();
        assert_eq!(only.len(), 1);
        assert_eq!(only[0].name, "второй.md");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn limit_is_respected() {
        let dir = temp_dir("limit");
        let mut files = Vec::new();
        for i in 0..10 {
            files.push((format!("файл-{i}.md"), "одинаковое слово метель"));
        }
        let borrowed: Vec<(&str, &str)> =
            files.iter().map(|(n, t)| (n.as_str(), *t)).collect();
        let db = with_files(&dir, &borrowed);

        assert_eq!(search(&db, "метель", None, 3).unwrap().len(), 3);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
