//! Правка файла, который пользователь не открывал (Р-136).
//!
//! Самое опасное место проекта: здесь приложение меняет чужой файл по своей
//! инициативе. Поэтому правил больше, чем кода.
//!
//! * меняются только те куски, которые названы в правках, — цель `[[ссылки]]`
//!   при переименовании (задача 48), найденный текст при замене по проекту
//!   (задача 88). Всё остальное содержимое не участвует вовсе;
//! * текст читается **без приведения переносов строк** и пишется обратно
//!   той же кодировкой: у файла со смешанными переносами они останутся
//!   смешанными;
//! * байты по каждому смещению сверяются с ожидаемыми до правки. План мог
//!   устареть — файл успели изменить между показом списка и согласием;
//! * запись атомарная (инвариант 3), а в `.obsidian` не пишется ничего
//!   (инвариант 2) — и то и другое обеспечивает `atomic_save`.

use std::path::Path;

use crate::model::edit::TextEdit;
use crate::text::document;
use crate::text::encoding::Encoding;

#[derive(Debug)]
pub enum EditError {
    Read(String),
    /// Байты по смещению — не те, что были при расчёте плана.
    Stale { offset: usize, expected: String },
    /// Файл не раскодировался без потерь: обратная запись не восстановит байты.
    Lossy,
    Write(String),
}

impl std::fmt::Display for EditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EditError::Read(e) => write!(f, "не удалось прочитать: {e}"),
            EditError::Stale { offset, expected } => write!(
                f,
                "файл изменился: на месте «{expected}» (смещение {offset}) теперь другое"
            ),
            EditError::Lossy => write!(
                f,
                "файл не читается этой кодировкой без потерь — правка испортила бы его"
            ),
            EditError::Write(e) => write!(f, "не удалось записать: {e}"),
        }
    }
}

impl std::error::Error for EditError {}

/// Подставить правки в текст.
///
/// Отдельной функцией и без файловой системы — ради проверяемости: именно
/// здесь можно ошибиться смещением на единицу и испортить чужой текст.
/// Правки применяются с конца, иначе первая же смена длины сдвинула бы
/// все следующие смещения.
pub fn rewrite(text: &str, edits: &[TextEdit]) -> Result<String, EditError> {
    let mut sorted: Vec<&TextEdit> = edits.iter().collect();
    sorted.sort_by_key(|edit| std::cmp::Reverse(edit.offset));

    let mut out = text.to_owned();
    for edit in sorted {
        let end = edit.offset + edit.was.len();
        let matches = out
            .get(edit.offset..end)
            .is_some_and(|found| found == edit.was);

        if !matches {
            return Err(EditError::Stale {
                offset: edit.offset,
                expected: edit.was.clone(),
            });
        }
        out.replace_range(edit.offset..end, &edit.becomes);
    }

    Ok(out)
}

/// Поправить файл на диске.
///
/// `hint` — кодировка, которую знает проект файла (`[editor]
/// default_encoding`): тот же ответ, по которому файл открывается
/// в редакторе, иначе правка вписала бы текст в чужой кодировке (задача 138).
pub fn apply(path: &Path, edits: &[TextEdit], hint: Option<Encoding>) -> Result<(), EditError> {
    let bytes = std::fs::read(path).map_err(|e| EditError::Read(e.to_string()))?;
    let raw = document::read_raw(&bytes, hint).map_err(|e| EditError::Read(e.to_string()))?;

    if raw.lossy {
        return Err(EditError::Lossy);
    }

    let text = rewrite(&raw.text, edits)?;
    let out = document::raw_to_bytes(&text, raw.encoding, raw.bom)
        .map_err(|e| EditError::Write(e.to_string()))?;

    super::atomic_save::save(path, &out).map_err(|e| EditError::Write(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(offset: usize, was: &str, becomes: &str) -> TextEdit {
        TextEdit {
            offset,
            was: was.to_owned(),
            becomes: becomes.to_owned(),
        }
    }

    /// Смещение ищется, а не пишется числом: оно байтовое, а кириллица
    /// занимает по два байта на букву — считать такое руками значит однажды
    /// посчитать неверно и записать неверный ответ в тест.
    fn at(text: &str, what: &str, becomes: &str) -> TextEdit {
        edit(text.find(what).expect("такого куска в тексте нет"), what, becomes)
    }

    #[test]
    fn replaces_the_target_and_nothing_else() {
        let text = "Смотри [[Планы#Раздел|список]] и всё.\n";
        let out = rewrite(text, &[at(text, "Планы", "Задачи")]).unwrap();

        assert_eq!(out, "Смотри [[Задачи#Раздел|список]] и всё.\n");
    }

    /// Две правки в одной строке: применяются с конца, иначе вторая уедет.
    ///
    /// Имена подобраны разной длины намеренно — при равной длине ошибка
    /// порядка не проявилась бы вовсе.
    #[test]
    fn several_edits_do_not_shift_each_other() {
        let text = "[[Планы]] и [[Идея]]\n";
        let out = rewrite(
            text,
            &[
                at(text, "Планы", "Долгосрочные планы"),
                at(text, "Идея", "Мысль"),
            ],
        )
        .unwrap();

        assert_eq!(out, "[[Долгосрочные планы]] и [[Мысль]]\n");
    }

    /// Переносы строк не трогаются вовсе — в том числе смешанные.
    #[test]
    fn line_endings_are_left_alone() {
        let text = "Первая\r\n[[Планы]]\nТретья\r\n";
        let out = rewrite(text, &[at(text, "Планы", "Задачи")]).unwrap();

        assert_eq!(out, "Первая\r\n[[Задачи]]\nТретья\r\n");
    }

    /// План устарел — правка не делается вовсе, ни одна из.
    ///
    /// Это главное свойство: испорченный чужой файл хуже неисправленной
    /// ссылки. Ошибка называет смещение, чтобы её можно было показать.
    #[test]
    fn stale_plan_changes_nothing() {
        let text = "Смотри [[Другое]].\n";
        let result = rewrite(text, &[edit(9, "Планы", "Задачи")]);

        assert!(matches!(result, Err(EditError::Stale { .. })));
    }

    /// Смещение за концом файла — тот же отказ, а не паника.
    #[test]
    fn offset_past_the_end_is_refused() {
        let result = rewrite("коротко", &[edit(1000, "Планы", "Задачи")]);

        assert!(matches!(result, Err(EditError::Stale { .. })));
    }

    /// Смещение в середине буквы — тоже отказ: срез по такой границе
    /// уронил бы процесс, а `get` возвращает `None`.
    #[test]
    fn offset_inside_a_letter_is_refused() {
        let result = rewrite("Планы", &[edit(1, "ланы", "другое")]);

        assert!(matches!(result, Err(EditError::Stale { .. })));
    }

    /// Пакетная правка пишет кодировкой, которой файл открывается
    /// (задача 138, находка Ф6 ревизии).
    ///
    /// Прописная кириллица в windows-1251 эвристика читает как строчную
    /// KOI8-R. Редактор открывает такой файл верно — ему помогает подсказка
    /// проекта (`[editor] default_encoding`), а пакетная правка до задачи
    /// 138 подсказки не знала: «СДЕЛАТЬ» вписывалось в KOI8-R, и в файле,
    /// открытом как windows-1251, появлялось «удембфш».
    #[test]
    fn project_encoding_hint_is_respected() {
        use crate::text::encoding::{self, Encoding};

        let bytes = encoding::encode("ВНИМАНИЕ: TODO", Encoding::Windows1251).unwrap();
        // Без этого тест ничего не проверяет: эвристика обязана ошибаться.
        assert_ne!(
            crate::text::detect::detect(&bytes).unwrap().encoding,
            Encoding::Windows1251
        );

        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-hint-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("заметка.txt");
        std::fs::write(&path, &bytes).unwrap();

        let text = "ВНИМАНИЕ: TODO";
        apply(&path, &[at(text, "TODO", "СДЕЛАТЬ")], Some(Encoding::Windows1251)).unwrap();

        let written = std::fs::read(&path).unwrap();
        assert_eq!(
            encoding::decode(&written, Encoding::Windows1251).text,
            "ВНИМАНИЕ: СДЕЛАТЬ"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
