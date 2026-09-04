//! Переименование с обновлением ссылок: что именно придётся поправить.
//!
//! Решения Р-136 и Р-137. Здесь считается **план** — список файлов и правок
//! в них, — и считается он до того, как на диске что-то изменится. Сама
//! правка живёт в `fsx/link_edit.rs`: разделение не косметическое, план
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
use crate::model::root::RootId;

use super::graph;
use super::writer::path_key;

/// Одна замена в файле: где, что было и что станет.
///
/// `was` не для красоты: между показом плана и правкой файл могли изменить,
/// и запись вслепую по смещению испортила бы чужой текст. Перед правкой
/// байты сверяются.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEdit {
    /// Смещение цели ссылки в байтах от начала файла.
    pub offset: usize,
    pub was: String,
    pub becomes: String,
}

/// Что изменится в одном файле.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEdits {
    /// Путь файла **после** переименования: файл со ссылками может и сам
    /// лежать внутри переименовываемой папки.
    pub path: String,
    /// Путь внутри корня — его и показывают человеку.
    pub inside: String,
    pub edits: Vec<LinkEdit>,
}

/// План целиком.
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
fn moved_files(
    connection: &Connection,
    root_id: RootId,
    from: &str,
    to: &str,
) -> Result<Vec<Moved>, rusqlite::Error> {
    let mut statement =
        connection.prepare("SELECT path FROM files WHERE root_id = ?1")?;
    let rows = statement.query_map([root_id as i64], |row| row.get::<_, String>(0))?;

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
) -> Result<Vec<String>, rusqlite::Error> {
    let mut seen = BTreeMap::new();

    for file in moved {
        for back in graph::backlinks(connection, &file.old)? {
            seen.insert(path_key(Path::new(&back.path)), back.path);
        }
        if is_markdown(&file.old) {
            seen.insert(path_key(Path::new(&file.old)), file.old.clone());
        }
    }

    Ok(seen.into_values().collect())
}

/// Подменить в базе пути переехавших файлов — временно, внутри транзакции.
fn apply_moves(
    connection: &Connection,
    root_path: &str,
    moved: &[Moved],
) -> Result<(), rusqlite::Error> {
    let mut statement = connection.prepare(
        "UPDATE files SET path = ?1, path_key = ?2, rel_key = ?3, name_key = ?4
         WHERE path_key = ?5",
    )?;

    for file in moved {
        let relative = file
            .new
            .get(root_path.len()..)
            .map(|tail| tail.trim_start_matches(['\\', '/']))
            .unwrap_or(&file.new);
        let name_key = Path::new(&file.new)
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        statement.execute(rusqlite::params![
            file.new,
            path_key(Path::new(&file.new)),
            markdown::links::link_key(relative),
            name_key,
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
pub fn plan(
    connection: &mut Connection,
    root_id: RootId,
    root_path: &str,
    from: &str,
    to: &str,
) -> Result<RenamePlan, rusqlite::Error> {
    let moved = moved_files(connection, root_id, from, to)?;
    let by_old: BTreeMap<String, String> = moved
        .iter()
        .map(|m| (path_key(Path::new(&m.old)), m.new.clone()))
        .collect();

    let sources = candidate_sources(connection, &moved)?;

    // Содержимое файлов и разбор — до транзакции: чтение с диска внутри неё
    // держало бы блокировку базы дольше, чем нужно.
    let mut parsed: Vec<(String, String, markdown::Parsed)> = Vec::new();
    for source in &sources {
        let Some(raw) = read_text(Path::new(source)) else {
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
        for link in &links.links {
            let Some(found) = graph::resolve(connection, &link.target, source_old, root_id)?
            else {
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
    apply_moves(&transaction, root_path, &moved)?;

    let mut by_file: BTreeMap<String, Vec<LinkEdit>> = BTreeMap::new();
    for candidate in &candidates {
        let now = graph::resolve(
            &transaction,
            &candidate.was,
            &candidate.source_new,
            root_id,
        )?;

        // Ведёт туда же — трогать нечего. Это самый частый исход, и ради него
        // симуляция и затевалась: правится минимум.
        if now.is_some_and(|found| path_key(Path::new(&found.path)) == path_key(Path::new(&candidate.intended)))
        {
            continue;
        }

        let relative = candidate
            .intended
            .get(root_path.len()..)
            .map(|tail| tail.trim_start_matches(['\\', '/']))
            .unwrap_or(&candidate.intended);
        // Форма ссылки остаётся авторской: путь остаётся путём, имя — именем.
        // Иначе переименование папки заодно переписывало бы `[[работа/Планы]]`
        // в `[[Планы]]` — ссылка рабочая, но правка больше необходимой,
        // а мы правим чужой файл.
        let becomes = if candidate.was.contains(['/', '\\']) {
            graph::path_form(relative)
        } else {
            graph::link_text(
                &transaction,
                &candidate.intended,
                &candidate.source_new,
                root_id,
                relative,
            )?
        };

        if becomes == candidate.was {
            continue;
        }

        by_file
            .entry(candidate.source_new.clone())
            .or_default()
            .push(LinkEdit {
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
            let inside = path
                .get(root_path.len()..)
                .map(|tail| tail.trim_start_matches(['\\', '/']).to_owned())
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
fn read_text(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let raw = crate::text::document::read_raw(&bytes).ok()?;
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
