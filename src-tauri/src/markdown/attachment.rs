//! Вложения заметки: куда ложится картинка из буфера обмена и какой
//! ссылкой она вставляется (задача 146).
//!
//! Настройка записывается значениями Obsidian — теми же, что его
//! `attachmentFolderPath` в `.obsidian/app.json`: `./` — папка заметки,
//! `./имя` — вложенная папка рядом с ней, `/` — корень, `имя` — одна
//! папка проекта от корня. Человеку, пришедшему из Obsidian, учить нечего,
//! а хранилище, общее с Obsidian, получает файлы там, где их ждут.
//!
//! Здесь только чистые функции: что значит настройка, где папка, как
//! назвать файл и какую вставить ссылку. Диск трогает команда
//! (`commands/notes.rs`).

use std::path::{Component, Path, PathBuf};

/// Где лежат вложения заметки.
///
/// В `settings.toml` это строка (`[notes] attachments`), а в коде — уже
/// разобранное значение. Разбором заведует serde: `try_from = "String"`
/// значит «прочитать строку и превратить её через `TryFrom<String>`»,
/// `into = "String"` — «записать обратно через `From`». Негодная строка
/// становится ошибкой разбора, и терпимое чтение настроек называет её
/// полосой предупреждений и берёт умолчание (Р-248).
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub enum Attachments {
    /// `./` — в папку самой заметки. Умолчание: так владелец назвал первым.
    #[default]
    NoteFolder,
    /// `./имя` — во вложенную папку рядом с заметкой. Путь через `/`.
    BesideNote(String),
    /// `/` — в корень проекта заметки. Умолчание Obsidian.
    Root,
    /// `имя` — в одну папку проекта, путь от корня через `/`.
    InRoot(String),
}

impl Attachments {
    /// Разобрать строку настройки. Ошибка — фраза для полосы
    /// предупреждений: что не так и как можно.
    pub fn parse(value: &str) -> Result<Attachments, String> {
        // Обратная косая в Windows — та же черта, пишут и так, и так.
        let text = value.trim().replace('\\', "/");
        match text.as_str() {
            // Пусто — как у соседних ключей `[notes]`: значит умолчание.
            "" | "." | "./" => return Ok(Attachments::NoteFolder),
            "/" => return Ok(Attachments::Root),
            _ => {}
        }

        if let Some(rest) = text.strip_prefix("./") {
            return Ok(Attachments::BesideNote(folder_path(rest, value)?));
        }
        // `/имя` Obsidian не пишет, но значит это то же, что `имя`: путь
        // от корня. Одну черту снимаем; две подряд — сетевой путь, и его
        // отвергнет проверка пустой части.
        let rest = text.strip_prefix('/').unwrap_or(&text);
        Ok(Attachments::InRoot(folder_path(rest, value)?))
    }

    /// Папка, куда ляжет вложение заметки `note`.
    ///
    /// `root` — корень проекта заметки. `None` — заметка вне проектов,
    /// и тогда `/` и `имя` означают папку заметки: корня, от которого
    /// считать, у неё нет, а класть картинку наугад нельзя. `None`
    /// на выходе — у пути заметки нет папки.
    pub fn folder(&self, note: &Path, root: Option<&Path>) -> Option<PathBuf> {
        let beside = note.parent()?;
        Some(match (self, root) {
            (Attachments::NoteFolder, _) => beside.to_path_buf(),
            (Attachments::BesideNote(sub), _) => join(beside, sub),
            (Attachments::Root, Some(root)) => root.to_path_buf(),
            (Attachments::InRoot(sub), Some(root)) => join(root, sub),
            (Attachments::Root | Attachments::InRoot(_), None) => beside.to_path_buf(),
        })
    }
}

impl TryFrom<String> for Attachments {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Attachments::parse(&value)
    }
}

impl From<Attachments> for String {
    fn from(value: Attachments) -> String {
        match value {
            Attachments::NoteFolder => "./".to_owned(),
            Attachments::BesideNote(sub) => format!("./{sub}"),
            Attachments::Root => "/".to_owned(),
            Attachments::InRoot(sub) => sub,
        }
    }
}

/// Проверить путь папки и привести к виду `a/b`.
fn folder_path(rest: &str, original: &str) -> Result<String, String> {
    let rest = rest.trim_end_matches('/');
    let mut parts = Vec::new();
    for part in rest.split('/') {
        check_part(part)
            .map_err(|why| format!("«{original}» — {why}; можно ./, ./имя, / или имя"))?;
        parts.push(part);
    }
    Ok(parts.join("/"))
}

/// Годится ли часть пути именем папки. Проверяется по тексту, до диска:
/// из этой строки складывается путь, куда пишется файл.
fn check_part(part: &str) -> Result<(), &'static str> {
    if part.is_empty() {
        return Err("пустое имя папки — две черты подряд или сетевой путь");
    }
    if part == "." || part == ".." {
        return Err("папка вложений не выходит за папку заметки или проекта");
    }
    // Двоеточие отсекает и диск (`C:`), и альтернативный поток (`a:b`).
    if part.chars().any(|c| c.is_control() || "<>:\"|?*".contains(c)) {
        return Err("в имени папки знак, которого Windows в именах не допускает");
    }
    // Windows отбрасывает точки и пробелы на конце, и `.obsidian.` — это
    // `.obsidian` (Р-299): такое имя не значит того, что написано.
    if part.ends_with('.') || part.ends_with(' ') {
        return Err("имя папки кончается точкой или пробелом — Windows их отбрасывает");
    }
    if part.eq_ignore_ascii_case(".obsidian") {
        return Err("в .obsidian ZeroNote не пишет (инвариант 2)");
    }
    Ok(())
}

/// Приложить путь вида `a/b` к папке.
fn join(base: &Path, sub: &str) -> PathBuf {
    sub.split('/').fold(base.to_path_buf(), |path, part| path.join(part))
}

/// Имя файла картинки — как у Obsidian: `Pasted image 20260928143012.png`.
///
/// Отметку времени приносит окно, как дату ежедневной заметки: у ядра нет
/// часового пояса. Ядро ей не верит — из неё складывается имя файла.
/// `number` — очередной номер, когда имя занято: `… 1.png`, `… 2.png`,
/// как у Obsidian.
pub fn image_name(stamp: &str, number: u32) -> Result<String, String> {
    if stamp.len() != 14 || !stamp.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("отметка времени «{stamp}» не похожа на 20260928143012"));
    }
    Ok(if number == 0 {
        format!("Pasted image {stamp}.png")
    } else {
        format!("Pasted image {stamp} {number}.png")
    })
}

/// Как сослаться на вложение из текста заметки.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkForm<'a> {
    /// `![[имя]]` — имя разрешает индекс (Р-217). Как у Obsidian
    /// по умолчанию, и ссылка переживает перенос файла внутри проекта.
    Name,
    /// `![[путь/от/корня]]` — имя в проекте уже занято другим файлом,
    /// и одно имя привело бы не к той картинке.
    RootPath(&'a Path),
    /// `![](<путь>)` — относительно папки заметки. Для заметки вне
    /// проектов и для вложения, которое индекс не видит (правила
    /// игнорирования): `![[…]]` там не показался бы никогда.
    Relative,
}

/// Ссылка на вложение `file` из заметки `note`. `None` — путь не выразить
/// ссылкой (разные диски, имя не в Юникоде).
pub fn link(note: &Path, file: &Path, form: LinkForm) -> Option<String> {
    match form {
        LinkForm::Name => Some(format!("![[{}]]", file.file_name()?.to_str()?)),
        LinkForm::RootPath(root) => {
            let inside = file.strip_prefix(root).ok()?;
            Some(format!("![[{}]]", slashed(inside)?))
        }
        LinkForm::Relative => {
            let relative = relative_to(note.parent()?, file)?;
            // Угловые скобки — запись markdown для пути с пробелами:
            // в имени `Pasted image …` они есть всегда.
            Some(format!("![](<{}>)", slashed(&relative)?))
        }
    }
}

/// Путь через `/`, как пишут в markdown.
fn slashed(path: &Path) -> Option<String> {
    let parts: Option<Vec<&str>> = path.iter().map(|part| part.to_str()).collect();
    Some(parts?.join("/"))
}

/// Путь `to` относительно папки `from`, с `..`, если нужно выйти вверх.
///
/// Части сравниваются как написаны: оба пути сложены из одного корня
/// или одной папки заметки, и разного написания одной папки здесь не бывает.
fn relative_to(from: &Path, to: &Path) -> Option<PathBuf> {
    let from: Vec<Component> = from.components().collect();
    let to: Vec<Component> = to.components().collect();
    // Диск или сетевая папка разные — относительного пути нет.
    if from.first() != to.first() {
        return None;
    }
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut out = PathBuf::new();
    for _ in common..from.len() {
        out.push("..");
    }
    for part in &to[common..] {
        out.push(part.as_os_str());
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(value: &str) -> Attachments {
        Attachments::parse(value).unwrap_or_else(|e| panic!("{value}: {e}"))
    }

    #[test]
    fn values_are_read_as_obsidian_writes_them() {
        assert_eq!(parsed("./"), Attachments::NoteFolder);
        assert_eq!(parsed("/"), Attachments::Root);
        assert_eq!(parsed("./attachments"), Attachments::BesideNote("attachments".into()));
        assert_eq!(parsed("Вложения/Картинки"), Attachments::InRoot("Вложения/Картинки".into()));
    }

    /// Пусто — умолчание, как у соседних ключей; косые обоих видов,
    /// черта на конце и `/имя` читаются тем же.
    #[test]
    fn loose_spellings_mean_the_same() {
        assert_eq!(parsed(""), Attachments::NoteFolder);
        assert_eq!(parsed("."), Attachments::NoteFolder);
        assert_eq!(parsed(r".\img\"), Attachments::BesideNote("img".into()));
        assert_eq!(parsed("/Вложения/"), Attachments::InRoot("Вложения".into()));
        assert_eq!(parsed("  a\\b  "), Attachments::InRoot("a/b".into()));
    }

    /// Всё, что вывело бы запись за папку заметки или проекта, в сеть
    /// или в `.obsidian`, — отказ со словами.
    #[test]
    fn paths_out_of_place_are_refused() {
        for bad in [
            "../x",
            "./a/../../x",
            r"C:\Users\x",
            r"\\сервер\папка",
            "//сервер/папка",
            "a//b",
            ".obsidian",
            "./.OBSIDIAN/img",
            "img.",
            "img /x",
            "a:b",
            "a*b",
        ] {
            let error = Attachments::parse(bad).expect_err(bad);
            assert!(error.contains("можно ./, ./имя, / или имя"), "{bad}: {error}");
        }
    }

    #[test]
    fn written_back_as_read() {
        for value in ["./", "/", "./attachments", "Вложения/Картинки"] {
            assert_eq!(String::from(parsed(value)), value);
        }
    }

    #[test]
    fn folder_by_setting() {
        let root = Path::new(r"C:\Хранилище");
        let note = Path::new(r"C:\Хранилище\Проекты\Заметка.md");
        let at = |value: &str| parsed(value).folder(note, Some(root)).unwrap();

        assert_eq!(at("./"), Path::new(r"C:\Хранилище\Проекты"));
        assert_eq!(at("./img/2026"), Path::new(r"C:\Хранилище\Проекты\img\2026"));
        assert_eq!(at("/"), Path::new(r"C:\Хранилище"));
        assert_eq!(at("Вложения"), Path::new(r"C:\Хранилище\Вложения"));
    }

    /// Вне проектов корня нет: `/` и `имя` кладут в папку заметки,
    /// а `./имя` — как обычно, рядом с ней.
    #[test]
    fn note_outside_projects_keeps_it_beside() {
        let note = Path::new(r"C:\Разное\Заметка.md");
        let at = |value: &str| parsed(value).folder(note, None).unwrap();

        assert_eq!(at("/"), Path::new(r"C:\Разное"));
        assert_eq!(at("Вложения"), Path::new(r"C:\Разное"));
        assert_eq!(at("./img"), Path::new(r"C:\Разное\img"));
    }

    #[test]
    fn names_as_obsidian_gives_them() {
        assert_eq!(image_name("20260928143012", 0).unwrap(), "Pasted image 20260928143012.png");
        assert_eq!(image_name("20260928143012", 2).unwrap(), "Pasted image 20260928143012 2.png");
    }

    /// Из отметки складывается имя файла: `..\` в ней — не время.
    #[test]
    fn stamp_is_not_trusted() {
        for bad in ["", "2026-09-28", r"..\..\x.png12", "2026092814301٣", "202609281430123"] {
            assert!(image_name(bad, 0).is_err(), "{bad}");
        }
    }

    #[test]
    fn links_by_form() {
        let root = Path::new(r"C:\Хранилище");
        let note = Path::new(r"C:\Хранилище\Проекты\Заметка.md");
        let beside = Path::new(r"C:\Хранилище\Проекты\img\Pasted image 1.png");
        let far = Path::new(r"C:\Хранилище\Вложения\Pasted image 1.png");

        assert_eq!(link(note, far, LinkForm::Name).unwrap(), "![[Pasted image 1.png]]");
        assert_eq!(
            link(note, far, LinkForm::RootPath(root)).unwrap(),
            "![[Вложения/Pasted image 1.png]]"
        );
        assert_eq!(
            link(note, beside, LinkForm::Relative).unwrap(),
            "![](<img/Pasted image 1.png>)"
        );
        assert_eq!(
            link(note, far, LinkForm::Relative).unwrap(),
            "![](<../Вложения/Pasted image 1.png>)"
        );
    }

    #[test]
    fn no_relative_link_across_drives() {
        let note = Path::new(r"C:\Заметки\Заметка.md");
        let file = Path::new(r"D:\Картинки\Pasted image 1.png");
        assert_eq!(link(note, file, LinkForm::Relative), None);
    }
}
