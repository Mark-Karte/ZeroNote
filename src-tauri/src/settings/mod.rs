//! Пользовательские настройки: файл `data/settings.toml`.
//!
//! Файл — основной интерфейс настройки, а не выгрузка из окна параметров.
//! Отсюда два следствия, заложенных в устройство модуля:
//!
//! * читаем терпимо — отсутствующий ключ берёт значение по умолчанию;
//! * ошибаемся громко — опечатка в имени ключа называется по имени, а не
//!   проглатывается с молчаливым «настройка не применилась».
//!
//! Здесь только чтение. Запись живёт в `edit.rs` и идёт через `toml_edit`,
//! чтобы комментарии и порядок ключей пережили правку из окна параметров
//! (решения Р-013, Р-089). Через serde файл не записывается никогда: он
//! пересобрал бы документ из структуры и стёр всё, чего в структуре нет.

pub mod edit;

use std::path::Path;

use crate::theme::Density;

/// Настройки целиком.
///
/// **Незнакомый раздел не считается ошибкой, незнакомый ключ считается.**
/// Разница не в строгости, а в том, кто эти файлы читает. Раздел появляется
/// у новой версии — `[notes]` пришёл с задачей 90, — и старая версия,
/// на которую откатились, обязана прочитать файл, а не объявить его
/// испорченным и забыть заодно тему, шрифт и все настройки редактора. Тот же
/// приём, что у снимка сессии: место для новых полей оставлено нарочно
/// (Р-235).
///
/// Ключ внутри известного раздела — другое дело: это опечатка человека,
/// и о ней надо сказать по имени, а не молча взять умолчание. Поэтому
/// `deny_unknown_fields` стоит на каждом разделе и не стоит здесь.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Settings {
    #[serde(default = "default_schema")]
    pub schema: u32,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub font: FontSettings,
    #[serde(default)]
    pub editor: EditorSettings,
    #[serde(default)]
    pub notes: NotesSettings,
}

/// Заметки: то, что приложение создаёт само (задача 90).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct NotesSettings {
    /// Папка заметок — дом для записей рядом с проектами (задача 94).
    ///
    /// Пусто — `notes` в папке данных приложения. Приложение открывает эту
    /// папку корнем: у неё есть дерево, индекс, поиск, `[[ссылки]]` и теги,
    /// и она остаётся на месте, когда все проекты закрыты.
    pub vault: String,
    /// Куда класть ежедневную заметку. Путь относительно папки заметок,
    /// пусто — её корень.
    ///
    /// До задачи 94 настройка означала папку саму по себе, и абсолютный путь
    /// по-прежнему означает её же: файлы человека, настроившего заметки
    /// на этапе 13, обязаны остаться там, где лежат.
    pub daily_folder: String,
    /// Файл-шаблон новой ежедневной заметки. Пусто — заголовок и пустая строка.
    pub daily_template: String,
    /// Папка заготовок (задача 95). Путь внутри папки заметок, пусто —
    /// шаблонов нет. Как в Obsidian: там папка шаблонов тоже своя настройка.
    pub templates: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct AppearanceSettings {
    /// `"system"` — следовать настройке Windows; иначе идентификатор темы.
    pub theme: String,
    /// Какие темы использовать при `theme = "system"`.
    pub light_theme: String,
    pub dark_theme: String,
    pub density: Density,
}

/// Поведение редактора. Не оформление: перенос строк меняет то, как текст
/// разложен, а не как он выглядит, и в теме ему места нет.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct EditorSettings {
    /// Переносить длинные строки по ширине окна. По умолчанию нет — так
    /// ведёт себя Notepad++, и для кода это верное умолчание.
    pub wrap: bool,
    /// Закрывать скобки и кавычки при наборе. По умолчанию да — решение Р-113.
    pub auto_close: bool,
    /// Чем набирать отступ там, где файл не подсказал: `"spaces"` или `"tabs"`.
    ///
    /// Только умолчание: в существующем файле отступ определяется по его
    /// содержимому (Р-106). Иначе первое же нажатие `Tab` в чужом файле
    /// смешало бы табы с пробелами.
    pub indent_style: IndentStyle,
    /// Ширина отступа: сколько пробелов или во сколько столбцов рисуется таб.
    pub indent_width: u8,
    /// Показывать пробелы, табуляции и переносы строк.
    pub invisibles: bool,
    /// Где показывать номера строк: всегда, никогда или только в коде.
    ///
    /// По умолчанию `Code` (Р-213). В коде номер — часть разговора
    /// («ошибка в сорок второй»), в заметке он не сообщает ничего.
    /// Прячется само число, а поле остаётся: закладка рисуется там же,
    /// где рисовалась, и свёртка стоит рядом, как стояла.
    pub line_numbers: LineNumbers,
    /// Показывать панель разметки над markdown-файлами. По умолчанию да:
    /// заметки — половина того, ради чего редактор писался, а панель видна
    /// только там, где ей место, и не мешает никому больше.
    pub markdown_bar: bool,
    /// Во всю ширину области стоит панель разметки или над колонкой
    /// читаемой ширины (задача 81).
    ///
    /// По умолчанию `Column`: панель — набор кнопок для текста, и стоять
    /// ей полагается над текстом, а не в левом углу области, пока текст
    /// стоит колонкой посередине. Без колонки настройка не значит ничего:
    /// колонки нет — панель во всю ширину при любом значении.
    pub markdown_bar_width: MarkdownBarWidth,
    /// Подсказывать имена заметок после `[[` в markdown (Р-132).
    ///
    /// По умолчанию да: это то, ради чего связи между заметками и делались,
    /// а без подсказки имя приходится помнить наизусть. Выключатель нужен
    /// всё равно — список, всплывающий во время набора, мешает тому, кто
    /// пишет ссылки не глядя.
    pub link_suggest: bool,
    /// Держать текст markdown в колонке читаемой ширины и по центру окна.
    ///
    /// Только markdown (Р-156): в коде длина строки — часть смысла, там
    /// выравнивают продолжения и таблицы, и колонка в восемьдесят знаков
    /// резала бы их посередине. По умолчанию да — на широком экране строка
    /// во всю ширину читается плохо, и это единственное, что человек
    /// замечает в заметке первым.
    pub readable_width: bool,
    /// Показывать markdown без знаков разметки — живое превью (Р-159).
    ///
    /// Только markdown: ни в коде, ни в обычном тексте разметки нет. Строка,
    /// которую задевает курсор, показывается исходником (Р-158), поэтому
    /// править разметку можно не выключая превью. Файл не меняется ни на байт:
    /// прячется показ, а не текст (Р-160).
    ///
    /// По умолчанию **да** — решение владельца. Цена названа вслух:
    /// открывший чужой `.md` увидит не файл, а его отображение. Взамен —
    /// тестировщики найдут то, ради чего этап делался.
    pub live_preview: bool,
    /// Сохранять правки в файл без команды (Р-133).
    ///
    /// По умолчанию **нет**, и это заявление о том, чем мы считаем себя
    /// по умолчанию: редактор файлов не пишет в чужой файл без команды.
    /// Пришедший из Obsidian включит и получит привычное; пришедший из
    /// Notepad++ не обнаружит, что его конфиг изменился, пока он отходил.
    pub autosave: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IndentStyle {
    Spaces,
    Tabs,
}

/// Где показывать номера строк.
///
/// `Code` — везде, кроме markdown. Прозу мы узнаём ровно одну — заметку
/// (Р-214): файл без языка (`.txt`, безымянный буфер, незнакомое
/// расширение) номера сохраняет, потому что чаще всего это как раз лог
/// или вставленный кусок кода, где номер и нужен.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineNumbers {
    Always,
    Never,
    Code,
}

/// Чем меряется ширина панели разметки markdown.
///
/// `Column` — колонкой читаемой ширины, `Full` — всей областью. Значение
/// действует только там, где колонка есть: у markdown с включённой
/// настройкой `readable_width`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MarkdownBarWidth {
    Column,
    Full,
}

/// Умолчания пишутся руками, а не выводятся `derive(Default)`: у `bool`
/// умолчание `false`, а автозакрытие должно быть включено. Забыть про это
/// легко, и тогда настройка молча выключилась бы у всех, у кого её нет
/// в файле, — то есть у всех.
impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            wrap: false,
            auto_close: true,
            // Четыре пробела — умолчание VS Code и Obsidian, на которые
            // ZeroNote равняется по удобствам (Р-114).
            indent_style: IndentStyle::Spaces,
            indent_width: 4,
            invisibles: false,
            line_numbers: LineNumbers::Code,
            markdown_bar: true,
            markdown_bar_width: MarkdownBarWidth::Column,
            link_suggest: true,
            readable_width: true,
            live_preview: true,
            autosave: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct FontSettings {
    pub ui: UiFont,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct UiFont {
    /// `None` — значение из темы. Ключ просто отсутствует в файле.
    pub family: Option<String>,
    pub size: Option<u32>,
}

pub const SETTINGS_SCHEMA: u32 = 1;

fn default_schema() -> u32 {
    SETTINGS_SCHEMA
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            schema: SETTINGS_SCHEMA,
            appearance: AppearanceSettings::default(),
            font: FontSettings::default(),
            editor: EditorSettings::default(),
            notes: NotesSettings::default(),
        }
    }
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        AppearanceSettings {
            theme: "system".to_owned(),
            light_theme: "light".to_owned(),
            dark_theme: "dark".to_owned(),
            density: Density::Normal,
        }
    }
}

impl Default for FontSettings {
    fn default() -> Self {
        FontSettings {
            ui: UiFont::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsError {
    Parse(String),
    UnsupportedSchema { found: u32 },
}

impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettingsError::Parse(message) => {
                write!(f, "не удалось разобрать settings.toml: {message}")
            }
            SettingsError::UnsupportedSchema { found } => write!(
                f,
                "версия формата настроек {found} не поддерживается, ожидается {SETTINGS_SCHEMA}"
            ),
        }
    }
}

impl std::error::Error for SettingsError {}

pub fn parse(source: &str) -> Result<Settings, SettingsError> {
    let settings: Settings =
        toml::from_str(source).map_err(|e| SettingsError::Parse(e.message().to_owned()))?;

    if settings.schema != SETTINGS_SCHEMA {
        return Err(SettingsError::UnsupportedSchema {
            found: settings.schema,
        });
    }

    Ok(settings)
}

/// Чтение с диска.
///
/// Отсутствие файла — не ошибка: это первый запуск, берём значения по умолчанию.
/// А вот испорченный файл — ошибка, и она должна дойти до пользователя, иначе
/// он будет чинить «не работает тема» вслепую.
pub fn load(path: &Path) -> Result<Settings, SettingsError> {
    match std::fs::read_to_string(path) {
        Ok(source) => parse(&source),
        Err(_) => Ok(Settings::default()),
    }
}

/// Образец файла, который кладётся при первом запуске.
///
/// Записывается дословно, вместе с комментариями: сериализация через serde
/// комментарии не переживает, а для файла, который правят руками, они и есть
/// половина пользы.
pub const DEFAULT_TEMPLATE: &str = r#"# Настройки ZeroNote.
#
# Файл можно править руками и класть в git. Приложение подхватывает изменения
# на лету, перезапуск не нужен.
#
# Закомментированные ключи показывают значения по умолчанию.

schema = 1

[appearance]
# "system" — следовать настройке оформления Windows.
# Иначе — идентификатор темы. Встроенные:
#   светлые — "light" (GitHub Light), "solarized-light" (Solarized Light),
#             "catppuccin-latte" (Catppuccin Latte)
#   тёмные  — "dark" (One Dark), "dracula" (Dracula),
#             "tokyo-night" (Tokyo Night), "contrast" (Контраст)
# Свою тему кладите в data/themes/ и указывайте её id.
theme = "system"

# Какие темы использовать, когда theme = "system".
light_theme = "light"
dark_theme = "dark"

# Плотность интерфейса: "normal" или "compact".
density = "normal"

[font.ui]
# Шрифт интерфейса. Если ключа нет — берётся из темы (по умолчанию системный).
# family = "Segoe UI"
# size = 13

[editor]
# Переносить длинные строки по ширине окна.
wrap = false
# Закрывать скобки и кавычки при наборе. В прозе — markdown и обычном
# тексте — кавычки не закрываются и при включённой настройке: там они
# не парные.
auto_close = true
# Чем набирать отступ: "spaces" или "tabs", и какой ширины. Это только
# умолчание: в существующем файле отступ определяется по его содержимому,
# и настройка его не переписывает. Что определилось — видно в строке
# состояния, там же можно сменить для одной вкладки.
indent_style = "spaces"
indent_width = 4
# Показывать пробелы, табуляции и переносы строк.
invisibles = false
# Где показывать номера строк: "always", "never" или "code" — только в коде.
# По умолчанию "code": в коде номер — часть разговора («ошибка в сорок
# второй»), в заметке он не сообщает ничего. Прячется само число, а поле
# остаётся: закладка рисуется там же, где рисовалась, свёртка — рядом.
# Прозой считается только markdown; файл без языка номера сохраняет.
line_numbers = "code"
# Панель разметки над markdown-файлами: жирный, курсив, заголовки, списки,
# ссылка и заготовки. Появляется только на markdown, в остальных файлах
# её нет. Всё то же есть в палитре команд.
markdown_bar = true
# Чем меряется ширина панели разметки: "column" — колонкой читаемой ширины,
# "full" — всей областью. По умолчанию "column": панель — кнопки для текста,
# и стоять ей полагается над текстом, а не в левом углу, пока текст стоит
# колонкой посередине. Там, где колонки нет, панель во всю ширину при любом
# значении.
markdown_bar_width = "column"

# Держать текст markdown в колонке читаемой ширины и по центру окна.
# Только markdown: в коде длина строки — часть смысла.
readable_width = true

# Живое превью markdown: знаки разметки не показываются, а действуют.
# `**жирный**` виден жирным без звёздочек, `==выделение==` — цветом.
# Строка, на которой стоит курсор, всегда показывается исходником — поэтому
# править разметку можно, не выключая превью. Файл не меняется: прячется
# показ, а не текст, и копирование отдаёт исходник со знаками.
live_preview = true
# Подсказывать имена заметок после `[[` в markdown. Список берётся из индекса
# проекта — тот же, что показывает быстрое открытие. Автодополнением кода
# ZeroNote не занимается и заниматься не будет.
link_suggest = true
# Сохранять правки в файл без команды: через две секунды после последней
# правки и когда окно теряет фокус. По умолчанию выключено — редактор файлов
# не пишет в чужой файл без команды. Черновики (инвариант 4) работают всегда
# и не зависят от этой настройки.
autosave = false

[notes]
# Папка заметок — дом для записей рядом с проектами. Она открыта всегда,
# и её не надо добавлять в «Папки»: панель «Заметки» показывает её дерево,
# даже когда все проекты закрыты. Поиск, [[ссылки]], обратные ссылки и теги
# работают в ней так же, как в проекте.
# Пусто — data/notes в папке данных приложения. Укажите здесь своё хранилище
# Obsidian, если ведёте заметки в нём: ZeroNote в него ничего не добавляет,
# а .obsidian не трогает вовсе (инвариант 2).
vault = ""
# Куда класть ежедневную заметку («Заметка на сегодня» в палитре команд).
# Путь внутри папки заметок; пусто — прямо в неё. Абсолютный путь означает
# папку саму по себе, где бы она ни лежала.
daily_folder = ""
# Файл-шаблон новой заметки. Пусто — заголовок и пустая строка под ним.
# В шаблоне подставляются {{date}}, {{time}} и {{title}}; всё остальное
# копируется как есть. Существующая заметка шаблоном не переписывается
# никогда — команда просто открывает её.
daily_template = ""
# Папка заготовок: «Вставить шаблон» и «Новая заметка из шаблона» берут
# список отсюда. Путь внутри папки заметок; пусто — шаблонов нет.
# В шаблоне подставляются {{date}}, {{time}} и {{title}}; исполняемого кода
# в шаблонах нет и не будет — это подстановка, а не макросы.
templates = ""
"#;

/// Создать файл настроек, если его ещё нет.
///
/// Существующий файл не трогаем никогда: он мог быть отредактирован руками,
/// и перезапись уничтожила бы комментарии и правки пользователя.
pub fn write_default_if_missing(path: &Path) -> std::io::Result<bool> {
    if path.exists() {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, DEFAULT_TEMPLATE)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Образец обязан разбираться и давать ровно значения по умолчанию.
    /// Без этого теста комментарии в образце и код разъедутся незаметно.
    #[test]
    fn template_matches_defaults() {
        let parsed = parse(DEFAULT_TEMPLATE).expect("образец должен разбираться");
        assert_eq!(parsed, Settings::default());
    }

    /// Раздел из будущей версии не ломает файл (Р-235).
    ///
    /// Проверка про откат: 0.13.0 пишет `[notes]`, а 0.12.0 такого раздела
    /// не знает. Отвергни она файл целиком — человек, откатившийся после
    /// неудачного выпуска, получил бы вдобавок сброшенные тему, шрифт
    /// и настройки редактора.
    #[test]
    fn unknown_section_is_ignored_and_the_rest_applies() {
        let parsed = parse(
            r#"
            schema = 1
            [appearance]
            theme = "contrast"
            [snippets]
            folder = "шаблоны"
        "#,
        )
        .expect("незнакомый раздел не должен ломать файл");
        // Имя раздела латиницей не случайно: в TOML голый ключ — только
        // латиница, цифры, дефис и подчёркивание, и раздел с кириллицей
        // в имени был бы ошибкой разбора, а не «незнакомым разделом».

        assert_eq!(parsed.appearance.theme, "contrast");
    }

    /// А вот опечатка в ключе известного раздела остаётся ошибкой: её пишет
    /// человек, и молча взять умолчание значило бы не выполнить написанное.
    #[test]
    fn unknown_key_in_a_known_section_is_still_an_error() {
        let error = parse(
            r#"
            schema = 1
            [editor]
            wrapp = true
        "#,
        )
        .expect_err("опечатка в ключе должна быть названа");

        assert!(error.to_string().contains("wrapp"), "{error}");
    }

    /// Настройка, которой в файле нет, берёт умолчание — и для автозакрытия
    /// это `true`, а не `false`.
    ///
    /// Тест не про сериализацию, а про грабли: у `bool` умолчание `false`,
    /// и `derive(Default)` молча выключил бы автозакрытие у всех, у кого
    /// файл настроек написан до появления этого ключа. То есть у всех.
    #[test]
    fn auto_close_is_on_when_the_key_is_missing() {
        let parsed = parse(
            r#"
            schema = 1
            [editor]
            wrap = true
        "#,
        )
        .expect("файл должен разбираться");

        assert!(parsed.editor.wrap);
        assert!(parsed.editor.auto_close, "автозакрытие включено по умолчанию");
        assert!(
            parsed.editor.markdown_bar,
            "панель разметки включена по умолчанию"
        );
    }

    /// Номера строк: ключа в файле нет — значит «только в коде», а не
    /// «никогда». Умолчание перечисления пишется руками, как и у `bool`,
    /// и ошибиться здесь так же легко.
    #[test]
    fn line_numbers_default_is_code() {
        let parsed = parse(
            r#"
            schema = 1
            [editor]
            wrap = true
        "#,
        )
        .expect("файл должен разбираться");

        assert_eq!(parsed.editor.line_numbers, LineNumbers::Code);
    }

    /// Незнакомое значение называется вслух и вместе с тем, что можно было
    /// написать. Молча взять умолчание — это «настройка не применилась»
    /// без единого слова, ровно то, ради чего написан весь модуль.
    #[test]
    fn unknown_line_numbers_value_is_reported() {
        let error = parse(
            r#"
            schema = 1
            [editor]
            line_numbers = "иногда"
        "#,
        )
        .expect_err("незнакомое значение должно быть ошибкой");

        let message = error.to_string();
        assert!(
            message.contains("code"),
            "сообщение должно перечислять допустимые значения: {message}"
        );
    }

    /// Ширина панели разметки: ключа нет — «над колонкой». Умолчание
    /// перечисления, как и у номеров строк, пишется руками.
    #[test]
    fn markdown_bar_width_default_is_column() {
        let parsed = parse(
            r#"
            schema = 1
            [editor]
            markdown_bar = true
        "#,
        )
        .expect("файл должен разбираться");

        assert_eq!(parsed.editor.markdown_bar_width, MarkdownBarWidth::Column);
    }

    /// Пустой файл — это все значения по умолчанию, а не ошибка.
    #[test]
    fn empty_file_yields_defaults() {
        let parsed = parse("schema = 1").expect("минимальный файл должен разбираться");
        assert_eq!(parsed, Settings::default());
    }

    /// Частичный файл дополняется умолчаниями, а не обнуляет остальное.
    #[test]
    fn partial_file_is_filled_with_defaults() {
        let parsed = parse(
            r#"
            schema = 1
            [appearance]
            density = "compact"
        "#,
        )
        .expect("частичный файл должен разбираться");

        assert_eq!(parsed.appearance.density, Density::Compact);
        assert_eq!(parsed.appearance.theme, "system");
        assert_eq!(parsed.appearance.light_theme, "light");
    }

    /// Опечатка называется по имени. Файл правят руками, и молчаливое
    /// игнорирование ключа — худшее, что можно сделать.
    #[test]
    fn typo_in_key_is_reported() {
        let error = parse(
            r#"
            schema = 1
            [appearance]
            densty = "compact"
        "#,
        )
        .expect_err("опечатка должна быть ошибкой");

        let message = error.to_string();
        assert!(
            message.contains("densty"),
            "сообщение должно называть ключ: {message}"
        );
    }

    /// Файл из будущей версии не применяется наполовину.
    #[test]
    fn future_schema_is_rejected() {
        assert_eq!(
            parse("schema = 42"),
            Err(SettingsError::UnsupportedSchema { found: 42 })
        );
    }

    /// Отсутствие файла — первый запуск, а не поломка.
    #[test]
    fn missing_file_yields_defaults() {
        let path = std::env::temp_dir().join("zeronote-нет-такого-файла.toml");
        assert_eq!(load(&path), Ok(Settings::default()));
    }

    /// Существующий файл не перезаписывается: там могут быть правки и комментарии.
    #[test]
    fn existing_file_is_never_overwritten() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-settings-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.toml");

        let mine = "schema = 1\n# мой комментарий\n";
        std::fs::write(&path, mine).unwrap();

        let written = write_default_if_missing(&path).unwrap();

        assert!(!written, "файл существовал, писать было нельзя");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), mine);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
