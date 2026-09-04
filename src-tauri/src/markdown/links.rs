//! Разбор `[[ссылок]]` и `#тегов`.
//!
//! Правила наши (Р-022, пункт 3), но записаны так, чтобы человек, пришедший
//! из Obsidian, не переучивался: `[[Заметка]]`, `[[Заметка#Раздел]]`,
//! `[[Заметка|подпись]]`, `![[Заметка]]` для вставки.
//!
//! **Внутри кода ссылок и тегов нет** (решение Р-069). Иначе `#include`
//! в блоке C++ становится тегом, `#fff` в CSS — тоже, а `[[i]]` в примере
//! на Rust — ссылкой на несуществующую заметку. Разбор пропускает
//! содержимое огороженных блоков и вставок в обратных кавычках.

/// Одна ссылка на другую заметку.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    /// Куда: `Заметка` или `папка/Заметка`.
    pub target: String,
    /// Раздел после решётки, если он был.
    pub heading: Option<String>,
    /// Подпись после вертикальной черты, если она была.
    pub alias: Option<String>,
    /// Вставка `![[...]]`, а не обычная ссылка.
    pub embed: bool,
    /// Смещение начала ссылки в байтах от начала файла.
    pub offset: usize,
    /// Границы **цели** в байтах от начала файла: то, что надо заменить,
    /// чтобы ссылка стала вести в другое место.
    ///
    /// Отдельно от `offset`, потому что по полям целиком ссылку не собрать:
    /// цель здесь очищена от пробелов, а в файле они могли быть —
    /// `[[ Планы ]]` встречается. Переименование (Р-136) правит ровно эти
    /// байты и ничего вокруг них.
    pub target_span: (usize, usize),
}

/// Всё, что нашлось в файле.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Parsed {
    pub links: Vec<Link>,
    pub tags: Vec<String>,
    /// Псевдонимы из frontmatter. Заполняются разбором файла целиком.
    pub aliases: Vec<String>,
}

/// Привести тег к виду, в котором он хранится и ищется.
///
/// Решётка снимается, регистр опускается: `#Работа` и `#работа` — один тег,
/// иначе поиск по тегу зависел бы от того, как его набрали в тот раз.
pub fn normalize_tag(tag: &str) -> String {
    tag.trim().trim_start_matches('#').trim().to_lowercase()
}

/// Привести цель ссылки к виду для сопоставления.
///
/// Разделители пути к одному виду, расширение `.md` снимается, регистр
/// опускается: Windows не различает регистр путей, и заставлять пользователя
/// попадать в него было бы недобротой.
pub fn link_key(target: &str) -> String {
    let normalized = target.trim().replace('\\', "/").to_lowercase();
    normalized
        .strip_suffix(".md")
        .unwrap_or(&normalized)
        .to_owned()
}

/// Может ли знак стоять внутри тега.
fn tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

/// Может ли тег начинаться с этого знака.
///
/// Не цифра и не дефис: `#2026` — это номер, а не тег, и `#-` тоже ничего
/// не значит. Так же считает Obsidian.
fn tag_start(c: char) -> bool {
    c.is_alphabetic() || c == '_'
}

/// Заменить содержимое вставок в обратных кавычках пробелами.
///
/// Длина в байтах сохраняется — иначе смещения ссылок поехали бы. Кириллица
/// внутри кода превращается в несколько пробелов, и это ровно то, что нужно:
/// важна длина, а не вид.
fn mask_inline_code(line: &str) -> String {
    let bytes = line.as_bytes();
    let mut out: Vec<u8> = bytes.to_vec();

    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }

        // Длина ограды — сколько кавычек подряд.
        let start = i;
        while i < bytes.len() && bytes[i] == b'`' {
            i += 1;
        }
        let fence = i - start;

        // Ищем такую же ограду дальше.
        let mut j = i;
        let close = loop {
            if j >= bytes.len() {
                break None;
            }
            if bytes[j] == b'`' {
                let run_start = j;
                while j < bytes.len() && bytes[j] == b'`' {
                    j += 1;
                }
                if j - run_start == fence {
                    break Some((run_start, j));
                }
                continue;
            }
            j += 1;
        };

        match close {
            Some((_, end)) => {
                for byte in out.iter_mut().take(end).skip(start) {
                    *byte = b' ';
                }
                i = end;
            }
            // Ограда не закрылась: дальше по строке обычный текст.
            None => break,
        }
    }

    // Замена всегда байт на байт, поэтому строка остаётся годной.
    String::from_utf8(out).unwrap_or_else(|_| line.to_owned())
}

/// Строка открывает или закрывает огороженный блок кода.
fn fence_marker(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    // Отступ больше трёх пробелов — это уже блок кода отступом, а не ограда.
    if line.len() - trimmed.len() > 3 {
        return None;
    }

    let first = trimmed.chars().next()?;
    if first != '`' && first != '~' {
        return None;
    }

    let count = trimmed.chars().take_while(|c| *c == first).count();
    if count < 3 {
        return None;
    }
    Some((first, count))
}

/// Найти ссылки и теги в тексте, начиная с `body_offset`.
pub fn extract(text: &str, body_offset: usize) -> Parsed {
    let mut parsed = Parsed::default();
    let mut offset = body_offset;
    let mut fence: Option<(char, usize)> = None;

    for line in text[body_offset..].split_inclusive('\n') {
        let content = line.trim_end_matches(['\n', '\r']);

        match fence {
            Some((marker, count)) => {
                // Закрывает ограду только такая же или более длинная.
                if let Some((m, c)) = fence_marker(content)
                    && m == marker
                    && c >= count
                {
                    fence = None;
                }
                offset += line.len();
                continue;
            }
            None => {
                if let Some(open) = fence_marker(content) {
                    fence = Some(open);
                    offset += line.len();
                    continue;
                }
            }
        }

        let masked = mask_inline_code(content);
        collect_links(&masked, offset, &mut parsed.links);
        collect_tags(&masked, &mut parsed.tags);

        offset += line.len();
    }

    parsed
}

fn collect_links(line: &str, line_offset: usize, out: &mut Vec<Link>) {
    let bytes = line.as_bytes();
    let mut i = 0;

    while i + 1 < bytes.len() {
        if bytes[i] != b'[' || bytes[i + 1] != b'[' {
            i += 1;
            continue;
        }

        let open = i;
        let Some(close) = line[open + 2..].find("]]") else {
            return;
        };
        let inner = &line[open + 2..open + 2 + close];
        i = open + 2 + close + 2;

        // Пустая ссылка `[[]]` — не ссылка.
        if inner.trim().is_empty() {
            continue;
        }

        let (before_alias, alias) = match inner.split_once('|') {
            Some((target, alias)) => (target, Some(alias.trim().to_owned())),
            None => (inner, None),
        };
        let (target, heading) = match before_alias.split_once('#') {
            Some((target, heading)) => (target, Some(heading.trim().to_owned())),
            None => (before_alias, None),
        };

        // Границы цели в исходной строке: от начала внутренностей ссылки плюс
        // то, что съели пробелы слева. Считается до `trim`, иначе адрес
        // потеряется вместе с пробелами.
        let target_start = open + 2 + (target.len() - target.trim_start().len());
        let target_end = target_start + target.trim().len();

        let target = target.trim().to_owned();
        if target.is_empty() && heading.is_none() {
            continue;
        }

        // Вставка отличается восклицательным знаком перед скобками. Обратную
        // ссылку она создаёт такую же: заметка на заметку сослалась.
        let embed = open > 0 && bytes[open - 1] == b'!';

        out.push(Link {
            target,
            heading,
            alias,
            embed,
            offset: line_offset + open,
            target_span: (line_offset + target_start, line_offset + target_end),
        });
    }
}

fn collect_tags(line: &str, out: &mut Vec<String>) {
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if chars[i] != '#' {
            i += 1;
            continue;
        }

        // Перед тегом — начало строки или знак, не входящий в слово.
        // Иначе `C#` и якорь `файл.md#раздел` стали бы тегами.
        let ok_before = match i.checked_sub(1) {
            None => true,
            Some(previous) => !tag_char(chars[previous]) && chars[previous] != '#',
        };
        if !ok_before {
            i += 1;
            continue;
        }

        let start = i + 1;
        if start >= chars.len() || !tag_start(chars[start]) {
            // `# Заголовок` и `##` — не теги.
            i += 1;
            continue;
        }

        let mut end = start;
        while end < chars.len() && tag_char(chars[end]) {
            end += 1;
        }

        let tag: String = chars[start..end].iter().collect();
        let normalized = normalize_tag(&tag);
        if !normalized.is_empty() && !out.contains(&normalized) {
            out.push(normalized);
        }
        i = end;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn links(text: &str) -> Vec<Link> {
        extract(text, 0).links
    }

    fn tags(text: &str) -> Vec<String> {
        extract(text, 0).tags
    }

    #[test]
    fn finds_a_simple_link() {
        let found = links("Смотри [[Другую заметку]] и всё.\n");

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].target, "Другую заметку");
        assert_eq!(found[0].heading, None);
        assert_eq!(found[0].alias, None);
        assert!(!found[0].embed);
    }

    #[test]
    fn parses_heading_and_alias() {
        let found = links("[[Заметка#Раздел|подпись]]\n");

        assert_eq!(found[0].target, "Заметка");
        assert_eq!(found[0].heading.as_deref(), Some("Раздел"));
        assert_eq!(found[0].alias.as_deref(), Some("подпись"));
    }

    #[test]
    fn recognises_embeds() {
        let found = links("![[Картинка.png]]\n");

        assert_eq!(found[0].target, "Картинка.png");
        assert!(found[0].embed, "вставка должна отличаться от ссылки");
    }

    #[test]
    fn finds_several_links_in_one_line() {
        let found = links("[[Первая]] и [[Вторая]] рядом\n");

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].target, "Первая");
        assert_eq!(found[1].target, "Вторая");
    }

    /// Смещение должно указывать на настоящее начало ссылки: по нему
    /// интерфейс сможет перейти к нужному месту файла.
    #[test]
    fn offset_points_at_the_link() {
        let text = "Первая строка\nвторая со [[Ссылкой]] внутри\n";
        let found = links(text);

        assert_eq!(&text[found[0].offset..found[0].offset + 2], "[[");
    }

    /// Незакрытая ссылка ссылкой не считается — иначе остаток файла
    /// оказался бы её именем.
    #[test]
    fn unclosed_link_is_not_a_link() {
        assert!(links("Начал [[писать и забыл закрыть\n").is_empty());
    }

    #[test]
    fn empty_link_is_ignored() {
        assert!(links("[[]] и [[   ]]\n").is_empty());
    }

    // --- Теги ---

    #[test]
    fn finds_tags() {
        assert_eq!(tags("Текст с #работа и #идеи/личное тут\n"), vec![
            "работа",
            "идеи/личное"
        ]);
    }

    #[test]
    fn tag_case_is_normalised() {
        assert_eq!(tags("#Работа и #РАБОТА\n"), vec!["работа"]);
    }

    /// Заголовок markdown — не тег.
    #[test]
    fn headings_are_not_tags() {
        assert!(tags("# Заголовок\n## Второго уровня\n").is_empty());
    }

    /// Решётка внутри слова — не тег: `C#` это язык, а не тема заметки.
    #[test]
    fn hash_inside_a_word_is_not_a_tag() {
        assert!(tags("Пишу на C# и на F#\n").is_empty());
    }

    /// Номер — не тег.
    #[test]
    fn numeric_hash_is_not_a_tag() {
        assert!(tags("Задача #2026 и дом #15\n").is_empty());
    }

    // --- Код ---

    /// Главная проверка решения Р-069: в блоке кода нет ни тегов, ни ссылок.
    #[test]
    fn fenced_code_is_skipped() {
        let text = "Текст #тег\n\n```cpp\n#include <cstdio>\n// [[не ссылка]]\n```\n\n#после\n";
        let parsed = extract(text, 0);

        assert_eq!(parsed.tags, vec!["тег", "после"]);
        assert!(parsed.links.is_empty(), "{:?}", parsed.links);
    }

    #[test]
    fn tilde_fences_work_too() {
        let text = "~~~\n#include <stdio.h>\n~~~\n#настоящий\n";
        assert_eq!(tags(text), vec!["настоящий"]);
    }

    /// Ограда закрывается только такой же или более длинной: три кавычки
    /// внутри блока из четырёх его не закрывают.
    #[test]
    fn longer_fence_is_not_closed_by_shorter() {
        let text = "````\n```\n#внутри\n````\n#снаружи\n";
        assert_eq!(tags(text), vec!["снаружи"]);
    }

    #[test]
    fn inline_code_is_skipped() {
        let text = "Пример `#include` и `[[не ссылка]]`, а вот #настоящий и [[Ссылка]].\n";
        let parsed = extract(text, 0);

        assert_eq!(parsed.tags, vec!["настоящий"]);
        assert_eq!(parsed.links.len(), 1);
        assert_eq!(parsed.links[0].target, "Ссылка");
    }

    /// Границы цели указывают ровно на то, что надо заменить, — без скобок,
    /// без раздела, без подписи и без пробелов, которые автор поставил внутри.
    ///
    /// Именно эти байты правит переименование (Р-136), и промах здесь означал
    /// бы испорченный чужой файл.
    #[test]
    fn target_span_covers_only_the_target() {
        let text = "Смотри [[ работа/Планы #Раздел | список ]] и всё.\n";
        let found = extract(text, 0).links;

        let (from, to) = found[0].target_span;
        assert_eq!(&text[from..to], "работа/Планы");
    }

    /// Простая ссылка — тот же ответ, без хитростей.
    #[test]
    fn target_span_on_a_plain_link() {
        let text = "Начало [[Планы]] конец.\n";
        let found = extract(text, 0).links;

        let (from, to) = found[0].target_span;
        assert_eq!(&text[from..to], "Планы");
    }

    /// Вставка отличается только восклицательным знаком снаружи скобок.
    #[test]
    fn target_span_works_in_an_embed() {
        let text = "![[Схема]]\n";
        let found = extract(text, 0).links;

        let (from, to) = found[0].target_span;
        assert_eq!(&text[from..to], "Схема");
    }

    /// Маскировка вставок не должна портить смещения: они нужны для перехода.
    #[test]
    fn masking_keeps_offsets_correct() {
        let text = "`код с кириллицей` потом [[Ссылка]]\n";
        let found = links(text);

        assert_eq!(&text[found[0].offset..found[0].offset + 2], "[[");
    }

    // --- Приведение к общему виду ---

    #[test]
    fn link_keys_are_normalised() {
        assert_eq!(link_key("Заметка"), "заметка");
        assert_eq!(link_key("Папка/Заметка.md"), "папка/заметка");
        assert_eq!(link_key(r"Папка\Заметка"), "папка/заметка");
        assert_eq!(link_key("  Заметка  "), "заметка");
    }
}
