//! Переименование с обновлением ссылок: что именно придётся поправить.
//!
//! Решения Р-136 и Р-137. Здесь считается **план** — список файлов и правок
//! в них, — и считается он до того, как на диске что-то изменится. Сама
//! правка живёт в `fsx/text_edit.rs`: разделение не косметическое, план
//! показывается человеку и может быть отвергнут целиком.
//!
//! Способ расчёта не «заменить старое имя новым», а симуляция. Почему —
//! в Р-137: у ссылки без пути побеждает ближайший кандидат, близость считается
//! по общим частям пути, и переименование папки способно увести такую ссылку
//! в другую заметку, не тронув ни её саму, ни ту заметку. Вывести это
//! рассуждением можно, проверить нечем; поэтому переименование проигрывается
//! в откатываемой транзакции, и правится только то, что и правда разъехалось.

use std::collections::BTreeMap;
use std::path::Path;

use rusqlite::Connection;

use crate::markdown;
use crate::model::edit::{FileEdits, TextEdit};

use super::graph;
use super::scope::{Scopes, escape_like};
use super::writer::{keys, path_key};

/// План целиком.
///
/// Пути файлов в `files` — те, по которым файлы окажутся **после**
/// переименования: файл со ссылками может и сам лежать внутри
/// переименовываемой папки.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePlan {
    /// Куда переедет сам переименовываемый файл или папка.
    pub target: String,
    pub files: Vec<FileEdits>,
    /// Сколько ссылок будет исправлено. Считается здесь, чтобы фронтенд
    /// не пересчитывал то же самое ради подписи в диалоге.
    pub links: usize,
}

/// Файл, попавший под переименование: где лежал и где будет лежать.
struct Moved {
    old: String,
    new: String,
}

/// Куда переедет путь, если его начало заменить.
///
/// Сравнение по приведённому ключу, а не побайтно: путь корня приходит
/// из реестра, путь файла — из базы, и совпадать по регистру они не обязаны.
fn moved_path(path: &str, from: &str, to: &str) -> Option<String> {
    let key = path_key(Path::new(path));
    let from_key = path_key(Path::new(from));

    if key == from_key {
        return Some(to.to_owned());
    }
    // Именно с разделителем: папка `работа` не должна ловить `работа-старое`.
    let prefix = format!("{from_key}\\");
    if key.starts_with(&prefix) {
        return Some(format!("{to}{}", &path[from.len()..]));
    }
    None
}

/// Все проиндексированные файлы, которые переедут вместе с переименованием.
///
/// По пути, а не по номеру корня (задача 140): при вложенных корнях файл
/// мог проиндексировать внешний корень, и отбор по номеру вложенного
/// давал пустой план — ссылки ломались без вопроса.
fn moved_files(connection: &Connection, from: &str, to: &str) -> Result<Vec<Moved>, rusqlite::Error> {
    let from_key = path_key(Path::new(from));
    // Разделитель экранируется вместе с путём: голый `\%` при `ESCAPE '\'`
    // означал бы буквальный знак процента, а не «всё внутри папки».
    let inside = format!("{}%", escape_like(&format!("{from_key}\\")));
    let mut statement = connection
        .prepare("SELECT path FROM files WHERE path_key = ?1 OR path_key LIKE ?2 ESCAPE '\\'")?;
    let rows = statement.query_map(rusqlite::params![from_key, inside], |row| {
        row.get::<_, String>(0)
    })?;

    let mut out = Vec::new();
    for row in rows {
        let path = row?;
        if let Some(new) = moved_path(&path, from, to) {
            out.push(Moved { old: path, new });
        }
    }
    Ok(out)
}

/// Ссылка-кандидат: где она лежит и куда ведёт сейчас.
struct Candidate {
    /// Путь файла со ссылкой после переименования.
    source_new: String,
    offset: usize,
    was: String,
    /// Куда ссылка ведёт сейчас, уже переведённое в новый мир.
    intended: String,
}

/// Разбирается ли этот файл на ссылки. Правило то же, что у индекса (Р-069).
fn is_markdown(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .is_some_and(|e| matches!(e.as_str(), "md" | "markdown" | "mdx"))
}

/// Файлы, в которых стоит искать ссылки на переезжающие заметки.
///
/// Обратные ссылки сужают круг, но не отвечают на вопрос целиком: у файла,
/// который переезжает сам, меняется его собственный путь, а значит и то,
/// какая заметка к нему ближе. Поэтому переезжающие тоже идут в кандидаты.
fn candidate_sources(
    connection: &Connection,
    moved: &[Moved],
    scopes: &Scopes,
) -> Result<Vec<String>, rusqlite::Error> {
    let mut seen = BTreeMap::new();

    for file in moved {
        for back in graph::backlinks(connection, &file.old, scopes)? {
            seen.insert(path_key(Path::new(&back.path)), back.path);
        }
        if is_markdown(&file.old) {
            seen.insert(path_key(Path::new(&file.old)), file.old.clone());
        }
    }

    Ok(seen.into_values().collect())
}

/// Подменить в базе пути переехавших файлов — временно, внутри транзакции.
///
/// Вместе с путём — оба имени: и без расширения, и целиком. Без второго
/// симуляция отвечала бы на `![[рисунок.png]]` старым именем.
fn apply_moves(connection: &Connection, moved: &[Moved]) -> Result<(), rusqlite::Error> {
    let mut statement = connection.prepare(
        "UPDATE files SET path = ?1, path_key = ?2, name_key = ?3, file_key = ?4
         WHERE path_key = ?5",
    )?;

    for file in moved {
        let (name_key, file_key) = keys(Path::new(&file.new));
        statement.execute(rusqlite::params![
            file.new,
            path_key(Path::new(&file.new)),
            name_key,
            file_key,
            path_key(Path::new(&file.old)),
        ])?;
    }
    Ok(())
}

/// Собрать план переименования.
///
/// `from` и `to` — старый и новый путь переименовываемого файла или папки.
/// Читаются файлы с диска, а не содержимое индекса: смещения ссылок должны
/// указывать в те самые байты, которые будут правиться.
///
/// `scopes` — все корни (задача 140): каждая ссылка разрешается в области
/// своего файла, и при вложенных корнях на переименовываемое ссылаются
/// из обеих — из внешней папки путём от неё, из вложенной — от вложенной.
pub fn plan(
    connection: &mut Connection,
    scopes: &Scopes,
    from: &str,
    to: &str,
    hint: Option<crate::text::encoding::Encoding>,
) -> Result<RenamePlan, rusqlite::Error> {
    let moved = moved_files(connection, from, to)?;
    let by_old: BTreeMap<String, String> = moved
        .iter()
        .map(|m| (path_key(Path::new(&m.old)), m.new.clone()))
        .collect();

    let sources = candidate_sources(connection, &moved, scopes)?;

    // Содержимое файлов и разбор — до транзакции: чтение с диска внутри неё
    // держало бы блокировку базы дольше, чем нужно.
    let mut parsed: Vec<(String, String, markdown::Parsed)> = Vec::new();
    for source in &sources {
        let Some(raw) = read_text(Path::new(source), hint) else {
            continue;
        };
        let links = markdown::parse(&raw);
        if links.links.is_empty() {
            continue;
        }
        let source_new = by_old
            .get(&path_key(Path::new(source)))
            .cloned()
            .unwrap_or_else(|| source.clone());
        parsed.push((source.clone(), source_new, links));
    }

    // Разрешение «до»: куда каждая ссылка ведёт сейчас.
    let mut candidates: Vec<Candidate> = Vec::new();
    for (source_old, source_new, links) in &parsed {
        let Some(scope) = scopes.for_path(source_old) else {
            continue;
        };
        for link in &links.links {
            let Some(found) = graph::resolve(connection, &link.target, source_old, scope)? else {
                // Висячая ссылка висячей и останется — чинить в ней нечего.
                continue;
            };
            let intended = by_old
                .get(&path_key(Path::new(&found.path)))
                .cloned()
                .unwrap_or(found.path);

            candidates.push(Candidate {
                source_new: source_new.clone(),
                offset: link.target_span.0,
                was: link.target.clone(),
                intended,
            });
        }
    }

    // Разрешение «после» — в откатываемой транзакции (Р-137). Соединение
    // с индексом одно и под мьютексом, поэтому подмены никто не увидит.
    let transaction = connection.transaction()?;
    apply_moves(&transaction, &moved)?;

    let mut by_file: BTreeMap<String, Vec<TextEdit>> = BTreeMap::new();
    for candidate in &candidates {
        let Some(scope) = scopes.for_path(&candidate.source_new) else {
            continue;
        };
        let now = graph::resolve(&transaction, &candidate.was, &candidate.source_new, scope)?;

        // Ведёт туда же — трогать нечего. Это самый частый исход, и ради него
        // симуляция и затевалась: правится минимум.
        if now.is_some_and(|found| path_key(Path::new(&found.path)) == path_key(Path::new(&candidate.intended)))
        {
            continue;
        }

        // Путь для текста ссылки — от корня её области: именно от него
        // ссылка и будет разрешаться. Цель вне области — ссылкой её
        // не выразить, и такую правку не предлагаем.
        let Some(relative) = scope.relative(&candidate.intended) else {
            continue;
        };
        // Форма ссылки остаётся авторской: путь остаётся путём, имя — именем.
        // Иначе переименование папки заодно переписывало бы `[[работа/Планы]]`
        // в `[[Планы]]` — ссылка рабочая, но правка больше необходимой,
        // а мы правим чужой файл.
        let becomes = if candidate.was.contains(['/', '\\']) {
            graph::path_form(&relative)
        } else {
            graph::link_text(
                &transaction,
                &candidate.intended,
                &candidate.source_new,
                scope,
                &relative,
            )?
        };

        if becomes == candidate.was {
            continue;
        }

        by_file
            .entry(candidate.source_new.clone())
            .or_default()
            .push(TextEdit {
                offset: candidate.offset,
                was: candidate.was.clone(),
                becomes,
            });
    }

    transaction.rollback()?;

    let mut files: Vec<FileEdits> = by_file
        .into_iter()
        .map(|(path, mut edits)| {
            // По возрастанию смещения: правка идёт с конца, и порядок должен
            // быть известен, а не унаследован от порядка разбора.
            edits.sort_by_key(|edit| edit.offset);
            let inside = scopes
                .for_path(&path)
                .and_then(|scope| scope.relative(&path))
                .unwrap_or_else(|| path.clone());
            FileEdits { path, inside, edits }
        })
        .collect();
    files.sort_by(|a, b| a.inside.cmp(&b.inside));

    let links = files.iter().map(|file| file.edits.len()).sum();
    Ok(RenamePlan {
        target: to.to_owned(),
        files,
        links,
    })
}

/// Прочитать файл как текст, не трогая переносы строк.
///
/// `None` — файл не читается или не является текстом: он просто не попадёт
/// в план, и это правильнее, чем уронить всю операцию.
///
/// Кодировка — с подсказкой проекта, как при открытии (задача 138): смещения
/// плана указывают в тот текст, в который потом впишется правка.
fn read_text(path: &Path, hint: Option<crate::text::encoding::Encoding>) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let raw = crate::text::document::read_raw(&bytes, hint).ok()?;
    // Файл, который не раскодировался без потерь, править нельзя: обратная
    // запись не восстановит его байты (Р-136).
    if raw.lossy {
        return None;
    }
    Some(raw.text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moved_path_catches_the_file_itself() {
        assert_eq!(
            moved_path(r"C:\п\Планы.md", r"C:\п\Планы.md", r"C:\п\Задачи.md"),
            Some(r"C:\п\Задачи.md".to_owned())
        );
    }

    #[test]
    fn moved_path_catches_everything_inside_a_folder() {
        assert_eq!(
            moved_path(r"C:\п\работа\Планы.md", r"C:\п\работа", r"C:\п\дела"),
            Some(r"C:\п\дела\Планы.md".to_owned())
        );
    }

    /// Соседняя папка с похожим именем переезжать не должна.
    ///
    /// Без разделителя в проверке `работа` поймала бы и `работа-старое`,
    /// и переименование одной папки переписало бы пути в другой.
    #[test]
    fn moved_path_does_not_catch_a_similar_name() {
        assert_eq!(
            moved_path(r"C:\п\работа-старое\Планы.md", r"C:\п\работа", r"C:\п\дела"),
            None
        );
    }

    /// Windows не различает регистр путей, и база с реестром корней могут
    /// хранить их по-разному.
    #[test]
    fn moved_path_ignores_case() {
        assert_eq!(
            moved_path(r"C:\П\Работа\Планы.md", r"c:\п\работа", r"C:\п\дела"),
            Some(r"C:\п\дела\Планы.md".to_owned())
        );
    }
}
