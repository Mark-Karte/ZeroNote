//! Связи между заметками: frontmatter, `[[ссылки]]`, теги.
//!
//! Это свойство markdown-файлов в проекте ZeroNote, а не «режим Obsidian»
//! (решение Р-022, пункт 3). Правила разрешения ссылок наши и описаны
//! в `links.rs`; они совпадают с поведением Obsidian там, где это здравое
//! поведение, а не потому, что мы обязаны совпадать.
//!
//! Разбор живёт в ядре, а не во фронтенде, потому что связи нужны всему
//! проекту сразу: панель обратных ссылок отвечает на вопрос «кто ссылается
//! на эту заметку», и ответ приходит из индекса.

pub mod front;
pub mod links;

pub use front::Front;
pub use links::{Link, Parsed};

/// Разобрать markdown-файл целиком: frontmatter, ссылки, теги.
pub fn parse(text: &str) -> Parsed {
    let front = front::parse(text);
    let mut parsed = links::extract(text, front.body_offset);

    // Теги из frontmatter и теги из текста — одно и то же множество.
    // Разделять их значило бы заставить пользователя помнить, где он написал
    // тег, чтобы понять, найдётся ли он.
    for tag in &front.tags {
        let normalized = links::normalize_tag(tag);
        if !normalized.is_empty() && !parsed.tags.contains(&normalized) {
            parsed.tags.push(normalized);
        }
    }

    parsed.aliases = front.aliases;
    parsed
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Теги из frontmatter и из текста складываются в один список.
    #[test]
    fn tags_from_both_places_are_merged() {
        let text = "---\ntags: [работа, идеи]\n---\n\nТекст с #заметкой и #работа снова.\n";

        let parsed = parse(text);

        let mut tags = parsed.tags.clone();
        tags.sort();
        assert_eq!(tags, vec!["заметкой", "идеи", "работа"]);
    }

    #[test]
    fn aliases_reach_the_result() {
        let text = "---\naliases:\n  - Первое имя\n  - Второе\n---\n\nТекст.\n";

        let parsed = parse(text);

        assert_eq!(parsed.aliases, vec!["Первое имя", "Второе"]);
    }

    /// Файл без frontmatter — обычное дело, а не особый случай.
    #[test]
    fn plain_file_parses_too() {
        let parsed = parse("# Заголовок\n\nСсылка на [[Другую заметку]].\n");

        assert_eq!(parsed.links.len(), 1);
        assert_eq!(parsed.links[0].target, "Другую заметку");
        assert!(parsed.aliases.is_empty());
    }
}
