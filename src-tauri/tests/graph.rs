//! Связи между заметками на настоящем хранилище.
//!
//! Модульные тесты в `src/markdown/` разбирают текст, `src/index/graph.rs` —
//! выбор ближайшего кандидата. Здесь то, что видно только целиком: ссылка,
//! проехавшая через разбор, индекс и разрешение, приводит в тот файл,
//! в который должна.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use zeronote_lib::index::{graph, jobs, schema, writer};
use zeronote_lib::project::{IgnoreSettings, ignore};

const MAX: u64 = 2 * 1024 * 1024;

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("zeronote-graph-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("не удалось создать временную папку");
    dir
}

/// Собрать хранилище из пар «относительный путь → содержимое» и проиндексировать.
fn vault(dir: &Path, files: &[(&str, &str)]) -> Connection {
    for (rel, text) in files {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, text).unwrap();
    }

    let rules = ignore::build(dir, &IgnoreSettings::default());
    let db = schema::open(&schema::index_path(dir)).unwrap();

    for path in jobs::collect_files(dir, &rules, &|| false).unwrap() {
        // Файл базы лежит в той же папке — индексировать его незачем.
        if path.extension().and_then(|e| e.to_str()) == Some("db") {
            continue;
        }
        writer::index_file(&db, 1, dir, &path, MAX).unwrap();
    }
    db
}

/// Простейший случай, ради которого всё и делается.
#[test]
fn link_leads_to_the_note() {
    let dir = temp_dir("simple");
    let db = vault(
        &dir,
        &[
            ("Дневник.md", "Сегодня писал про [[Планы]].\n"),
            ("Планы.md", "# Планы\n"),
        ],
    );

    let from = dir.join("Дневник.md").display().to_string();
    let resolved = graph::resolve(&db, "Планы", &from, 1).unwrap();

    assert!(resolved.is_some(), "ссылка должна разрешиться");
    assert_eq!(resolved.unwrap().name, "Планы.md");
    let _ = fs::remove_dir_all(&dir);
}

/// Обратная сторона той же связи: заметка знает, кто на неё сослался.
#[test]
fn backlink_points_at_the_source() {
    let dir = temp_dir("back");
    let db = vault(
        &dir,
        &[
            ("Дневник.md", "Смотри [[Планы#Задачи|список]].\n"),
            ("Планы.md", "# Планы\n"),
            ("Постороннее.md", "Тут ссылок нет.\n"),
        ],
    );

    let target = dir.join("Планы.md").display().to_string();
    let found = graph::backlinks(&db, &target).unwrap();

    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].name, "Дневник.md");
    assert_eq!(found[0].text, "Планы#Задачи|список");
    let _ = fs::remove_dir_all(&dir);
}

/// Две заметки с одним именем — побеждает ближайшая к ссылающемуся файлу,
/// и обратная ссылка попадает только к ней.
#[test]
fn nearest_note_wins_and_the_other_gets_nothing() {
    let dir = temp_dir("nearest");
    let db = vault(
        &dir,
        &[
            ("работа/Планы.md", "# Рабочие\n"),
            ("личное/Планы.md", "# Личные\n"),
            ("работа/Дневник.md", "Сегодня про [[Планы]].\n"),
        ],
    );

    let from = dir.join("работа/Дневник.md").display().to_string();
    let resolved = graph::resolve(&db, "Планы", &from, 1).unwrap().unwrap();
    assert!(
        resolved.path.contains("работа"),
        "выбрана не та заметка: {}",
        resolved.path
    );

    let work = dir.join("работа/Планы.md").display().to_string();
    let personal = dir.join("личное/Планы.md").display().to_string();

    assert_eq!(graph::backlinks(&db, &work).unwrap().len(), 1);
    assert!(
        graph::backlinks(&db, &personal).unwrap().is_empty(),
        "обратная ссылка попала не в ту заметку"
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Ссылка с путём ведёт именно по пути, а не по имени.
#[test]
fn path_link_ignores_the_nearer_namesake() {
    let dir = temp_dir("bypath");
    let db = vault(
        &dir,
        &[
            ("работа/Планы.md", "# Рабочие\n"),
            ("личное/Планы.md", "# Личные\n"),
            ("работа/Дневник.md", "Смотри [[личное/Планы]].\n"),
        ],
    );

    let from = dir.join("работа/Дневник.md").display().to_string();
    let resolved = graph::resolve(&db, "личное/Планы", &from, 1).unwrap().unwrap();

    assert!(resolved.path.contains("личное"), "{}", resolved.path);
    let _ = fs::remove_dir_all(&dir);
}

/// Псевдоним из frontmatter — тоже способ сослаться.
#[test]
fn alias_resolves_the_link() {
    let dir = temp_dir("alias");
    let db = vault(
        &dir,
        &[
            (
                "Годовой отчёт 2026.md",
                "---\naliases: [Отчёт, Итоги года]\n---\n\n# Отчёт\n",
            ),
            ("Дневник.md", "Написал [[Итоги года]].\n"),
        ],
    );

    let from = dir.join("Дневник.md").display().to_string();
    let resolved = graph::resolve(&db, "Итоги года", &from, 1).unwrap();

    assert_eq!(resolved.map(|r| r.name), Some("Годовой отчёт 2026.md".to_owned()));
    let _ = fs::remove_dir_all(&dir);
}

/// Висячая ссылка — обычное дело в живом хранилище, а не ошибка.
#[test]
fn dangling_link_resolves_to_nothing() {
    let dir = temp_dir("dangling");
    let db = vault(&dir, &[("Дневник.md", "Ссылка на [[Ненаписанное]].\n")]);

    let from = dir.join("Дневник.md").display().to_string();

    assert!(graph::resolve(&db, "Ненаписанное", &from, 1).unwrap().is_none());
    let _ = fs::remove_dir_all(&dir);
}

/// Ссылка, появившаяся раньше заметки, начинает работать, как только заметка
/// появилась. Ради этого ссылки и не разрешаются при записи в индекс.
#[test]
fn link_starts_working_when_the_note_appears() {
    let dir = temp_dir("later");
    let db = vault(&dir, &[("Дневник.md", "Ссылка на [[Будущее]].\n")]);

    let from = dir.join("Дневник.md").display().to_string();
    assert!(graph::resolve(&db, "Будущее", &from, 1).unwrap().is_none());

    let created = dir.join("Будущее.md");
    fs::write(&created, "# Будущее\n").unwrap();
    writer::index_file(&db, 1, &dir, &created, MAX).unwrap();

    assert!(
        graph::resolve(&db, "Будущее", &from, 1).unwrap().is_some(),
        "ссылка не заработала после появления заметки"
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Теги ищутся вместе с вложенными — так же считает Obsidian.
#[test]
fn tag_search_includes_nested() {
    let dir = temp_dir("tags");
    let db = vault(
        &dir,
        &[
            ("Первая.md", "Текст с #работа тут.\n"),
            ("Вторая.md", "Текст с #работа/срочное тут.\n"),
            ("Третья.md", "---\ntags: [личное]\n---\nтекст\n"),
        ],
    );

    let work = graph::files_with_tag(&db, "работа", 50).unwrap();
    assert_eq!(work.len(), 2, "{work:?}");

    let personal = graph::files_with_tag(&db, "#личное", 50).unwrap();
    assert_eq!(personal.len(), 1);
    assert_eq!(personal[0].name, "Третья.md");
    let _ = fs::remove_dir_all(&dir);
}

/// Переиндексация не должна удваивать связи: иначе одна ссылка со временем
/// превращается в десяток обратных.
#[test]
fn reindexing_does_not_duplicate_links() {
    let dir = temp_dir("dup");
    let db = vault(
        &dir,
        &[
            ("Дневник.md", "Ссылка на [[Планы]].\n"),
            ("Планы.md", "# Планы\n"),
        ],
    );

    let source = dir.join("Дневник.md");
    for i in 0..3 {
        // Содержимое меняется, иначе индекс справедливо решит, что перечитывать
        // нечего, и проверка ничего не проверит.
        fs::write(&source, format!("Ссылка на [[Планы]]. Правка {i}\n")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        writer::index_file(&db, 1, &dir, &source, MAX).unwrap();
    }

    let target = dir.join("Планы.md").display().to_string();
    assert_eq!(graph::backlinks(&db, &target).unwrap().len(), 1);
    let _ = fs::remove_dir_all(&dir);
}

/// Ссылки в блоке кода связями не считаются (Р-069). Проверяется на пути
/// целиком: разбор мог быть верным, а до индекса могло доехать другое.
#[test]
fn links_in_code_blocks_are_not_connections() {
    let dir = temp_dir("code");
    let db = vault(
        &dir,
        &[
            (
                "Заметка.md",
                "```rust\nlet x = arr[[0]];\n// [[Планы]] в комментарии кода\n```\n",
            ),
            ("Планы.md", "# Планы\n"),
        ],
    );

    let target = dir.join("Планы.md").display().to_string();

    assert!(
        graph::backlinks(&db, &target).unwrap().is_empty(),
        "ссылка из блока кода попала в связи"
    );
    let _ = fs::remove_dir_all(&dir);
}

/// Список тегов для палитры: самые частые сверху, начало имени вперёд.
#[test]
fn tags_are_listed_by_frequency_then_by_prefix() {
    let dir = temp_dir("tags-list");
    let db = vault(
        &dir,
        &[
            ("а.md", "#работа #дом\n"),
            ("б.md", "#работа\n"),
            ("в.md", "#работа/срочное\n"),
            ("г.md", "#по-работе\n"),
        ],
    );

    // Пустой запрос — все теги, частые сверху.
    let all = graph::find_tags(&db, "", 50).unwrap();
    assert_eq!(all[0].tag, "работа");
    assert_eq!(all[0].count, 2);
    assert_eq!(all.len(), 4);

    // Запрос: сначала те, что начинаются с него, потом просто содержащие.
    let found = graph::find_tags(&db, "работ", 50).unwrap();
    let names: Vec<&str> = found.iter().map(|t| t.tag.as_str()).collect();
    assert_eq!(names, vec!["работа", "работа/срочное", "по-работе"]);

    let _ = fs::remove_dir_all(&dir);
}

/// Решётка в запросе не мешает: пользователь набирает её первой.
#[test]
fn leading_hash_in_query_is_ignored() {
    let dir = temp_dir("tags-hash");
    let db = vault(&dir, &[("а.md", "#заметки\n")]);

    assert_eq!(graph::find_tags(&db, "#замет", 50).unwrap().len(), 1);
    assert_eq!(graph::find_tags(&db, "замет", 50).unwrap().len(), 1);

    let _ = fs::remove_dir_all(&dir);
}

/// Подчёркивание в запросе — это подчёркивание, а не «любой символ».
///
/// В `LIKE` символы `_` и `%` служебные. Не экранируй мы их, запрос `план_б`
/// нашёл бы и `планаб`: ровно та же ошибка, что со скобкой в запросе к FTS5,
/// только тихая — она не роняет запрос, а молча возвращает лишнее.
#[test]
fn like_wildcards_in_query_are_literal() {
    let dir = temp_dir("tags-like");
    let db = vault(&dir, &[("а.md", "#план_б\n"), ("б.md", "#планаб\n")]);

    let found = graph::find_tags(&db, "план_б", 50).unwrap();
    let names: Vec<&str> = found.iter().map(|t| t.tag.as_str()).collect();
    assert_eq!(names, vec!["план_б"]);

    let _ = fs::remove_dir_all(&dir);
}

/// Главное свойство подсказки имён (Р-134): что показали, то и вставили.
///
/// Уникальному имени хватает короткого текста — так пишут ссылки руками,
/// и подсказка не должна писать иначе.
#[test]
fn link_text_is_short_when_the_name_is_unique() {
    let dir = temp_dir("linktext-short");
    let db = vault(
        &dir,
        &[("Дневник.md", "# Дневник\n"), ("работа/Планы.md", "# Планы\n")],
    );

    let from = dir.join("Дневник.md").display().to_string();
    let target = dir.join("работа").join("Планы.md").display().to_string();

    let text = graph::link_text(&db, &target, &from, 1, r"работа\Планы.md").unwrap();

    assert_eq!(text, "Планы");
    // И она обязана вести обратно ровно туда, откуда взята.
    let back = graph::resolve(&db, &text, &from, 1).unwrap().unwrap();
    assert_eq!(back.path, target);
    let _ = fs::remove_dir_all(&dir);
}

/// А вот ради чего всё это: две заметки с одним именем.
///
/// Короткое имя разрешается в ближайшую, поэтому дальней достаётся путь
/// от корня. Возьми подсказка имя, она предложила бы одну заметку,
/// а вставила ссылку на другую — молча.
#[test]
fn link_text_takes_the_path_when_the_name_is_taken() {
    let dir = temp_dir("linktext-path");
    let db = vault(
        &dir,
        &[
            ("работа/Планы.md", "# Рабочие\n"),
            ("личное/Планы.md", "# Личные\n"),
            ("работа/Дневник.md", "# Дневник\n"),
        ],
    );

    let from = dir.join("работа/Дневник.md").display().to_string();
    let near = dir.join("работа").join("Планы.md").display().to_string();
    let far = dir.join("личное").join("Планы.md").display().to_string();

    let to_near = graph::link_text(&db, &near, &from, 1, r"работа\Планы.md").unwrap();
    let to_far = graph::link_text(&db, &far, &from, 1, r"личное\Планы.md").unwrap();

    assert_eq!(to_near, "Планы");
    assert_eq!(to_far, "личное/Планы");

    // Проверка, ради которой тест и написан: обе ссылки ведут каждая в свою.
    assert_eq!(graph::resolve(&db, &to_near, &from, 1).unwrap().unwrap().path, near);
    assert_eq!(graph::resolve(&db, &to_far, &from, 1).unwrap().unwrap().path, far);
    let _ = fs::remove_dir_all(&dir);
}

/// Не-markdown ссылается по имени без расширения: в индексе имя лежит именно
/// так, и `[[рисунок.png]]` не разрешилось бы ни во что.
#[test]
fn link_text_drops_the_extension_of_other_files() {
    let dir = temp_dir("linktext-ext");
    let db = vault(
        &dir,
        &[("Дневник.md", "# Дневник\n"), ("схема.svg", "<svg/>\n")],
    );

    let from = dir.join("Дневник.md").display().to_string();
    let target = dir.join("схема.svg").display().to_string();

    let text = graph::link_text(&db, &target, &from, 1, "схема.svg").unwrap();

    assert_eq!(text, "схема");
    assert!(graph::resolve(&db, &text, &from, 1).unwrap().is_some());
    let _ = fs::remove_dir_all(&dir);
}

/// Псевдоним из frontmatter короткое имя не отменяет.
///
/// Разрешение пробует имена раньше псевдонимов, поэтому заметка, чьё имя
/// занято чужим псевдонимом, всё равно ссылается по имени.
#[test]
fn link_text_is_not_confused_by_an_alias() {
    let dir = temp_dir("linktext-alias");
    let db = vault(
        &dir,
        &[
            ("Дневник.md", "# Дневник\n"),
            ("Планы.md", "# Планы\n"),
            ("Отчёт.md", "---\naliases: [Планы]\n---\n\n# Отчёт\n"),
        ],
    );

    let from = dir.join("Дневник.md").display().to_string();
    let target = dir.join("Планы.md").display().to_string();

    let text = graph::link_text(&db, &target, &from, 1, "Планы.md").unwrap();

    assert_eq!(text, "Планы");
    assert_eq!(graph::resolve(&db, &text, &from, 1).unwrap().unwrap().path, target);
    let _ = fs::remove_dir_all(&dir);
}
