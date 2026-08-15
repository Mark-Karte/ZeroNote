//! Реестр буферов.
//!
//! **Содержимого буферов здесь нет, и это не упущение.** По решению Р-002
//! источником истины для текста редактируемого буфера служит фронтенд:
//! документ и без того живёт в CodeMirror, и вторая копия в Rust означала бы
//! два источника истины и постоянную задачу их согласования.
//!
//! Ядро владеет тем, чего фронтенд знать не может: путём, кодировкой, типом
//! переносов, состоянием файла на диске на момент чтения. Текст оно получает
//! в тот момент, когда его надо записать.

use std::path::PathBuf;

use crate::fsx::text_file::DiskState;
use crate::text::encoding::Encoding;
use crate::text::eol::{Eol, EolInfo};

pub type BufferId = u64;

/// Сведения о буфере, которыми владеет ядро.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Buffer {
    pub id: BufferId,
    /// `None` — буфер существует только в памяти и на диске файла не имеет.
    /// Это обычный сценарий, а не исключение: такие буферы тоже переживают
    /// аварийное завершение (инвариант 4).
    pub path: Option<PathBuf>,
    /// Что показывать на вкладке.
    pub title: String,
    pub encoding: Encoding,
    pub bom: bool,
    pub eol: Eol,
    /// В исходном файле были разные типы переносов. Приведение к одному —
    /// решение пользователя, см. Р-018.
    pub eol_mixed: bool,
    pub modified: bool,
    /// Файл помечен «только для чтения» либо буфер в упрощённом режиме.
    pub read_only: bool,
    /// Файл больше порога упрощённого режима.
    pub large: bool,
    /// При чтении встретились байты, недопустимые в выбранной кодировке.
    /// Обратная запись байт в байт уже невозможна.
    pub lossy: bool,
    /// Кодировка определена по метке или строгой проверкой, а не эвристикой.
    pub encoding_confident: bool,
    pub disk: Option<DiskState>,
}

impl Buffer {
    /// Имя вкладки для буфера без файла: «Без имени 1», «Без имени 2», …
    fn untitled_name(number: u32) -> String {
        format!("Без имени {number}")
    }

    fn title_for(path: &std::path::Path) -> String {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            // Путь без имени файла — что-то вроде «C:\». Показывать целиком.
            .unwrap_or_else(|| path.display().to_string())
    }
}

/// Список открытых буферов в порядке вкладок.
#[derive(Debug, Default)]
pub struct Buffers {
    next_id: BufferId,
    /// Счётчик безымянных. Не сбрасывается при закрытии вкладок: иначе
    /// закрыв «Без имени 2» и создав новый, пользователь получил бы второй
    /// «Без имени 2» рядом с уже открытым.
    next_untitled: u32,
    /// Порядок в векторе — это порядок вкладок. Отдельного поля с порядком нет
    /// намеренно: один источник истины вместо двух согласуемых.
    items: Vec<Buffer>,
}

impl Buffers {
    pub fn new() -> Buffers {
        Buffers {
            next_id: 1,
            next_untitled: 1,
            items: Vec::new(),
        }
    }

    /// Восстановить реестр из сессии.
    ///
    /// Номера буферов берутся из снимка, а не выдаются заново: по ним названы
    /// файлы черновиков, и переименование сломало бы связь. Счётчики тоже
    /// восстанавливаются, чтобы новая вкладка не получила номер уже открытой.
    pub fn restore(items: Vec<Buffer>, next_id: BufferId, next_untitled: u32) -> Buffers {
        // Страховка от испорченного снимка: счётчик обязан быть больше любого
        // выданного номера, иначе следующий буфер затрёт существующий.
        let highest = items.iter().map(|b| b.id).max().unwrap_or(0);

        Buffers {
            next_id: next_id.max(highest + 1),
            next_untitled: next_untitled.max(1),
            items,
        }
    }

    pub fn list(&self) -> &[Buffer] {
        &self.items
    }

    /// Счётчики нужны снимку сессии: без них номера буферов начались бы
    /// заново и разошлись бы с именами файлов черновиков.
    pub fn next_id(&self) -> BufferId {
        self.next_id
    }

    pub fn next_untitled(&self) -> u32 {
        self.next_untitled
    }

    pub fn get(&self, id: BufferId) -> Option<&Buffer> {
        self.items.iter().find(|b| b.id == id)
    }

    pub fn get_mut(&mut self, id: BufferId) -> Option<&mut Buffer> {
        self.items.iter_mut().find(|b| b.id == id)
    }

    /// Уже открытый буфер для этого файла, если он есть.
    ///
    /// Открывать один файл дважды нельзя: две вкладки с одним путём — это
    /// два источника истины и гарантированная потеря правок при сохранении.
    pub fn find_by_path(&self, path: &std::path::Path) -> Option<&Buffer> {
        self.items
            .iter()
            .find(|b| b.path.as_deref() == Some(path))
    }

    fn take_id(&mut self) -> BufferId {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Новый пустой буфер без файла.
    pub fn create_untitled(&mut self, eol: Eol) -> &Buffer {
        let id = self.take_id();
        let number = self.next_untitled;
        self.next_untitled += 1;

        self.items.push(Buffer {
            id,
            path: None,
            title: Buffer::untitled_name(number),
            encoding: Encoding::Utf8,
            bom: false,
            eol,
            eol_mixed: false,
            modified: false,
            read_only: false,
            large: false,
            lossy: false,
            encoding_confident: true,
            disk: None,
        });

        self.items.last().expect("буфер только что добавлен")
    }

    /// Буфер для прочитанного файла.
    #[allow(clippy::too_many_arguments)]
    pub fn create_from_file(
        &mut self,
        path: PathBuf,
        encoding: Encoding,
        bom: bool,
        eol: EolInfo,
        lossy: bool,
        encoding_confident: bool,
        read_only: bool,
        large: bool,
        disk: DiskState,
    ) -> &Buffer {
        let id = self.take_id();
        let title = Buffer::title_for(&path);

        self.items.push(Buffer {
            id,
            path: Some(path),
            title,
            encoding,
            bom,
            eol: eol.dominant,
            eol_mixed: eol.mixed,
            modified: false,
            // Большой файл открывается только для чтения — это записано
            // в политике больших файлов, а не решается по месту.
            read_only: read_only || large,
            large,
            lossy,
            encoding_confident,
            disk: Some(disk),
        });

        self.items.last().expect("буфер только что добавлен")
    }

    pub fn close(&mut self, id: BufferId) -> bool {
        let before = self.items.len();
        self.items.retain(|b| b.id != id);
        self.items.len() != before
    }

    /// Переставить вкладку. Позиции за пределами списка прижимаются к краю,
    /// чтобы перетаскивание не могло уронить приложение.
    pub fn reorder(&mut self, id: BufferId, to: usize) -> bool {
        let Some(from) = self.items.iter().position(|b| b.id == id) else {
            return false;
        };

        let to = to.min(self.items.len().saturating_sub(1));
        if from == to {
            return false;
        }

        let buffer = self.items.remove(from);
        self.items.insert(to, buffer);
        true
    }

    /// Отметить буфер сохранённым: путь, состояние на диске, снятый признак
    /// изменения. Заодно обновляется имя вкладки — путь мог смениться
    /// после «сохранить как».
    pub fn mark_saved(&mut self, id: BufferId, path: PathBuf, disk: DiskState) -> bool {
        let Some(buffer) = self.get_mut(id) else {
            return false;
        };

        buffer.title = Buffer::title_for(&path);
        buffer.path = Some(path);
        buffer.disk = Some(disk);
        buffer.modified = false;
        // Записанный нами файл всегда однороден по переносам: мы только что
        // записали его одним типом.
        buffer.eol_mixed = false;
        // Что записали, то и прочитается обратно — потерь больше нет.
        buffer.lossy = false;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disk() -> DiskState {
        DiskState {
            modified_ms: Some(1),
            size: 10,
        }
    }

    fn open_file(buffers: &mut Buffers, path: &str) -> BufferId {
        buffers
            .create_from_file(
                PathBuf::from(path),
                Encoding::Utf8,
                false,
                crate::text::eol::detect("a\nb"),
                false,
                true,
                false,
                false,
                disk(),
            )
            .id
    }

    #[test]
    fn identifiers_are_unique_even_after_closing() {
        let mut buffers = Buffers::new();

        let first = buffers.create_untitled(Eol::CrLf).id;
        buffers.close(first);
        let second = buffers.create_untitled(Eol::CrLf).id;

        assert_ne!(first, second, "переиспользование номера перепутает вкладки");
    }

    /// Закрыв «Без имени 2» и создав новый буфер, нельзя получить второй
    /// «Без имени 2» рядом с уже открытым «Без имени 3».
    #[test]
    fn untitled_numbers_are_not_reused() {
        let mut buffers = Buffers::new();

        assert_eq!(buffers.create_untitled(Eol::CrLf).title, "Без имени 1");
        let second = buffers.create_untitled(Eol::CrLf).id;
        assert_eq!(buffers.create_untitled(Eol::CrLf).title, "Без имени 3");

        buffers.close(second);
        assert_eq!(buffers.create_untitled(Eol::CrLf).title, "Без имени 4");
    }

    /// Один файл — одна вкладка. Две вкладки с одним путём означали бы
    /// два источника истины и потерю правок при сохранении.
    #[test]
    fn finds_already_open_file() {
        let mut buffers = Buffers::new();
        let id = open_file(&mut buffers, r"C:\заметки\файл.md");

        let found = buffers.find_by_path(std::path::Path::new(r"C:\заметки\файл.md"));

        assert_eq!(found.map(|b| b.id), Some(id));
        assert!(
            buffers
                .find_by_path(std::path::Path::new(r"C:\заметки\другой.md"))
                .is_none()
        );
    }

    #[test]
    fn title_comes_from_file_name() {
        let mut buffers = Buffers::new();
        let id = open_file(&mut buffers, r"C:\заметки\важное\список дел.md");

        assert_eq!(buffers.get(id).unwrap().title, "список дел.md");
    }

    /// Большой файл открывается только для чтения — это политика, а не
    /// решение по месту.
    #[test]
    fn large_file_opens_read_only() {
        let mut buffers = Buffers::new();
        let buffer = buffers.create_from_file(
            PathBuf::from(r"C:\журнал.log"),
            Encoding::Utf8,
            false,
            crate::text::eol::detect("a\nb"),
            false,
            true,
            false,
            true,
            disk(),
        );

        assert!(buffer.large);
        assert!(buffer.read_only);
    }

    #[test]
    fn reorder_moves_tab() {
        let mut buffers = Buffers::new();
        let a = open_file(&mut buffers, "a.txt");
        let b = open_file(&mut buffers, "b.txt");
        let c = open_file(&mut buffers, "c.txt");

        buffers.reorder(c, 0);

        let order: Vec<BufferId> = buffers.list().iter().map(|x| x.id).collect();
        assert_eq!(order, vec![c, a, b]);
    }

    /// Перетаскивание за край списка не должно ронять приложение.
    #[test]
    fn reorder_clamps_out_of_range_positions() {
        let mut buffers = Buffers::new();
        let a = open_file(&mut buffers, "a.txt");
        let b = open_file(&mut buffers, "b.txt");

        buffers.reorder(a, 999);

        let order: Vec<BufferId> = buffers.list().iter().map(|x| x.id).collect();
        assert_eq!(order, vec![b, a]);
    }

    /// «Сохранить как» меняет и путь, и имя вкладки.
    #[test]
    fn saving_under_new_name_updates_title_and_path() {
        let mut buffers = Buffers::new();
        let id = buffers.create_untitled(Eol::CrLf).id;

        buffers.mark_saved(id, PathBuf::from(r"D:\проект\заметка.md"), disk());

        let buffer = buffers.get(id).unwrap();
        assert_eq!(buffer.title, "заметка.md");
        assert_eq!(buffer.path, Some(PathBuf::from(r"D:\проект\заметка.md")));
        assert!(!buffer.modified);
    }

    /// После сохранения признак смешанных переносов снимается: мы только что
    /// записали файл одним типом.
    #[test]
    fn saving_clears_mixed_flag() {
        let mut buffers = Buffers::new();
        let id = buffers
            .create_from_file(
                PathBuf::from("m.txt"),
                Encoding::Utf8,
                false,
                crate::text::eol::detect("a\r\nb\nc"),
                false,
                true,
                false,
                false,
                disk(),
            )
            .id;
        assert!(buffers.get(id).unwrap().eol_mixed);

        buffers.mark_saved(id, PathBuf::from("m.txt"), disk());

        assert!(!buffers.get(id).unwrap().eol_mixed);
    }
}
