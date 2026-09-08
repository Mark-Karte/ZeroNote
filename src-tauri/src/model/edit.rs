//! Правка файла по смещениям: что именно меняется и как это отменить.
//!
//! Тип пришёл из задачи 48, где им описывалась правка `[[ссылок]]`
//! в чужих файлах. Задача 88 (замена по проекту) считает ровно такие же
//! правки другим способом, поэтому тип переехал сюда и потерял из имени
//! слово «ссылка»: правка — это тройка «где, что было, что станет»,
//! и кто её посчитал, ей безразлично.

/// Одна правка в файле: где, что было и что станет.
///
/// `was` не для красоты: между показом плана и записью файл могли изменить,
/// и запись вслепую по смещению испортила бы чужой текст. Перед правкой
/// байты сверяются.
///
/// Смещение — байтовое, и считается оно **в раскодированном тексте**,
/// а не в байтах файла. Для UTF-8 это одно и то же, для однобайтовой
/// кодировки — нет, и путать их нельзя: правку применяет `fsx::text_edit`,
/// а он работает с текстом.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEdit {
    pub offset: usize,
    pub was: String,
    pub becomes: String,
}

/// Что изменится в одном файле.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEdits {
    pub path: String,
    /// Путь внутри корня — его и показывают человеку.
    pub inside: String,
    pub edits: Vec<TextEdit>,
}

/// Правки, возвращающие файл в прежний вид.
///
/// Отмена замены по проекту (решение владельца: пять последних) хранит
/// не старое содержимое файлов, а обратные правки. Причин две. Первая —
/// размер: замена в тысяче файлов хранила бы тысячу копий, а обратных
/// правок столько же, сколько совпадений, и каждая — две короткие строки.
/// Вторая важнее: обратная правка сверяется по байтам так же, как прямая,
/// поэтому файл, изменённый после замены, отмена не тронет вовсе, — а запись
/// сохранённой копии затёрла бы чужую работу молча.
///
/// Смещения пересчитываются: после замены текст сдвинулся на разницу длин
/// всех правок левее. Порядок обратных правок — по возрастанию смещения,
/// как и у прямых.
pub fn invert(edits: &[TextEdit]) -> Vec<TextEdit> {
    let mut sorted: Vec<&TextEdit> = edits.iter().collect();
    sorted.sort_by_key(|edit| edit.offset);

    let mut drift: isize = 0;
    let mut out = Vec::with_capacity(sorted.len());

    for edit in sorted {
        let offset = edit.offset as isize + drift;
        out.push(TextEdit {
            offset: offset.max(0) as usize,
            was: edit.becomes.clone(),
            becomes: edit.was.clone(),
        });
        drift += edit.becomes.len() as isize - edit.was.len() as isize;
    }

    out
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

    /// Обратная правка одной замены — та же правка наоборот.
    #[test]
    fn single_edit_swaps_sides() {
        let back = invert(&[edit(7, "старое", "новое")]);

        assert_eq!(back, vec![edit(7, "новое", "старое")]);
    }

    /// Вторая правка едет на разницу длин первой, третья — на сумму двух.
    ///
    /// Это и есть всё содержание функции: если бы длины совпадали, ошибку
    /// здесь заметить было бы нечем.
    #[test]
    fn later_edits_move_by_the_length_difference() {
        let back = invert(&[
            edit(0, "аб", "абвг"),
            edit(10, "де", "ё"),
            edit(20, "ж", "з"),
        ]);

        // «аб» → «абвг»: текст удлинился на 4 байта (две буквы кириллицы).
        assert_eq!(back[0], edit(0, "абвг", "аб"));
        assert_eq!(back[1], edit(14, "ё", "де"));
        // «де» → «ё»: минус два байта. Итого сдвиг третьей правки +2.
        assert_eq!(back[2], edit(22, "з", "ж"));
    }

    /// Порядок на входе значения не имеет: смещения считаются слева направо.
    #[test]
    fn order_of_the_input_does_not_matter() {
        let forward = vec![edit(20, "ж", "з"), edit(0, "аб", "абвг")];

        assert_eq!(invert(&forward), invert(&[forward[1].clone(), forward[0].clone()]));
    }
}
