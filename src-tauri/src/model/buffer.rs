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

/// Вид вкладки (Р-180).
///
/// Поле буфера, а не отдельный список во фронтенде: порядок вкладок, активная
/// вкладка и сессия обязаны лежать в одном месте. Два списка разъехались бы
/// на первом же перетаскивании вкладки — и разъехались бы молча.
///
/// Видов четыре, и каждый пришёл вместе со своим кодом: значение
/// перечисления, которого никто не создаёт, — это ветка `match`, которая
/// никогда не выполняется, и проверить её нечем.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TabKind {
    /// Текстовый буфер: путь, кодировка, переносы, содержимое.
    #[default]
    Text,
    /// Параметры приложения. Ни файла, ни байтов, ни кодировки.
    Settings,
    /// Картинка: файл есть, а текста в нём нет.
    Image,
    /// PDF: показываем, и только показываем (Р-181).
    Pdf,
}

/// Что открывается картинкой, а не текстом.
///
/// Список канонический: по нему ядро решает вид вкладки, и он же зеркалится
/// во фронтенд для фильтра в окне выбора файла. Сверяет их
/// `tests/file-types.test.ts`.
///
/// **`svg` сюда не входит, и это решение** (Р-192). Формат векторной графики —
/// это разметка, то есть текст; показать его картинкой значит отнять
/// возможность его править, а мы редактор текста. Посмотреть на него можно
/// в браузере, поправить — больше нигде.
///
/// `tif` и `tiff` не входят по другой причине: их не показывает сам движок
/// окна, и вкладка вышла бы пустой.
pub const IMAGE_EXTENSIONS: [&str; 8] = [
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif",
];

impl TabKind {
    /// Каким видом открывать этот путь.
    ///
    /// По расширению, а не по содержимому файла: заглядывать внутрь пришлось бы
    /// перед каждым открытием, а ошибиться подписью файла человек может ровно
    /// так же, как ошибается расширением. Что делать с файлом, который назвался
    /// картинкой, но ею не является, решает показ: он честно скажет, что
    /// показать нечего.
    pub fn for_path(path: &std::path::Path) -> TabKind {
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
            TabKind::Image
        } else if extension == "pdf" {
            TabKind::Pdf
        } else {
            TabKind::Text
        }
    }

    /// Тип содержимого для адреса `data:`.
    ///
    /// `None` — расширение не наше. Своя таблица, а не угадывание по байтам:
    /// движок окна всё равно смотрит на содержимое сам, а тип в адресе нужен
    /// ему лишь как подсказка.
    pub fn image_mime(path: &std::path::Path) -> Option<&'static str> {
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        Some(match extension.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "ico" => "image/x-icon",
            "avif" => "image/avif",
            _ => return None,
        })
    }

    /// Как вид записывается в снимок сессии.
    pub fn as_str(self) -> &'static str {
        match self {
            TabKind::Text => "text",
            TabKind::Settings => "settings",
            TabKind::Image => "image",
            TabKind::Pdf => "pdf",
        }
    }

    /// Как вид записывается в снимок сессии.
    ///
    /// У текста — пусто, и это не экономия места. Снимок, в котором открыты
    /// одни текстовые вкладки, обязан читаться прошлой версией приложения,
    /// а у неё `deny_unknown_fields` и про поле `kind` она не знает: одна
    /// лишняя строка означала бы «после отката все вкладки закрылись».
    pub fn to_snapshot(self) -> String {
        match self {
            TabKind::Text => String::new(),
            other => other.as_str().to_owned(),
        }
    }

    /// Разобрать вид из снимка. `None` — вид из более новой версии.
    ///
    /// В снимке вид лежит строкой, а не перечислением, по той же причине,
    /// по которой строкой лежит панель боковой полосы: незнакомое значение
    /// не должно отвергать снимок целиком. Пропустить одну вкладку — потеря
    /// одной вкладки, отвергнуть снимок — потеря всех.
    pub fn parse(text: &str) -> Option<TabKind> {
        match text {
            // Пусто — снимок от версии, которая видов не знала: там всё текст.
            "" | "text" => Some(TabKind::Text),
            "settings" => Some(TabKind::Settings),
            "image" => Some(TabKind::Image),
            "pdf" => Some(TabKind::Pdf),
            _ => None,
        }
    }
}

/// Сведения о буфере, которыми владеет ядро.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Buffer {
    pub id: BufferId,
    /// Что это за вкладка. Рядом с путём, потому что это свойство того же
    /// порядка: чем вкладка является, а не что в ней сейчас набрано.
    pub kind: TabKind,
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

    /// Вкладка параметров с заданным номером.
    ///
    /// Одна функция и для создания, и для восстановления из сессии: вкладка,
    /// собранная при запуске, обязана быть той же самой, что созданная
    /// нажатием. Разойдись они — разница вылезла бы через месяц и не там,
    /// где сделана.
    pub fn settings(id: BufferId) -> Buffer {
        Buffer {
            id,
            kind: TabKind::Settings,
            path: None,
            title: "Параметры".to_owned(),
            // Кодировка, переносы и состояние на диске к этой вкладке
            // не относятся: ни файла, ни байтов у неё нет. Значения ниже
            // нейтральные, и смотреть на них нельзя — смотрит только тот,
            // кто сначала проверил вид вкладки.
            encoding: Encoding::Utf8,
            bom: false,
            eol: Eol::Lf,
            eol_mixed: false,
            modified: false,
            // Правка запрещена, и это не условность: текста, который можно
            // было бы править, у вкладки нет вовсе. Отсюда бесплатно
            // получается и то, что её не тронет автосохранение.
            read_only: true,
            large: false,
            lossy: false,
            encoding_confident: true,
            disk: None,
        }
    }

    /// Вкладка, которую только показывают: картинка или PDF.
    ///
    /// Файл у неё есть, а текста в нём нет: кодировка, переносы и признак
    /// изменения к ней не относятся так же, как к вкладке параметров.
    /// Состояние на диске хранится настоящее — из него берётся вес файла
    /// для строки состояния, и по нему же видно, что файл подменили.
    ///
    /// Одна функция на два вида, а не две почти одинаковых: разойдись они,
    /// разница вылезла бы через месяц и не там, где сделана.
    pub fn viewed(id: BufferId, path: PathBuf, disk: DiskState, kind: TabKind) -> Buffer {
        debug_assert!(
            matches!(kind, TabKind::Image | TabKind::Pdf),
            "показом открываются только картинка и PDF"
        );
        let title = Buffer::title_for(&path);

        Buffer {
            id,
            kind,
            path: Some(path),
            title,
            // Значения ниже нейтральные и ничего не значат: смотреть на них
            // может только тот, кто сначала проверил вид вкладки.
            encoding: Encoding::Utf8,
            bom: false,
            eol: Eol::Lf,
            eol_mixed: false,
            modified: false,
            // Правка запрещена: править картинку или PDF мы не умеем
            // и не собираемся (Р-181).
            read_only: true,
            large: false,
            lossy: false,
            encoding_confident: true,
            disk: Some(disk),
        }
    }

    fn title_for(path: &std::path::Path) -> String {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            // Путь без имени файла — что-то вроде «C:\». Показывать целиком.
            .unwrap_or_else(|| path.display().to_string())
    }
}

/// Реестр открытых буферов.
///
/// До этапа 11 порядок в списке был порядком вкладок. Теперь порядок вкладок
/// живёт в раскладке (`model/layout.rs`, Р-207): у каждой области он свой,
/// а буфер может лежать в нескольких. Здесь остался порядок создания,
/// и смотреть на него нельзя.
#[derive(Debug, Default)]
pub struct Buffers {
    next_id: BufferId,
    /// Счётчик безымянных. Не сбрасывается при закрытии вкладок: иначе
    /// закрыв «Без имени 2» и создав новый, пользователь получил бы второй
    /// «Без имени 2» рядом с уже открытым.
    next_untitled: u32,
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
            kind: TabKind::Text,
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

    /// Вкладка параметров — одна на окно.
    ///
    /// Повторное нажатие обязано показать уже открытую, а не завести вторую:
    /// иначе через неделю работы у человека шесть одинаковых вкладок
    /// «Параметры». Та же мысль, что у `find_by_path` для файлов, и та же
    /// причина: два места, показывающие одно, расходятся молча.
    pub fn create_settings(&mut self) -> &Buffer {
        if let Some(index) = self
            .items
            .iter()
            .position(|b| b.kind == TabKind::Settings)
        {
            return &self.items[index];
        }

        let id = self.take_id();
        self.items.push(Buffer::settings(id));
        self.items.last().expect("буфер только что добавлен")
    }

    /// Вкладка, которую только показывают: картинка или PDF.
    pub fn create_viewed(&mut self, path: PathBuf, disk: DiskState, kind: TabKind) -> &Buffer {
        let id = self.take_id();
        self.items.push(Buffer::viewed(id, path, disk, kind));
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
            kind: TabKind::Text,
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

    /// Файл переехал: его переименовали или переименовали папку над ним.
    ///
    /// Меняются только путь и имя вкладки. Содержимое, признак изменения
    /// и состояние на диске остаются: файл тот же самый, у него просто
    /// другое имя, и объявлять его сохранённым нельзя — несохранённые правки
    /// никуда не делись.
    pub fn move_to(&mut self, id: BufferId, path: PathBuf) -> bool {
        let Some(buffer) = self.get_mut(id) else {
            return false;
        };

        buffer.title = Buffer::title_for(&path);
        buffer.path = Some(path);
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

    /// Вид по умолчанию — текст: без него старый код и старые снимки
    /// означали бы вкладку неизвестно чего.
    #[test]
    fn ordinary_buffers_are_text() {
        let mut buffers = Buffers::new();
        let untitled = buffers.create_untitled(Eol::CrLf).id;
        let file = open_file(&mut buffers, "a.txt");

        assert_eq!(buffers.get(untitled).unwrap().kind, TabKind::Text);
        assert_eq!(buffers.get(file).unwrap().kind, TabKind::Text);
    }

    /// Вкладка параметров одна: второе нажатие показывает открытую.
    #[test]
    fn settings_tab_is_single() {
        let mut buffers = Buffers::new();

        let first = buffers.create_settings().id;
        let second = buffers.create_settings().id;

        assert_eq!(first, second);
        assert_eq!(buffers.list().len(), 1);
    }

    /// Закрыв параметры, их можно открыть снова — и это уже другая вкладка.
    #[test]
    fn settings_tab_returns_after_closing() {
        let mut buffers = Buffers::new();
        let first = buffers.create_settings().id;

        buffers.close(first);
        let second = buffers.create_settings().id;

        assert_ne!(first, second, "переиспользование номера перепутает вкладки");
        assert_eq!(buffers.list().len(), 1);
    }

    /// У вкладки параметров нет файла и нет правки. Первое означает, что
    /// её нечего сохранять, второе — что закрывается она без вопросов.
    #[test]
    fn settings_tab_has_no_file_and_no_edits() {
        let mut buffers = Buffers::new();
        let buffer = buffers.create_settings();

        assert_eq!(buffer.kind, TabKind::Settings);
        assert_eq!(buffer.path, None);
        assert!(!buffer.modified);
        assert!(buffer.read_only);
    }

    /// Картинка узнаётся по расширению, и регистр значения не имеет:
    /// `СНИМОК.PNG` из проводника приходит ровно так.
    #[test]
    fn images_are_recognised_by_extension() {
        use std::path::Path;

        assert_eq!(TabKind::for_path(Path::new(r"C:\снимок.png")), TabKind::Image);
        assert_eq!(TabKind::for_path(Path::new(r"C:\СНИМОК.PNG")), TabKind::Image);
        assert_eq!(TabKind::for_path(Path::new("фото.JPEG")), TabKind::Image);
        assert_eq!(TabKind::for_path(Path::new("заметка.md")), TabKind::Text);
        assert_eq!(TabKind::for_path(Path::new("без-расширения")), TabKind::Text);
        // Векторная графика — это разметка, и открывается она текстом (Р-192).
        assert_eq!(TabKind::for_path(Path::new("значок.svg")), TabKind::Text);
        assert_eq!(TabKind::for_path(Path::new("книга.PDF")), TabKind::Pdf);
    }

    /// У каждого расширения из списка есть тип содержимого: адрес `data:`
    /// без него собрать нельзя.
    #[test]
    fn every_image_extension_has_a_mime_type() {
        for extension in IMAGE_EXTENSIONS {
            let path = std::path::PathBuf::from(format!("файл.{extension}"));
            assert!(
                TabKind::image_mime(&path).is_some(),
                "нет типа содержимого для .{extension}"
            );
        }
        assert_eq!(TabKind::image_mime(std::path::Path::new("a.md")), None);
    }

    /// У вкладки с картинкой есть файл и его вес, но нет ни правки,
    /// ни содержимого для записи.
    #[test]
    fn image_tab_has_a_file_but_no_edits() {
        let mut buffers = Buffers::new();
        let buffer = buffers.create_viewed(
            PathBuf::from(r"C:\снимки\экран.png"),
            disk(),
            TabKind::Image,
        );

        assert_eq!(buffer.kind, TabKind::Image);
        assert_eq!(buffer.title, "экран.png");
        assert!(!buffer.modified);
        assert!(buffer.read_only);
        assert_eq!(buffer.disk.map(|d| d.size), Some(10));
    }

    /// У PDF всё то же самое: показ, и только показ (Р-181).
    #[test]
    fn pdf_tab_is_read_only_too() {
        let mut buffers = Buffers::new();
        let buffer =
            buffers.create_viewed(PathBuf::from(r"C:\книги\руководство.pdf"), disk(), TabKind::Pdf);

        assert_eq!(buffer.kind, TabKind::Pdf);
        assert_eq!(buffer.title, "руководство.pdf");
        assert!(buffer.read_only);
    }

    /// Вид переживает запись в снимок и чтение обратно. Пустая строка —
    /// снимок прошлой версии, незнакомая — вкладка из будущей.
    #[test]
    fn kind_survives_the_session_file() {
        for kind in [TabKind::Text, TabKind::Settings, TabKind::Image, TabKind::Pdf] {
            assert_eq!(TabKind::parse(&kind.to_snapshot()), Some(kind));
        }

        assert!(
            TabKind::Text.to_snapshot().is_empty(),
            "текст в снимок не пишется: иначе прошлая версия его не прочитает"
        );
        assert_eq!(TabKind::parse(""), Some(TabKind::Text));
        assert_eq!(TabKind::parse("книга"), None, "вид из будущей версии");
    }

    // Перестановка вкладок ушла в раскладку (`model/layout.rs`, Р-207):
    // там она и проверяется.

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
