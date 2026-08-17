//! Нечёткий поиск по именам файлов — для быстрого открытия.
//!
//! Решение Р-064: буквы запроса должны встретиться по порядку, но не подряд.
//! `edtr` находит `EditorHost.svelte`. Строгое вхождение подстроки заставляло
//! бы помнить точное имя, то есть отменяло бы смысл быстрого открытия.
//!
//! Ранжирование простое и предсказуемое. Сложные схемы вроде той, что в fzf,
//! дают лучший порядок на длинных запросах, но объяснить их пользователю
//! нельзя, а «почему этот файл выше того» — вопрос, который задают.

/// Один найденный файл.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHit {
    pub root_id: u64,
    pub path: String,
    pub name: String,
    /// Позиции совпавших букв в `name`, в символах. Пусто — совпало только
    /// в пути. Фронтенд по ним рисует подсветку.
    pub matched: Vec<usize>,
    /// Чем больше, тем выше в списке.
    pub score: i32,
}

/// Надбавки. Собраны в одном месте, чтобы порядок выдачи можно было объяснить,
/// а не выводить из кода.
mod bonus {
    /// Совпадение в начале слова: после разделителя или на границе регистра.
    pub const WORD_START: i32 = 12;
    /// Подряд идущие буквы: `edit` в `editor` ценнее, чем те же буквы врозь.
    pub const CONSECUTIVE: i32 = 8;
    /// Совпадение с самого начала имени.
    pub const AT_START: i32 = 16;
    /// Штраф за каждую пропущенную букву между совпадениями.
    pub const GAP: i32 = -1;
    /// Штраф за длину имени: при прочих равных короткое имя вероятнее.
    pub const LENGTH: i32 = -1;
}

fn is_boundary(previous: Option<char>, current: char) -> bool {
    match previous {
        None => true,
        Some(previous) => {
            // Разделитель перед буквой либо переход строчная → прописная:
            // `HostView` — два слова, хотя разделителя между ними нет.
            !previous.is_alphanumeric()
                || (previous.is_lowercase() && current.is_uppercase())
        }
    }
}

/// Сопоставить запрос с одной строкой.
///
/// Возвращает оценку и позиции совпавших букв. `None` — не совпало.
/// Жадный проход слева направо: он не всегда даёт лучшую из возможных
/// расстановок, но объясним и стоит один проход по строке вместо перебора.
fn match_str(query: &[char], text: &str) -> Option<(i32, Vec<usize>)> {
    if query.is_empty() {
        return Some((0, Vec::new()));
    }

    let chars: Vec<char> = text.chars().collect();
    let mut positions = Vec::with_capacity(query.len());
    let mut score = 0;
    let mut qi = 0;
    let mut previous_match: Option<usize> = None;

    for (i, ch) in chars.iter().enumerate() {
        if qi >= query.len() {
            break;
        }

        // Сравниваем без учёта регистра: пользователь не обязан помнить,
        // с какой буквы начинается имя файла.
        let same = ch
            .to_lowercase()
            .zip(query[qi].to_lowercase())
            .all(|(a, b)| a == b);
        if !same {
            continue;
        }

        if i == 0 {
            score += bonus::AT_START;
        }
        if is_boundary(i.checked_sub(1).map(|p| chars[p]), *ch) {
            score += bonus::WORD_START;
        }
        match previous_match {
            Some(previous) if previous + 1 == i => score += bonus::CONSECUTIVE,
            Some(previous) => score += bonus::GAP * (i - previous - 1) as i32,
            None => {}
        }

        positions.push(i);
        previous_match = Some(i);
        qi += 1;
    }

    if qi < query.len() {
        return None;
    }

    score += bonus::LENGTH * (chars.len() as i32 / 8);
    Some((score, positions))
}

/// Насколько имя и путь подходят запросу.
///
/// Сначала пробуем имя файла: совпадение в нём ценнее совпадения в пути —
/// человек ищет файл, а не папку. Не вышло — пробуем путь, но с меньшей
/// оценкой и без позиций подсветки: подсвечивать в пути нечего, он не показан
/// целиком.
///
/// `inside` — путь **внутри корня**, а не абсолютный. Абсолютный содержит
/// имя пользователя и десяток общих слов вроде `Desktop` и `Project`, под
/// которые подходит почти любой запрос, — и тогда в выдачу попадают все файлы
/// проекта разом.
pub fn score(query: &[char], name: &str, inside: &str) -> Option<(i32, Vec<usize>)> {
    if let Some((score, positions)) = match_str(query, name) {
        return Some((score + 40, positions));
    }
    match_str(query, inside).map(|(score, _)| (score, Vec::new()))
}

/// Отобрать и упорядочить лучшие совпадения.
///
/// Записи приходят как «номер корня, полный путь, имя, путь внутри корня»:
/// первый нужен интерфейсу, второй — открытию файла, остальные — сравнению.
///
/// Проход по десяти тысячам имён стоит доли миллисекунды, поэтому второго
/// списка специально для быстрого открытия нет: его пришлось бы согласовывать
/// с индексом.
pub fn best(
    query: &str,
    files: impl IntoIterator<Item = (u64, String, String, String)>,
    limit: usize,
) -> Vec<FileHit> {
    let chars: Vec<char> = query.chars().filter(|c| !c.is_whitespace()).collect();

    let mut hits: Vec<FileHit> = files
        .into_iter()
        .filter_map(|(root_id, path, name, inside)| {
            let (score, matched) = score(&chars, &name, &inside)?;
            Some(FileHit {
                root_id,
                path,
                name,
                matched,
                score,
            })
        })
        .collect();

    // По убыванию оценки, при равной — по имени: иначе порядок одинаковых
    // по весу файлов зависел бы от порядка строк в базе и прыгал.
    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.name.len().cmp(&b.name.len()))
            .then_with(|| a.name.cmp(&b.name))
    });
    hits.truncate(limit);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chars(s: &str) -> Vec<char> {
        s.chars().collect()
    }

    fn names(hits: &[FileHit]) -> Vec<&str> {
        hits.iter().map(|h| h.name.as_str()).collect()
    }

    const ROOT: &str = r"C:\проект";

    fn files() -> Vec<(u64, String, String, String)> {
        [
            r"C:\проект\src\ui\EditorHost.svelte",
            r"C:\проект\src\editor\setup.ts",
            r"C:\проект\src\state\tabs.svelte.ts",
            r"C:\проект\заметки\редактор.md",
            r"C:\проект\README.md",
        ]
        .into_iter()
        .map(|path| {
            let name = path.rsplit('\\').next().unwrap().to_owned();
            let inside = path[ROOT.len()..].trim_start_matches('\\').to_owned();
            (1u64, path.to_owned(), name, inside)
        })
        .collect()
    }

    /// Главное свойство: буквы идут по порядку, но не обязаны быть подряд.
    #[test]
    fn letters_may_be_spread_out() {
        let hits = best("edtr", files(), 10);
        assert_eq!(names(&hits).first(), Some(&"EditorHost.svelte"));
    }

    /// Регистр не важен: помнить, с какой буквы начинается имя, не должен
    /// никто.
    #[test]
    fn case_does_not_matter() {
        assert!(match_str(&chars("EDITOR"), "EditorHost.svelte").is_some());
        assert!(match_str(&chars("editor"), "EditorHost.svelte").is_some());
    }

    /// Совпадение с начала слова ценнее совпадения в середине.
    ///
    /// Имена подобраны так, чтобы отличались ровно этим: в первом обе буквы
    /// начинают слова, во втором те же буквы стоят внутри слова.
    #[test]
    fn word_start_wins() {
        let candidates = vec![
            // Латиница в обоих именах намеренно: кириллическая «е» и латинская
            // «e» — разные буквы, и подмешивать сюда ещё и это различие значило
            // бы проверять тестом сразу две вещи.
            (
                1u64,
                r"C:\п\sheher.ts".to_owned(),
                "sheher.ts".to_owned(),
                "sheher.ts".to_owned(),
            ),
            (
                1u64,
                r"C:\п\editor-host.ts".to_owned(),
                "editor-host.ts".to_owned(),
                "editor-host.ts".to_owned(),
            ),
        ];

        let hits = best("eh", candidates, 10);

        assert_eq!(names(&hits).first(), Some(&"editor-host.ts"));
        assert!(
            hits[0].score > hits[1].score + 20,
            "разрыв должен быть заметным: {} против {}",
            hits[0].score,
            hits[1].score
        );
    }

    /// Границей слова считается и переход строчная → прописная: `HostView` —
    /// это два слова, хотя разделителя между ними нет.
    #[test]
    fn case_change_is_a_word_boundary() {
        let with_boundary = match_str(&chars("eh"), "editorHost").expect("совпадает");
        let without = match_str(&chars("eh"), "editorhost").expect("совпадает");

        assert!(
            with_boundary.0 > without.0,
            "{} должно быть больше {}",
            with_boundary.0,
            without.0
        );
    }

    /// Совпадение в имени файла ценнее совпадения в пути: человек ищет файл.
    #[test]
    fn name_beats_path() {
        let hits = best("редактор", files(), 10);
        assert_eq!(names(&hits).first(), Some(&"редактор.md"));
    }

    /// Кириллица работает так же, как латиница, — включая границы слов.
    #[test]
    fn cyrillic_works() {
        let hits = best("ред", files(), 10);
        assert!(!hits.is_empty());
        assert_eq!(hits[0].name, "редактор.md");
        assert_eq!(hits[0].matched, vec![0, 1, 2]);
    }

    /// Несовпадающий запрос не должен возвращать ничего — ни одного «почти».
    #[test]
    fn no_match_returns_nothing() {
        assert!(best("щщщщ", files(), 10).is_empty());
    }

    /// Путь корня в сопоставлении не участвует.
    ///
    /// Дефект, найденный живой проверкой: корень
    /// `C:\Users\пользователь\Desktop\Project\...` содержит столько букв, что
    /// под него подходит почти любой запрос, — и в выдачу попадали все файлы
    /// проекта разом. Сравнивается путь внутри корня.
    #[test]
    fn root_path_does_not_take_part_in_matching() {
        let root = r"C:\Users\user\Desktop\Project\Home\ZeroNote";
        let candidates: Vec<(u64, String, String, String)> =
            [("LICENSE", "LICENSE"), ("editor.css", r"src\editor\editor.css")]
                .into_iter()
                .map(|(name, inside)| {
                    (
                        1u64,
                        format!(r"{root}\{inside}"),
                        name.to_owned(),
                        inside.to_owned(),
                    )
                })
                .collect();

        let hits = best("edtr", candidates, 10);

        // `Desktop\Project` даёт e-d-t-r по порядку; будь путь абсолютным,
        // LICENSE попал бы в выдачу.
        assert_eq!(names(&hits), vec!["editor.css"]);
    }

    /// Но путь внутри корня в сопоставлении участвовать обязан: `ui/host`
    /// должно находить `src\ui\EditorHost.svelte`.
    #[test]
    fn path_inside_the_root_still_matches() {
        let hits = best("uihost", files(), 10);
        assert_eq!(names(&hits), vec!["EditorHost.svelte"]);
    }

    /// Пустой запрос выдаёт всё: палитра при открытии показывает список
    /// файлов, а не пустоту.
    #[test]
    fn empty_query_lists_everything() {
        assert_eq!(best("", files(), 10).len(), 5);
    }

    /// Позиции подсветки должны указывать на настоящие буквы имени.
    #[test]
    fn matched_positions_point_at_real_letters() {
        let hits = best("edt", files(), 10);
        let hit = &hits[0];
        let chars: Vec<char> = hit.name.chars().collect();

        let matched: String = hit.matched.iter().map(|i| chars[*i]).collect();
        assert_eq!(matched.to_lowercase(), "edt");
    }

    /// Порядок не должен зависеть от порядка строк в базе.
    #[test]
    fn order_is_stable_regardless_of_input_order() {
        let mut reversed = files();
        reversed.reverse();

        assert_eq!(names(&best("s", files(), 10)), names(&best("s", reversed, 10)));
    }

    #[test]
    fn limit_is_respected() {
        assert_eq!(best("", files(), 2).len(), 2);
    }
}
