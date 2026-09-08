//! Обход файлов проекта: что в них найдено и что изменится (задачи 88, 89).
//!
//! Как и у переименования (Р-136), сначала считается **план** — список
//! файлов и правок в них, — и только потом, с согласия человека, правится
//! диск. Записью занимается `fsx::text_edit`, тот же самый код, что правит
//! ссылки: правка это тройка «где, что было, что станет», и кто её посчитал,
//! ей безразлично.
//!
//! Отличие от переименования одно, и оно про доверие. Там правились ссылки,
//! которые приложение само же и построило; здесь — произвольный текст,
//! набранный человеком, и совпадение может оказаться где угодно, включая
//! чужой код и чужие данные. Поэтому:
//!
//! * **смотрим ровно те файлы, в которых ищет поиск по проекту** — те, чьё
//!   содержимое прочитал индекс. Правило одно на обе стороны: чего поиск
//!   не находит, того замена не меняет;
//! * **файл, который не читается своей кодировкой без потерь, не правится**
//!   и называется отдельно. Запись такого файла обратно испортила бы его
//!   даже без всякой замены;
//! * **у плана есть предел** (`MAX_MATCHES`). Список, который человек
//!   не в состоянии просмотреть, не выполняет своего назначения, а «показать
//!   правки до записи» — единственное, что отличает замену от беды.

pub mod matcher;

use std::path::Path;

use crate::model::edit::TextEdit;
use crate::model::root::RootId;
use crate::text::document;

pub use matcher::{Matcher, Options};

use crate::index::query::{Hit, MARK_END, MARK_START};

/// Сколько строк показывать из одного файла.
const PREVIEW_PER_FILE: usize = 3;

/// Сколько знаков строки помещается в список.
const PREVIEW_LINE: usize = 100;

/// Больше этого числа совпадений замена не делает.
///
/// Не защита от нагрузки: двадцать тысяч правок применяются за секунды.
/// Это защита от бессмысленного согласия — список такой длины не читают,
/// а нажимают «да» не глядя.
pub const MAX_MATCHES: usize = 20_000;

/// Строка файла, попавшая под замену: что человек увидит в списке.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub line: u32,
    pub text: String,
}

/// Что изменится в одном файле.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFile {
    pub root_id: RootId,
    pub path: String,
    /// Путь внутри корня — его и показывают человеку.
    pub inside: String,
    pub edits: Vec<TextEdit>,
    /// Первые строки с совпадениями. Не все: файл бывает и с тысячей.
    pub preview: Vec<Preview>,
}

/// План целиком.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePlan {
    pub files: Vec<ReplaceFile>,
    /// Сколько совпадений всего. Считается здесь, чтобы фронтенд
    /// не пересчитывал то же самое ради подписи в диалоге.
    pub total: usize,
    /// Сколько файлов просмотрено.
    pub scanned: usize,
    /// Файлы с совпадениями, которые не читаются без потерь: их не трогаем,
    /// но и умолчать о них нельзя — человек ищет именно этот текст.
    pub lossy: Vec<String>,
    /// Обход прервали — плана нет, есть его начало.
    pub stopped: bool,
    /// Совпадений больше, чем `MAX_MATCHES`.
    pub overflow: bool,
}

/// Файл, который стоит просмотреть.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub root_id: RootId,
    pub path: String,
    pub inside: String,
}

/// Правки и строки для показа по одному тексту.
///
/// Отдельно от файловой системы: здесь считаются смещения, по которым потом
/// правится чужой файл, и проверять это надо на строке, а не на диске.
pub fn edits_for(
    text: &str,
    matcher: &Matcher,
    replacement: &str,
) -> (Vec<TextEdit>, Vec<Preview>) {
    let edits = matcher.edits(text, replacement);

    let preview = edits
        .iter()
        .take(PREVIEW_PER_FILE)
        .map(|edit| {
            let (line, text) = matcher::line_at(text, edit.offset, PREVIEW_LINE);
            Preview { line, text }
        })
        .collect();

    (edits, preview)
}

/// Просмотреть файлы и собрать план.
///
/// `stop` спрашивается перед каждым файлом: обход тысяч файлов обязан
/// прерываться сразу, а не после окончания (инвариант 6).
///
/// Файл, который не прочитался, молча пропускается: между индексацией
/// и заменой его могли удалить или запереть, и жаловаться на это человеку,
/// который просил заменить текст, незачем.
pub fn scan(
    candidates: &[Candidate],
    matcher: &Matcher,
    replacement: &str,
    stop: &dyn Fn() -> bool,
) -> ReplacePlan {
    let mut plan = ReplacePlan::default();

    for candidate in candidates {
        if stop() {
            plan.stopped = true;
            break;
        }

        // Инвариант 2. Правила игнорирования сюда такой файл не пустят,
        // но правила задаёт пользователь, а инвариант — мы.
        if crate::fsx::atomic_save::is_inside_obsidian(Path::new(&candidate.path)) {
            continue;
        }

        let Ok(bytes) = std::fs::read(&candidate.path) else {
            continue;
        };
        let Ok(raw) = document::read_raw(&bytes) else {
            continue;
        };

        plan.scanned += 1;

        let (edits, preview) = edits_for(&raw.text, matcher, replacement);
        if edits.is_empty() {
            continue;
        }

        if raw.lossy {
            plan.lossy.push(candidate.inside.clone());
            continue;
        }

        plan.total += edits.len();
        plan.files.push(ReplaceFile {
            root_id: candidate.root_id,
            path: candidate.path.clone(),
            inside: candidate.inside.clone(),
            edits,
            preview,
        });

        if plan.total > MAX_MATCHES {
            plan.overflow = true;
            break;
        }
    }

    // Порядок списка — алфавитный по пути внутри корня: человек ищет в нём
    // знакомое имя, а не самый большой файл.
    plan.files
        .sort_by_key(|file| file.inside.to_lowercase());
    plan.lossy.sort();

    plan
}

/// Что нашёл обход файлов (задача 89).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Search {
    /// Найденное — в том же виде, в каком его отдаёт индекс: панель рисует
    /// оба ответа одним кодом, и знать, кто их посчитал, ей незачем.
    pub hits: Vec<Hit>,
    pub scanned: usize,
    /// Обход прервали.
    pub stopped: bool,
    /// Файлов с совпадениями больше, чем показано.
    pub limited: bool,
}

/// Сколько знаков строки помещается в отрывок до совпадения и после него.
const LEAD: usize = 40;
const TAIL: usize = 120;

/// Найти файлы, в которых есть совпадение.
///
/// Второй путь поиска, рядом с индексом: FTS5 ищет слова и выражений
/// не умеет вовсе. Цена честная — это чтение файлов, — и потому обход идёт
/// в отдельном потоке и прерывается (инвариант 6).
pub fn find(
    candidates: &[Candidate],
    matcher: &Matcher,
    limit: usize,
    stop: &dyn Fn() -> bool,
) -> Search {
    let mut result = Search::default();

    for candidate in candidates {
        if stop() {
            result.stopped = true;
            break;
        }

        let Ok(bytes) = std::fs::read(&candidate.path) else {
            continue;
        };
        let Ok(raw) = document::read_raw(&bytes) else {
            continue;
        };

        result.scanned += 1;

        let Some(found) = matcher.find_all(&raw.text).into_iter().next() else {
            continue;
        };

        if result.hits.len() >= limit {
            // Дальше не идём: список длиннее человек всё равно не смотрит,
            // а каждый файл — это чтение с диска.
            result.limited = true;
            break;
        }

        result.hits.push(Hit {
            root_id: candidate.root_id,
            path: candidate.path.clone(),
            name: file_name(&candidate.path),
            snippet: snippet_for(&raw.text, found.offset, found.len),
        });
    }

    result
}

/// Имя файла из пути. Разделитель тут всегда свой, путь пришёл из индекса.
fn file_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_owned()
}

/// Отрывок строки с пометками вокруг совпадения.
///
/// Пометки те же, что у отрывка из FTS5 (управляющие знаки): панель разрезает
/// по ним и рисует подсветку сама, и делать для второго пути второй вид
/// отрывка значило бы завести второй разбор в интерфейсе.
fn snippet_for(text: &str, offset: usize, len: usize) -> String {
    // Границы строки, в которой лежит совпадение. Совпадение выражения может
    // и перешагнуть перенос — тогда в отрывок попадает его начало: строка
    // и есть единица показа.
    let start = text[..offset].rfind('\n').map_or(0, |at| at + 1);
    let end = text[offset..].find('\n').map_or(text.len(), |at| offset + at);
    let stop = (offset + len).min(end);

    let before = text[start..offset].trim_start_matches(['\r', ' ', '\t']);
    let hit = &text[offset..stop];
    let after = text[stop..end].trim_end_matches('\r');

    let lead = tail_chars(before, LEAD);
    let tail = head_chars(after, TAIL);

    format!(
        "{}{lead}{MARK_START}{hit}{MARK_END}{tail}{}",
        if lead.len() < before.len() { "…" } else { "" },
        if tail.len() < after.len() { "…" } else { "" },
    )
}

/// Последние `limit` знаков — по знакам, а не по байтам.
fn tail_chars(text: &str, limit: usize) -> &str {
    match text.char_indices().nth_back(limit.saturating_sub(1)) {
        Some((at, _)) if text.chars().count() > limit => &text[at..],
        _ => text,
    }
}

/// Первые `limit` знаков.
fn head_chars(text: &str, limit: usize) -> &str {
    match text.char_indices().nth(limit) {
        Some((at, _)) => &text[..at],
        None => text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn literal() -> Matcher {
        Matcher::build("план", Options::default()).unwrap()
    }

    fn find_with(query: &str) -> Matcher {
        Matcher::build(
            query,
            Options {
                expression: true,
                ..Options::default()
            },
        )
        .unwrap()
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-replace-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn candidates(dir: &Path, names: &[&str]) -> Vec<Candidate> {
        names
            .iter()
            .map(|name| Candidate {
                root_id: 1,
                path: dir.join(name).to_string_lossy().into_owned(),
                inside: (*name).to_owned(),
            })
            .collect()
    }

    fn never() -> impl Fn() -> bool {
        || false
    }

    #[test]
    fn edits_carry_what_was_found() {
        let (edits, _) = edits_for("План и план", &literal(), "дело");

        assert_eq!(edits.len(), 2);
        assert_eq!(edits[0].was, "План", "заменяется найденное, а не запрос");
        assert_eq!(edits[0].becomes, "дело");
    }

    /// Показывается не больше трёх строк из файла, но правятся все.
    #[test]
    fn preview_is_shorter_than_the_plan() {
        let text = "план\nплан\nплан\nплан\nплан\n";
        let (edits, preview) = edits_for(text, &literal(), "дело");

        assert_eq!(edits.len(), 5);
        assert_eq!(preview.len(), 3);
        assert_eq!(preview[2].line, 3);
    }

    #[test]
    fn scan_finds_files_with_matches() {
        let dir = temp_dir("scan");
        std::fs::write(dir.join("есть.md"), "тут есть план").unwrap();
        std::fs::write(dir.join("нет.md"), "тут ничего нет").unwrap();

        let plan = scan(
            &candidates(&dir, &["есть.md", "нет.md"]),
            &literal(),
            "дело",
            &never(),
        );

        assert_eq!(plan.scanned, 2);
        assert_eq!(plan.total, 1);
        assert_eq!(plan.files.len(), 1);
        assert_eq!(plan.files[0].inside, "есть.md");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Обход прерывается на первом же файле — и говорит об этом.
    #[test]
    fn scan_stops_when_asked() {
        let dir = temp_dir("stop");
        std::fs::write(dir.join("файл.md"), "план").unwrap();

        let plan = scan(
            &candidates(&dir, &["файл.md"]),
            &literal(),
            "дело",
            &|| true,
        );

        assert!(plan.stopped);
        assert_eq!(plan.scanned, 0);
        assert!(plan.files.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Файл в `.obsidian` в план не попадает никогда (инвариант 2).
    #[test]
    fn obsidian_is_never_planned() {
        let dir = temp_dir("obsidian");
        std::fs::create_dir_all(dir.join(".obsidian")).unwrap();
        std::fs::write(dir.join(".obsidian/app.json"), "план").unwrap();

        let plan = scan(
            &candidates(&dir, &[".obsidian/app.json"]),
            &literal(),
            "дело",
            &never(),
        );

        assert!(plan.files.is_empty());
        assert_eq!(plan.scanned, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Файл, который не читается без потерь, называется отдельно и не правится.
    #[test]
    fn lossy_file_is_named_but_not_planned() {
        let dir = temp_dir("lossy");
        // Метка порядка байтов закрывает вопрос о кодировке (файл объявлен
        // UTF-8), а 0xFF в UTF-8 недопустим ни в какой позиции. Так
        // получается файл, который читается с потерей: без метки определитель
        // отдал бы его однобайтовой кодировке и потерь бы не было.
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("план ".as_bytes());
        bytes.push(0xFF);
        std::fs::write(dir.join("битый.txt"), &bytes).unwrap();

        let plan = scan(
            &candidates(&dir, &["битый.txt"]),
            &literal(),
            "дело",
            &never(),
        );

        assert!(plan.files.is_empty(), "править такой файл нельзя");
        assert_eq!(plan.lossy, vec!["битый.txt".to_owned()], "но и молчать о нём нельзя");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_query_plans_nothing() {
        let dir = temp_dir("empty");
        std::fs::write(dir.join("файл.md"), "план").unwrap();

        let nothing = Matcher::build("", Options::default()).unwrap();
        let plan = scan(&candidates(&dir, &["файл.md"]), &nothing, "дело", &never());

        assert_eq!(plan.total, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Поиск обходом находит то, чего индекс не умеет: выражение.
    #[test]
    fn find_walks_files_with_an_expression() {
        let dir = temp_dir("find");
        std::fs::write(dir.join("код.rs"), "fn первая() {}\nfn вторая() {}\n").unwrap();
        std::fs::write(dir.join("текст.md"), "просто слова\n").unwrap();

        let result = find(
            &candidates(&dir, &["код.rs", "текст.md"]),
            &find_with(r"fn \w+\(\)"),
            20,
            &never(),
        );

        assert_eq!(result.scanned, 2);
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].name, "код.rs");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Отрывок помечен теми же знаками, что у индекса: панель одна на оба
    /// пути, и второго разбора отрывка в интерфейсе быть не должно.
    #[test]
    fn found_snippet_is_marked_like_the_index_one() {
        let dir = temp_dir("snippet");
        std::fs::write(dir.join("файл.md"), "первая строка\nвот тут план дел\n").unwrap();

        let result = find(&candidates(&dir, &["файл.md"]), &literal(), 20, &never());

        assert_eq!(result.hits.len(), 1);
        assert_eq!(
            result.hits[0].snippet,
            format!("вот тут {MARK_START}план{MARK_END} дел")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Список ограничен, и об этом сказано: обход длиннее стоит чтения
    /// с диска, а такой список всё равно не смотрят.
    #[test]
    fn find_stops_at_the_limit() {
        let dir = temp_dir("limit");
        for name in ["а.md", "б.md", "в.md"] {
            std::fs::write(dir.join(name), "план").unwrap();
        }

        let result = find(
            &candidates(&dir, &["а.md", "б.md", "в.md"]),
            &literal(),
            2,
            &never(),
        );

        assert_eq!(result.hits.len(), 2);
        assert!(result.limited);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_stops_when_asked() {
        let dir = temp_dir("find-stop");
        std::fs::write(dir.join("файл.md"), "план").unwrap();

        let result = find(&candidates(&dir, &["файл.md"]), &literal(), 20, &|| true);

        assert!(result.stopped);
        assert!(result.hits.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
