//! Замена по проекту: что именно изменится в файлах (задача 88).
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

pub use matcher::Options;

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
    query: &str,
    replacement: &str,
    options: Options,
) -> (Vec<TextEdit>, Vec<Preview>) {
    let found = matcher::find_all(text, query, options);

    let edits = found
        .iter()
        .map(|hit| TextEdit {
            offset: hit.offset,
            // Что нашли, то и заменяем: без учёта регистра найденный кусок
            // не обязан совпадать с запросом ни буквами, ни длиной.
            was: text[hit.offset..hit.offset + hit.len].to_owned(),
            becomes: replacement.to_owned(),
        })
        .collect();

    let preview = found
        .iter()
        .take(PREVIEW_PER_FILE)
        .map(|hit| {
            let (line, text) = matcher::line_at(text, hit.offset, PREVIEW_LINE);
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
    query: &str,
    replacement: &str,
    options: Options,
    stop: &dyn Fn() -> bool,
) -> ReplacePlan {
    let mut plan = ReplacePlan::default();

    if query.is_empty() {
        return plan;
    }

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

        let (edits, preview) = edits_for(&raw.text, query, replacement, options);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> Options {
        Options::default()
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
        let (edits, _) = edits_for("План и план", "план", "дело", options());

        assert_eq!(edits.len(), 2);
        assert_eq!(edits[0].was, "План", "заменяется найденное, а не запрос");
        assert_eq!(edits[0].becomes, "дело");
    }

    /// Показывается не больше трёх строк из файла, но правятся все.
    #[test]
    fn preview_is_shorter_than_the_plan() {
        let text = "план\nплан\nплан\nплан\nплан\n";
        let (edits, preview) = edits_for(text, "план", "дело", options());

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
            "план",
            "дело",
            options(),
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
            "план",
            "дело",
            options(),
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
            "план",
            "дело",
            options(),
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
            "план",
            "дело",
            options(),
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

        let plan = scan(
            &candidates(&dir, &["файл.md"]),
            "",
            "дело",
            options(),
            &never(),
        );

        assert_eq!(plan.total, 0);
        assert_eq!(plan.scanned, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
