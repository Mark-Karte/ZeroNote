//! Frontmatter: читаем два ключа, остальное не трогаем.
//!
//! Решение Р-068. Из всего frontmatter нам нужны `aliases` (по ним
//! разрешаются ссылки) и `tags`. Остальное содержимое не толкуется и не
//! меняется никогда — это инвариант 1: чужой файл неприкосновенен.
//!
//! Своего разбора YAML не пишем. YAML — большой язык с якорями, многострочными
//! блоками и вложенностью; поддерживать его целиком ради двух ключей значило бы
//! взять на себя обязательство, которое ничего не покупает. Берём два ключа
//! в двух обычных записях — списком и строкой через запятую, — а всё
//! непонятное пропускаем молча.

/// Что удалось прочитать из frontmatter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Front {
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    /// Смещение, с которого начинается тело файла — после закрывающего `---`.
    ///
    /// Нужно разбору ссылок: `[[` внутри frontmatter ссылкой не считается,
    /// да и теги там свои.
    pub body_offset: usize,
}

/// Строка состоит из трёх и более дефисов — ограда frontmatter.
fn is_fence(line: &str) -> bool {
    let trimmed = line.trim_end();
    trimmed.len() >= 3 && trimmed.chars().all(|c| c == '-')
}

/// Разобрать значение ключа: `[a, b]`, `a, b` или пусто, если список ниже.
fn inline_values(value: &str) -> Vec<String> {
    let value = value.trim();
    if value.is_empty() {
        return Vec::new();
    }

    let inner = value
        .strip_prefix('[')
        .and_then(|v| v.strip_suffix(']'))
        .unwrap_or(value);

    inner
        .split(',')
        .map(clean)
        .filter(|v| !v.is_empty())
        .collect()
}

/// Снять пробелы и кавычки — в YAML значение может быть в любых.
fn clean(value: &str) -> String {
    let value = value.trim();
    let value = value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
        .unwrap_or(value);
    value.trim().to_owned()
}

pub fn parse(text: &str) -> Front {
    let mut front = Front::default();

    // Frontmatter — только в самом начале файла. Три дефиса посреди текста
    // это горизонтальная черта, а не ограда.
    let Some(rest) = text.strip_prefix("---") else {
        return front;
    };
    let Some(rest) = rest.strip_prefix('\n').or_else(|| rest.strip_prefix("\r\n")) else {
        return front;
    };

    // Куда собирать значения списка, который идёт строками ниже ключа.
    #[derive(PartialEq)]
    enum Collecting {
        Nothing,
        Aliases,
        Tags,
    }
    let mut collecting = Collecting::Nothing;

    let start = text.len() - rest.len();
    let mut offset = start;

    for line in rest.split_inclusive('\n') {
        offset += line.len();
        let content = line.trim_end_matches(['\n', '\r']);

        if is_fence(content) {
            // Ограда закрылась — тело начинается сразу за ней.
            front.body_offset = offset;
            return front;
        }

        // Пункт списка: `  - значение`.
        if let Some(item) = content.trim_start().strip_prefix("- ") {
            match collecting {
                Collecting::Aliases => front.aliases.push(clean(item)),
                Collecting::Tags => front.tags.push(clean(item)),
                Collecting::Nothing => {}
            }
            continue;
        }

        let Some((key, value)) = content.split_once(':') else {
            continue;
        };

        // Вложенные ключи не наши: у них есть отступ, и относятся они
        // к чему-то, чего мы не разбираем.
        if key.starts_with(' ') || key.starts_with('\t') {
            continue;
        }

        match key.trim() {
            "aliases" | "alias" => {
                front.aliases.extend(inline_values(value));
                collecting = Collecting::Aliases;
            }
            "tags" | "tag" => {
                front.tags.extend(inline_values(value));
                collecting = Collecting::Tags;
            }
            _ => collecting = Collecting::Nothing,
        }
    }

    // Ограда не закрылась: это не frontmatter, а просто текст, начинающийся
    // с дефисов. Ничего не берём.
    Front::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_inline_list() {
        let front = parse("---\naliases: [Первое, \"Второе имя\"]\ntags: [a, b]\n---\nтекст\n");

        assert_eq!(front.aliases, vec!["Первое", "Второе имя"]);
        assert_eq!(front.tags, vec!["a", "b"]);
    }

    #[test]
    fn reads_block_list() {
        let front = parse("---\naliases:\n  - Первое\n  - Второе\ntags:\n  - работа\n---\n");

        assert_eq!(front.aliases, vec!["Первое", "Второе"]);
        assert_eq!(front.tags, vec!["работа"]);
    }

    #[test]
    fn reads_comma_separated_string() {
        let front = parse("---\ntags: работа, идеи\n---\n");
        assert_eq!(front.tags, vec!["работа", "идеи"]);
    }

    /// Единственное число тоже встречается, и обманывать пользователя
    /// молчанием здесь незачем.
    #[test]
    fn singular_keys_work_too() {
        let front = parse("---\nalias: Другое имя\ntag: заметка\n---\n");

        assert_eq!(front.aliases, vec!["Другое имя"]);
        assert_eq!(front.tags, vec!["заметка"]);
    }

    /// Всё остальное содержимое frontmatter нас не касается.
    #[test]
    fn unknown_keys_are_left_alone() {
        let front = parse(
            "---\ntitle: Заметка\ndate: 2026-08-18\ncssclass: широкая\ntags: [x]\n---\n",
        );

        assert_eq!(front.tags, vec!["x"]);
        assert!(front.aliases.is_empty());
    }

    /// Список под чужим ключом не должен утекать в наши: иначе `authors`
    /// со списком имён превратился бы в псевдонимы заметки.
    #[test]
    fn list_under_another_key_is_not_taken() {
        let front = parse("---\nauthors:\n  - Иванов\n  - Петров\n---\n");

        assert!(front.aliases.is_empty(), "{:?}", front.aliases);
        assert!(front.tags.is_empty());
    }

    /// Три дефиса посреди текста — горизонтальная черта, а не frontmatter.
    #[test]
    fn dashes_in_the_middle_are_not_frontmatter() {
        let front = parse("# Заголовок\n\n---\n\ntags: [нет]\n");
        assert!(front.tags.is_empty());
    }

    /// Незакрытая ограда — это не frontmatter, а обычный текст.
    #[test]
    fn unclosed_fence_yields_nothing() {
        let front = parse("---\ntags: [a]\nи дальше текст без закрытия\n");

        assert!(front.tags.is_empty());
        assert_eq!(front.body_offset, 0);
    }

    /// Тело начинается сразу за закрывающей оградой: по этому смещению
    /// разбор ссылок понимает, где начинается настоящий текст.
    #[test]
    fn body_offset_points_past_the_fence() {
        let text = "---\ntags: [a]\n---\nтело\n";
        let front = parse(text);

        assert_eq!(&text[front.body_offset..], "тело\n");
    }

    #[test]
    fn file_without_frontmatter() {
        let front = parse("# Заголовок\n\nтекст\n");

        assert_eq!(front, Front::default());
        assert_eq!(front.body_offset, 0);
    }
}
