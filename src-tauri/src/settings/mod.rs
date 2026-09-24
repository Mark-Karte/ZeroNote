//! Пользовательские настройки: файл `data/settings.toml`.
//!
//! Файл — основной интерфейс настройки, а не выгрузка из окна параметров.
//! Отсюда два следствия, заложенных в устройство модуля:
//!
//! * читаем терпимо — отсутствующий ключ берёт значение по умолчанию,
//!   а незнакомый ключ или негодное значение не отменяют остальных;
//! * ошибаемся громко — всё, что не применилось, называется по имени,
//!   а не проглатывается с молчаливым «настройка не применилась».
//!
//! Файл целиком отвергается только тогда, когда его нельзя прочитать вовсе:
//! сломан сам TOML или версия формата чужая (Р-248).
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
/// **Всё незнакомое называется, всё знакомое применяется** (Р-248). Раньше
/// правило было строже: незнакомый ключ внутри известного раздела отвергал
/// файл целиком (Р-235), и каждая новая настройка ломала откат на прошлую
/// версию — та видела чужой ключ и забывала заодно тему, шрифт и все
/// настройки редактора. Теперь ключ называется в предупреждении, а прочие
/// значения работают.
///
/// `Deserialize` здесь нет нарочно: читать файл можно только через
/// [`parse`], иначе строгое чтение вернулось бы в обход терпимого.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Settings {
    pub schema: u32,
    pub appearance: AppearanceSettings,
    pub font: FontSettings,
    pub editor: EditorSettings,
    pub notes: NotesSettings,
    pub toolbar: ToolbarSettings,
}

/// Заметки: то, что приложение создаёт само (задача 90).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(default)]
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
#[serde(default)]
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
#[serde(default)]
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

/// Панель инструментов над текстом (задача 102).
///
/// Раньше это была «панель разметки» только над markdown и с составом,
/// зашитым в код. Теперь состав решает человек, а сама панель стоит над
/// любым текстом: отмена и возврат нужны и в коде (решение владельца).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct ToolbarSettings {
    /// Что стоит на панели и в каком порядке: идентификаторы команд из
    /// реестра и служебные слова [`TOOLBAR_WORDS`]. Ключа нет в файле —
    /// набор по умолчанию [`DEFAULT_TOOLBAR`]; незнакомая команда
    /// называется и пропускается (Р-248).
    pub items: Vec<String>,
    /// Над какими вкладками показывать.
    pub show: ToolbarShow,
    /// Во всю ширину области или над колонкой читаемой ширины (задача 81).
    pub width: ToolbarWidth,
    /// Размер кнопок.
    pub size: ToolbarSize,
}

/// Над какими вкладками стоит панель.
///
/// `Text` по умолчанию: над кодом и заметками, но не над картинкой и PDF —
/// там почти всем кнопкам делать нечего, и полоса гасших значков над
/// снимком экрана ничего бы не сообщала.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolbarShow {
    Always,
    Text,
    Markdown,
    Never,
}

/// Чем меряется ширина панели.
///
/// `Column` — колонкой читаемой ширины, `Full` — всей областью. Значение
/// действует только там, где колонка есть: у markdown с включённой
/// настройкой `readable_width`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolbarWidth {
    Column,
    Full,
}

/// Размер кнопок панели. Три ступени, а не число пикселей: значки нарисованы
/// под сетку в шестнадцать точек, и кнопка произвольного размера размыла бы
/// их. Каждой ступени соответствует пара токенов — кнопка и значок.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolbarSize {
    Small,
    Normal,
    Large,
}

/// Служебные слова в составе панели — всё, что не команда.
///
/// Черта между группами, распорка (всё после неё уезжает вправо) и путь
/// к файлу. Путь — ответ на просьбу владельца показывать его отдельной
/// строкой: панель собираемая, и строка с путём — это «распорка и путь»,
/// которые ничего не стоят тем, кто их не ставил.
pub const TOOLBAR_WORDS: &[&str] = &["separator", "spacer", "path"];

/// Набор панели по умолчанию.
///
/// Всё, что есть в разделе «Текст» у плагина владельца для Obsidian, плюс
/// правка и история мест: отмена с возвратом и стрелки «назад/вперёд»
/// уехали сюда из шапки. Кнопок много, и это решение владельца: «все
/// инструменты без скрытия, можно в несколько рядов». Лишнее убирается
/// во вкладке «Панель инструментов».
pub const DEFAULT_TOOLBAR: &[&str] = &[
    "edit.undo",
    "edit.redo",
    "separator",
    "view.back",
    "view.forward",
    "separator",
    "md.heading-1",
    "md.heading-2",
    "md.heading-3",
    "md.heading-4",
    "md.heading-5",
    "md.heading-6",
    "separator",
    "md.bold",
    "md.italic",
    "md.underline",
    "md.strikethrough",
    "md.highlight",
    "md.code",
    "separator",
    "md.bullet-list",
    "md.ordered-list",
    "md.task-list",
    "md.quote",
    "separator",
    "md.link",
    "md.wikilink",
    "md.image",
    "separator",
    "md.table",
    "md.code-block",
    "md.mermaid",
    "md.divider",
    // Список коллаутов у курсора (задача 103): коллауты владелец просил
    // «на тулбар», и одна кнопка со списком ставит любой из двадцати семи.
    // Отдельные кнопки под свои коллауты ставятся из вкладки «Коллауты».
    "md.callout",
];

impl Default for ToolbarSettings {
    fn default() -> Self {
        ToolbarSettings {
            items: DEFAULT_TOOLBAR.iter().map(|item| (*item).to_owned()).collect(),
            show: ToolbarShow::Text,
            width: ToolbarWidth::Column,
            size: ToolbarSize::Normal,
        }
    }
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
            link_suggest: true,
            readable_width: true,
            live_preview: true,
            autosave: false,
        }
    }
}

/// Шрифты — настройка человека, а не темы (задача 105, решение владельца):
/// тема задаёт умолчание, выбор человека его перекрывает и не меняется
/// вместе с темой.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct FontSettings {
    pub ui: FontChoice,
    pub editor: FontChoice,
}

/// Шрифт одного места: интерфейса или редактора.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct FontChoice {
    /// `None` — значение из темы. Ключ просто отсутствует в файле.
    pub family: Option<String>,
    pub size: Option<u32>,
}

pub const SETTINGS_SCHEMA: u32 = 1;

impl Default for Settings {
    fn default() -> Self {
        Settings {
            schema: SETTINGS_SCHEMA,
            appearance: AppearanceSettings::default(),
            font: FontSettings::default(),
            editor: EditorSettings::default(),
            notes: NotesSettings::default(),
            toolbar: ToolbarSettings::default(),
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
            ui: FontChoice::default(),
            editor: FontChoice::default(),
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

/// Прочитанные настройки и то, что из файла применить не удалось.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Loaded {
    pub settings: Settings,
    /// Незнакомые ключи и разделы, негодные значения — по строке на каждое.
    /// Пустой список — файл прочитан целиком. Имени файла в строке нет:
    /// его добавляет тот, кто показывает жалобу там, где оно нужно.
    pub problems: Vec<String>,
}

/// Разбор файла настроек.
///
/// Ошибка — только когда файл нельзя прочитать вовсе: сломан сам TOML или
/// версия формата не наша. Всё остальное — предупреждение в `problems`
/// и значение по умолчанию на месте того, что не применилось.
pub fn parse(source: &str) -> Result<Loaded, SettingsError> {
    let mut root: toml::Table =
        toml::from_str(source).map_err(|e| SettingsError::Parse(e.message().to_owned()))?;

    // Версия формата решает, как читать всё остальное, поэтому к ней
    // терпимости нет: не число — файл не наш.
    let schema = match root.remove("schema") {
        None => SETTINGS_SCHEMA,
        Some(toml::Value::Integer(n)) => u32::try_from(n).map_err(|_| {
            SettingsError::Parse(format!("schema = {n} — версия формата не бывает такой"))
        })?,
        Some(other) => {
            return Err(SettingsError::Parse(format!(
                "schema должна быть числом, а в файле {}",
                other.type_str()
            )));
        }
    };
    if schema != SETTINGS_SCHEMA {
        return Err(SettingsError::UnsupportedSchema { found: schema });
    }

    let mut problems = Vec::new();

    let appearance = section(take_table(&mut root, "appearance", &mut problems), "appearance", &mut problems);
    let editor = section(take_table(&mut root, "editor", &mut problems), "editor", &mut problems);
    let notes = section(take_table(&mut root, "notes", &mut problems), "notes", &mut problems);
    let font = font_section(take_table(&mut root, "font", &mut problems), &mut problems);
    let mut toolbar: ToolbarSettings = section(take_table(&mut root, "toolbar", &mut problems), "toolbar", &mut problems);
    toolbar.items = known_items(toolbar.items, &mut problems);

    // Что осталось — не наше. Раздел из будущей версии и опечатка в имени
    // раздела выглядят одинаково, и оба случая заслуживают слова: первый
    // объясняет, почему после отката часть настроек не действует, второй —
    // почему не действуют настройки из `[edtor]`.
    for (key, value) in root {
        if value.is_table() {
            problems.push(format!(
                "раздел [{key}] незнаком — пропущен"
            ));
        } else {
            problems.push(format!(
                "ключ «{key}» вне разделов незнаком — пропущен"
            ));
        }
    }

    Ok(Loaded {
        settings: Settings {
            schema,
            appearance,
            font,
            editor,
            notes,
            toolbar,
        },
        problems,
    })
}

/// Состав панели без того, чего нет в реестре команд.
///
/// Незнакомое имя — опечатка или команда из будущей версии; кнопка,
/// которая ничего не делает, хуже отсутствующей, поэтому она пропускается
/// и называется, как любой незнакомый ключ (Р-248).
///
/// Коллаут на панели пишется `callout:тип` (задача 103). Здесь проверяется
/// только вид записи: список коллаутов — свой файл, и разбор настроек его
/// не читает. Кнопку коллаута, которого нет, не рисует панель и называет
/// вкладка «Панель инструментов».
fn known_items(items: Vec<String>, problems: &mut Vec<String>) -> Vec<String> {
    items
        .into_iter()
        .filter(|item| {
            let callout = item
                .strip_prefix("callout:")
                .is_some_and(crate::callouts::valid_id);
            let known = callout
                || TOOLBAR_WORDS.contains(&item.as_str())
                || crate::keymap::COMMANDS.iter().any(|(id, _)| id == item);
            if !known {
                problems.push(format!(
                    "[toolbar] items — команды «{item}» нет, кнопка пропущена"
                ));
            }
            known
        })
        .collect()
}

/// Достать раздел из корня файла. Нет раздела — пустой: всё возьмётся
/// по умолчанию. Раздел не таблицей (`editor = 5`) — тоже пустой,
/// но со словом об этом.
fn take_table(root: &mut toml::Table, name: &str, problems: &mut Vec<String>) -> toml::Table {
    match root.remove(name) {
        None => toml::Table::new(),
        Some(toml::Value::Table(table)) => table,
        Some(other) => {
            problems.push(format!(
                "[{name}] должен быть разделом, а в файле {} — взяты значения по умолчанию",
                other.type_str()
            ));
            toml::Table::new()
        }
    }
}

/// Прочитать один раздел терпимо: по ключу, а не целиком.
///
/// Порядок такой. Сначала раздел разбирается целиком — это обычный случай,
/// и он ничего не стоит. Не разобрался — значит, где-то негодное значение,
/// и каждый ключ пробуется поодиночке: тот, на котором разбор падает,
/// называется и выбрасывается, остальные применяются. Последним шагом
/// разобранное пишется обратно в таблицу, и ключ файла, которого там
/// не оказалось, — незнакомый: serde его молча пропустил.
///
/// Обратная запись вместо списка известных ключей — нарочно: список
/// пришлось бы держать рядом со структурой руками, и первое же новое поле
/// разошлось бы с ним молча. Здесь знает только сама структура.
///
/// `S` — тип раздела: разбирается из TOML, пишется обратно и умеет
/// умолчание. Обобщение здесь ради одного: один и тот же порядок на пять
/// разных разделов, а не пять копий одного цикла.
pub(crate) fn section<S>(mut table: toml::Table, name: &str, problems: &mut Vec<String>) -> S
where
    S: serde::de::DeserializeOwned + serde::Serialize + Default,
{
    let whole: Result<S, _> = toml::Value::Table(table.clone()).try_into();
    let value = match whole {
        Ok(value) => value,
        Err(_) => {
            // Ключи перебираются по именам, собранным заранее: выбрасывать
            // из таблицы, пока идёшь по ней же, нельзя.
            let keys: Vec<String> = table.keys().cloned().collect();
            for key in keys {
                let mut single = toml::Table::new();
                if let Some(value) = table.get(&key) {
                    single.insert(key.clone(), value.clone());
                }
                if let Err(error) = toml::Value::Table(single).try_into::<S>() {
                    problems.push(format!(
                        "[{name}] {key} — {}; взято значение по умолчанию",
                        error.message().trim()
                    ));
                    table.remove(&key);
                }
            }

            // Поодиночке годны все оставшиеся — значит, годны и вместе.
            // Раздел, где ключи негодны лишь в паре, у нас не бывает;
            // случись он — умолчание целиком и слово об этом, а не паника.
            match toml::Value::Table(table.clone()).try_into() {
                Ok(value) => value,
                Err(error) => {
                    problems.push(format!(
                        "[{name}] — {}; раздел взят по умолчанию",
                        error.message().trim()
                    ));
                    S::default()
                }
            }
        }
    };

    let known = match toml::Value::try_from(&value) {
        Ok(toml::Value::Table(known)) => known,
        _ => toml::Table::new(),
    };
    for key in table.keys() {
        if !known.contains_key(key) {
            problems.push(format!(
                "в разделе [{name}] нет ключа «{key}» — строка пропущена"
            ));
        }
    }

    value
}

/// Раздел `[font]` вложенный: шрифты живут в `[font.ui]` и `[font.editor]`.
/// Каждый вложенный раздел читается своим ходом — иначе негодный `size`
/// выбросил бы весь раздел вместе с годным `family`.
fn font_section(mut table: toml::Table, problems: &mut Vec<String>) -> FontSettings {
    let mut choice = |name: &str| -> FontChoice {
        match table.remove(name) {
            None => FontChoice::default(),
            Some(toml::Value::Table(inner)) => section(inner, &format!("font.{name}"), problems),
            Some(other) => {
                problems.push(format!(
                    "[font.{name}] должен быть разделом, а в файле {} — взяты значения по умолчанию",
                    other.type_str()
                ));
                FontChoice::default()
            }
        }
    };
    let ui = choice("ui");
    let editor = choice("editor");

    // Всё прочее в `[font]` — незнакомое: своих ключей у раздела нет,
    // только вложенные `ui` и `editor`. Разбор здесь ради одного — назвать их.
    let _: FontSettings = section(table, "font", problems);
    FontSettings { ui, editor }
}

/// Чтение с диска.
///
/// Отсутствие файла — не ошибка: это первый запуск, берём значения по умолчанию.
/// А вот нечитаемый файл — ошибка, и она должна дойти до пользователя, иначе
/// он будет чинить «не работает тема» вслепую.
pub fn load(path: &Path) -> Result<Settings, SettingsError> {
    load_full(path).map(|loaded| loaded.settings)
}

/// Чтение с диска вместе с тем, что из файла применить не удалось. Для тех,
/// кто об этом говорит человеку: полосы предупреждений и окна параметров.
pub fn load_full(path: &Path) -> Result<Loaded, SettingsError> {
    match std::fs::read_to_string(path) {
        Ok(source) => parse(&source),
        Err(_) => Ok(Loaded::default()),
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
# Ключ, которого приложение не знает, и негодное значение называются
# в полосе предупреждений вверху окна; всё остальное применяется.

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
# Шрифт интерфейса. Если ключа нет — берётся из темы. Не нашёлся в системе —
# на экране останется шрифт темы. Правится и во вкладке «Оформление».
# family = "Segoe UI"
# size = 13

# Шрифт редактора — так же, раздел [font.editor]:
# [font.editor]
# family = "Cascadia Mono"
# size = 14

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

[toolbar]
# Панель инструментов над текстом. Удобнее всего её собирать во вкладке
# «Панель инструментов» окна параметров, но и здесь всё видно.
#
# Состав — список: идентификаторы команд (их видно во вкладке «Клавиши»)
# и три служебных слова: "separator" — черта между группами, "spacer" —
# распорка, всё после неё уезжает вправо, "path" — путь к открытому файлу.
# Ключа нет — набор по умолчанию: отмена и возврат, назад и вперёд по местам
# курсора и вся разметка markdown. Кнопка разметки над кодом не показывается.
# items = ["edit.undo", "edit.redo", "separator", "md.bold", "md.italic"]

# Над какими вкладками стоит панель: "always" — над всеми, "text" — над
# кодом и заметками, "markdown" — только над заметками, "never" — нигде.
show = "text"
# Чем меряется ширина: "column" — колонкой читаемой ширины, "full" — всей
# областью. Там, где колонки нет, панель во всю ширину при любом значении.
width = "column"
# Размер кнопок: "small", "normal" или "large".
size = "normal"
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

    /// Разобрать то, что обязано разобраться, и вернуть обе половины.
    fn read(source: &str) -> Loaded {
        parse(source).expect("файл должен читаться")
    }

    /// Хотя бы одна жалоба называет всё перечисленное.
    fn named(problems: &[String], words: &[&str]) -> bool {
        problems
            .iter()
            .any(|problem| words.iter().all(|word| problem.contains(word)))
    }

    /// Образец обязан разбираться, давать ровно значения по умолчанию
    /// и не вызывать ни одной жалобы. Без этого теста комментарии в образце
    /// и код разъедутся незаметно.
    #[test]
    fn template_matches_defaults() {
        let loaded = read(DEFAULT_TEMPLATE);
        assert_eq!(loaded.settings, Settings::default());
        assert_eq!(loaded.problems, Vec::<String>::new());
    }

    /// Раздел из будущей версии не ломает файл (Р-235) — и называется (Р-248).
    ///
    /// Проверка про откат: новая версия пишет раздел, которого старая
    /// не знает. Отвергни старая файл целиком — человек, откатившийся после
    /// неудачного выпуска, получил бы вдобавок сброшенные тему и шрифт.
    /// Назвать раздел — не придирка: так видно, почему часть настроек
    /// после отката не действует.
    #[test]
    fn unknown_section_is_named_and_the_rest_applies() {
        let loaded = read(
            r#"
            schema = 1
            [appearance]
            theme = "contrast"
            [snippets]
            folder = "шаблоны"
        "#,
        );
        // Имя раздела латиницей не случайно: в TOML голый ключ — только
        // латиница, цифры, дефис и подчёркивание, и раздел с кириллицей
        // в имени был бы ошибкой разбора, а не «незнакомым разделом».

        assert_eq!(loaded.settings.appearance.theme, "contrast");
        assert!(named(&loaded.problems, &["[snippets]"]), "{:?}", loaded.problems);
    }

    /// **Главное обещание задачи 101**: незнакомый ключ в известном разделе
    /// называется, а соседние ключи и другие разделы применяются.
    ///
    /// До Р-248 этот же файл отвергался целиком, и вместе с опечаткой
    /// пропадали тема и все настройки редактора.
    #[test]
    fn unknown_key_is_named_and_the_rest_applies() {
        let loaded = read(
            r#"
            schema = 1
            [appearance]
            theme = "contrast"
            [editor]
            wrapp = true
            wrap = true
        "#,
        );

        assert_eq!(loaded.settings.appearance.theme, "contrast");
        assert!(loaded.settings.editor.wrap, "соседний ключ обязан примениться");
        assert!(
            named(&loaded.problems, &["[editor]", "wrapp"]),
            "{:?}",
            loaded.problems
        );
        assert_eq!(loaded.problems.len(), 1, "{:?}", loaded.problems);
    }

    /// Файл следующей версии читается этой. Ровно та беда, что предъявил
    /// откат с 0.14.0 на 0.13.0: новая версия добавляет ключ в знакомый
    /// раздел, и прошлая спотыкалась о него. С этой версии — нет.
    #[test]
    fn a_file_of_the_next_version_is_read() {
        let loaded = read(
            r#"
            schema = 1
            [notes]
            vault = 'C:\Заметки'
            calendar_start = "sunday"
            [editor]
            live_preview = false
            toolbar_rows = 2
        "#,
        );

        assert_eq!(loaded.settings.notes.vault, r"C:\Заметки");
        assert!(!loaded.settings.editor.live_preview);
        assert!(named(&loaded.problems, &["calendar_start"]));
        assert!(named(&loaded.problems, &["toolbar_rows"]));
    }

    /// **Откат на 0.14.0 отвергнет файл с новыми ключами** — последний раз.
    ///
    /// Проверка разбором, а не рассуждением: структура прошлой версии
    /// (`[notes]` с `deny_unknown_fields`) читает файл с новым ключом
    /// и обязана споткнуться о него. Тест закрепляет **известную цену**:
    /// терпимость появилась в этой версии, а прошлые остаются строгими,
    /// и чинить их нечем — они уже у людей.
    ///
    /// Что это значит для человека: после отката с 0.15.0 на 0.14.0
    /// настройки не потеряются (файл не переписывается), но применяться
    /// не будут, пока он не уберёт новые ключи руками. Дублирование
    /// структуры здесь намеренное — так же, как у снимка сессии: обещание
    /// не должно меняться вместе с кодом.
    #[test]
    fn the_previous_version_still_stumbles_on_new_keys() {
        #[derive(serde::Deserialize, Default)]
        #[serde(deny_unknown_fields, default)]
        struct OldNotes {
            #[allow(dead_code)]
            vault: String,
            #[allow(dead_code)]
            daily_folder: String,
            #[allow(dead_code)]
            daily_template: String,
            #[allow(dead_code)]
            templates: String,
        }

        #[derive(serde::Deserialize)]
        struct OldSettings {
            #[allow(dead_code)]
            #[serde(default)]
            notes: OldNotes,
        }

        let source = "schema = 1\n[notes]\nnew_key = true\n";
        let outcome = toml::from_str::<OldSettings>(source);
        let error = outcome.err().expect("0.14.0 обязана споткнуться о новый ключ");
        assert!(error.message().contains("new_key"), "{error}");

        // А эта версия читает тот же файл и называет ключ.
        let loaded = read(source);
        assert!(named(&loaded.problems, &["new_key"]));
    }

    /// Откат 0.15.0 → 0.14.0 на свежей установке (приёмка этапа 15).
    ///
    /// Разделы 0.14.0 списаны с метки `v0.14.0`: у каждого раздела
    /// `deny_unknown_fields`, у корня — нет, поэтому незнакомый раздел
    /// пропускается, а незнакомый ключ в знакомом разделе отвергает файл.
    /// Значения — `toml::Value`: вопрос здесь в именах ключей, а не в типах.
    ///
    /// Первая половина — обещание: образец, который кладёт 0.15.0, 0.14.0
    /// читает. `[toolbar]` для неё незнакомый раздел, `[font.editor]` в
    /// образце закомментирован. Вторая — известная цена: кто выбрал шрифт
    /// редактора, получит у 0.14.0 отказ, и об этом сказано в заметках.
    #[test]
    fn the_previous_version_reads_a_fresh_file_of_this_one() {
        type Loose = Option<toml::Value>;

        #[derive(serde::Deserialize, Default)]
        #[serde(deny_unknown_fields, default)]
        #[allow(dead_code)]
        struct OldAppearance {
            theme: Loose,
            light_theme: Loose,
            dark_theme: Loose,
            density: Loose,
        }

        #[derive(serde::Deserialize, Default)]
        #[serde(deny_unknown_fields, default)]
        #[allow(dead_code)]
        struct OldEditor {
            wrap: Loose,
            auto_close: Loose,
            indent_style: Loose,
            indent_width: Loose,
            invisibles: Loose,
            line_numbers: Loose,
            markdown_bar: Loose,
            markdown_bar_width: Loose,
            link_suggest: Loose,
            readable_width: Loose,
            live_preview: Loose,
            autosave: Loose,
        }

        #[derive(serde::Deserialize, Default)]
        #[serde(deny_unknown_fields, default)]
        #[allow(dead_code)]
        struct OldNotes {
            vault: Loose,
            daily_folder: Loose,
            daily_template: Loose,
            templates: Loose,
        }

        #[derive(serde::Deserialize, Default)]
        #[serde(deny_unknown_fields, default)]
        #[allow(dead_code)]
        struct OldUiFont {
            family: Loose,
            size: Loose,
        }

        #[derive(serde::Deserialize, Default)]
        #[serde(deny_unknown_fields, default)]
        #[allow(dead_code)]
        struct OldFont {
            ui: OldUiFont,
        }

        #[derive(serde::Deserialize)]
        #[allow(dead_code)]
        struct OldSettings {
            schema: u32,
            #[serde(default)]
            appearance: OldAppearance,
            #[serde(default)]
            font: OldFont,
            #[serde(default)]
            editor: OldEditor,
            #[serde(default)]
            notes: OldNotes,
        }

        // В образце уже есть `[toolbar]` с ключами — для 0.14.0 это чужой
        // раздел целиком, и она его пропускает.
        assert!(DEFAULT_TEMPLATE.contains("\n[toolbar]\n"));
        toml::from_str::<OldSettings>(DEFAULT_TEMPLATE)
            .expect("0.14.0 обязана прочитать образец 0.15.0");

        let with_editor_font = "schema = 1\n[font.editor]\nfamily = \"Consolas\"\n";
        let error = toml::from_str::<OldSettings>(with_editor_font)
            .err()
            .expect("шрифт редактора — новый ключ в знакомом разделе, 0.14.0 споткнётся");
        assert!(error.message().contains("editor"), "{error}");
    }

    /// Негодное значение берёт умолчание и называется вместе с тем, что
    /// можно было написать. Соседние ключи применяются.
    #[test]
    fn bad_value_takes_the_default_and_is_named() {
        let loaded = read(
            r#"
            schema = 1
            [editor]
            line_numbers = "иногда"
            wrap = true
        "#,
        );

        assert_eq!(loaded.settings.editor.line_numbers, LineNumbers::Code);
        assert!(loaded.settings.editor.wrap);
        assert!(
            named(&loaded.problems, &["line_numbers", "code"]),
            "жалоба должна называть ключ и допустимые значения: {:?}",
            loaded.problems
        );
    }

    /// Значение не того рода — строка вместо числа — то же самое.
    #[test]
    fn value_of_the_wrong_kind_is_named() {
        let loaded = read(
            r#"
            schema = 1
            [editor]
            indent_width = "четыре"
            auto_close = false
        "#,
        );

        assert_eq!(loaded.settings.editor.indent_width, 4);
        assert!(!loaded.settings.editor.auto_close);
        assert!(named(&loaded.problems, &["indent_width"]));
    }

    /// Шрифт живёт во вложенном разделе, и негодный размер не отнимает
    /// годного имени шрифта рядом с ним.
    #[test]
    fn bad_font_size_keeps_the_font_family() {
        let loaded = read(
            r#"
            schema = 1
            [font.ui]
            family = "Segoe UI"
            size = "крупный"
        "#,
        );

        assert_eq!(loaded.settings.font.ui.family.as_deref(), Some("Segoe UI"));
        assert_eq!(loaded.settings.font.ui.size, None);
        assert!(named(&loaded.problems, &["[font.ui]", "size"]));
    }

    /// Опечатка во вложенном разделе называется с его полным именем.
    #[test]
    fn typo_inside_font_ui_is_named() {
        let loaded = read(
            r#"
            schema = 1
            [font.ui]
            family = "Segoe UI"
            sise = 14
        "#,
        );

        assert_eq!(loaded.settings.font.ui.family.as_deref(), Some("Segoe UI"));
        assert!(named(&loaded.problems, &["[font.ui]", "sise"]));
    }

    /// Незнакомое прямо в `[font]` — тоже называется.
    #[test]
    fn unknown_key_in_font_is_named() {
        let loaded = read(
            r#"
            schema = 1
            [font]
            ligatures = true
            [font.ui]
            size = 15
        "#,
        );

        assert_eq!(loaded.settings.font.ui.size, Some(15));
        assert!(named(&loaded.problems, &["[font]", "ligatures"]));
    }

    /// Шрифт редактора читается так же, как шрифт интерфейса (задача 105),
    /// и негодное значение в одном разделе не трогает другой.
    #[test]
    fn editor_font_is_read_like_the_ui_one() {
        let loaded = read(
            r#"
            schema = 1
            [font.ui]
            family = "Segoe UI"
            [font.editor]
            family = "Cascadia Mono"
            size = "крупный"
        "#,
        );

        assert_eq!(loaded.settings.font.ui.family.as_deref(), Some("Segoe UI"));
        assert_eq!(loaded.settings.font.editor.family.as_deref(), Some("Cascadia Mono"));
        assert_eq!(loaded.settings.font.editor.size, None);
        assert!(named(&loaded.problems, &["[font.editor]", "size"]));
    }

    /// Раздел, записанный не таблицей, берёт умолчания целиком — и об этом
    /// сказано.
    #[test]
    fn section_that_is_not_a_table_is_named() {
        let loaded = read(
            r#"
            schema = 1
            editor = 5
            [appearance]
            theme = "dracula"
        "#,
        );

        assert_eq!(loaded.settings.editor, EditorSettings::default());
        assert_eq!(loaded.settings.appearance.theme, "dracula");
        assert!(named(&loaded.problems, &["[editor]", "разделом"]));
    }

    /// Ключ вне разделов — почти наверняка потерянная строка раздела.
    #[test]
    fn stray_key_outside_sections_is_named() {
        let loaded = read("schema = 1\nwrap = true\n");
        assert!(named(&loaded.problems, &["wrap", "вне разделов"]));
        assert!(!loaded.settings.editor.wrap, "без раздела ключ не применяется");
    }

    /// Настройка, которой в файле нет, берёт умолчание — и для автозакрытия
    /// это `true`, а не `false`.
    ///
    /// Тест не про сериализацию, а про грабли: у `bool` умолчание `false`,
    /// и `derive(Default)` молча выключил бы автозакрытие у всех, у кого
    /// файл настроек написан до появления этого ключа. То есть у всех.
    #[test]
    fn auto_close_is_on_when_the_key_is_missing() {
        let loaded = read(
            r#"
            schema = 1
            [editor]
            wrap = true
        "#,
        );

        assert!(loaded.settings.editor.wrap);
        assert!(
            loaded.settings.editor.auto_close,
            "автозакрытие включено по умолчанию"
        );
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
    }

    /// Номера строк: ключа в файле нет — значит «только в коде», а не
    /// «никогда». Умолчание перечисления пишется руками, как и у `bool`,
    /// и ошибиться здесь так же легко.
    #[test]
    fn line_numbers_default_is_code() {
        let loaded = read("schema = 1\n[editor]\nwrap = true\n");
        assert_eq!(loaded.settings.editor.line_numbers, LineNumbers::Code);
    }

    /// Панель инструментов: раздела нет — набор по умолчанию, над текстом,
    /// над колонкой, обычного размера.
    #[test]
    fn toolbar_defaults_without_the_section() {
        let loaded = read("schema = 1\n");
        let toolbar = &loaded.settings.toolbar;

        assert_eq!(toolbar.items.len(), DEFAULT_TOOLBAR.len());
        assert_eq!(toolbar.show, ToolbarShow::Text);
        assert_eq!(toolbar.width, ToolbarWidth::Column);
        assert_eq!(toolbar.size, ToolbarSize::Normal);
    }

    /// Набор по умолчанию целиком из того, что есть: каждая команда
    /// в реестре, каждое служебное слово известно. Иначе новенький увидел бы
    /// жалобу на файл, которого не трогал.
    #[test]
    fn default_toolbar_names_only_real_commands() {
        let mut problems = Vec::new();
        let items: Vec<String> = DEFAULT_TOOLBAR.iter().map(|item| (*item).to_owned()).collect();
        let kept = known_items(items.clone(), &mut problems);

        assert_eq!(kept, items);
        assert!(problems.is_empty(), "{problems:?}");
    }

    /// Свой состав берётся как есть, в своём порядке.
    #[test]
    fn toolbar_items_come_from_the_file() {
        let loaded = read(
            r#"
            schema = 1
            [toolbar]
            items = ["md.bold", "separator", "spacer", "path", "edit.undo"]
            size = "large"
        "#,
        );

        assert_eq!(
            loaded.settings.toolbar.items,
            vec!["md.bold", "separator", "spacer", "path", "edit.undo"]
        );
        assert_eq!(loaded.settings.toolbar.size, ToolbarSize::Large);
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
    }

    /// Коллаут на панели пишется `callout:тип` и проходит проверку вида.
    #[test]
    fn toolbar_takes_callouts() {
        let loaded = read(
            r#"
            schema = 1
            [toolbar]
            items = ["callout:tip", "callout:", "callout:два слова"]
        "#,
        );

        assert_eq!(loaded.settings.toolbar.items, vec!["callout:tip"]);
        assert_eq!(loaded.problems.len(), 2, "{:?}", loaded.problems);
    }

    /// Незнакомая команда в составе называется и пропускается, соседние
    /// кнопки остаются.
    #[test]
    fn unknown_toolbar_command_is_named_and_skipped() {
        let loaded = read(
            r#"
            schema = 1
            [toolbar]
            items = ["md.bold", "md.blod", "md.italic"]
        "#,
        );

        assert_eq!(loaded.settings.toolbar.items, vec!["md.bold", "md.italic"]);
        assert!(named(&loaded.problems, &["[toolbar]", "md.blod"]));
    }

    /// Прежние ключи панели разметки больше не псевдонимы (задача 107,
    /// как обещал Р-250): они называются, как любой незнакомый ключ,
    /// и ничего не значат — даже `markdown_bar = false` панель не прячет.
    /// Остальной раздел применяется (Р-248).
    ///
    /// Цена названа и принята владельцем: образцы 0.9.0…0.14.0 клали эти
    /// ключи включёнными, и у каждого, кто ставил такую версию с нуля,
    /// полоса будет говорить о них, пока строки не удалят руками.
    #[test]
    fn retired_markdown_bar_keys_are_named_and_ignored() {
        let loaded = read(
            r#"
            schema = 1
            [editor]
            markdown_bar = false
            markdown_bar_width = "full"
            wrap = true
        "#,
        );

        assert!(loaded.settings.editor.wrap);
        assert!(named(&loaded.problems, &["[editor]", "«markdown_bar»"]));
        assert!(named(&loaded.problems, &["[editor]", "«markdown_bar_width»"]));
        assert_eq!(loaded.problems.len(), 2, "{:?}", loaded.problems);
        assert_eq!(loaded.settings.toolbar, ToolbarSettings::default());
    }

    /// Пустой файл — это все значения по умолчанию, а не ошибка.
    #[test]
    fn empty_file_yields_defaults() {
        let loaded = read("schema = 1");
        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.problems.is_empty());
    }

    /// Файл без строки о версии читается как файл этой версии: так его
    /// читали и раньше.
    #[test]
    fn missing_schema_means_the_current_one() {
        let loaded = read("[editor]\nwrap = true\n");
        assert!(loaded.settings.editor.wrap);
        assert_eq!(loaded.settings.schema, SETTINGS_SCHEMA);
    }

    /// Частичный файл дополняется умолчаниями, а не обнуляет остальное.
    #[test]
    fn partial_file_is_filled_with_defaults() {
        let loaded = read(
            r#"
            schema = 1
            [appearance]
            density = "compact"
        "#,
        );

        assert_eq!(loaded.settings.appearance.density, Density::Compact);
        assert_eq!(loaded.settings.appearance.theme, "system");
        assert_eq!(loaded.settings.appearance.light_theme, "light");
    }

    /// Сломанный TOML — по-прежнему ошибка файла целиком: прочитать из него
    /// нечего, и притворяться, что прочитали половину, нельзя.
    #[test]
    fn broken_toml_is_still_an_error() {
        let error = parse("schema = 1\n[editor\nwrap = true\n").expect_err("TOML сломан");
        assert!(matches!(error, SettingsError::Parse(_)));
    }

    /// Версия формата решает, как читать остальное, и терпимости к ней нет.
    #[test]
    fn schema_must_be_a_number() {
        assert!(matches!(parse("schema = \"1\""), Err(SettingsError::Parse(_))));
        assert!(matches!(parse("schema = -1"), Err(SettingsError::Parse(_))));
    }

    /// Файл из будущей версии формата не применяется наполовину.
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
        assert_eq!(load_full(&path), Ok(Loaded::default()));
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
