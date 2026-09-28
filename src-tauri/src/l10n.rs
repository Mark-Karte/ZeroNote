//! Язык интерфейса и таблицы строк (задача 152, Р-314; свои переводы —
//! задача 153, Р-315).
//!
//! Таблица — файл на язык: плоский JSON, ключ — область и смысл через точку
//! (`status.words`), значение — строка или формы числа
//! (`{"one": …, "few": …, "many": …}`). Встроенные языки — `l10n/` в корне
//! репозитория, вшиты в программу (`include_str!`). **Свой перевод — файл
//! в папке данных**, `data/l10n/<код>.json`: его подхватывает запуск, без
//! пересборки (просьба владельца на задаче 153). Чего в своём файле нет —
//! берётся у встроенного языка того же кода, а потом по-английски: перевод
//! может быть неполным, и новые строки следующей версии не превратятся
//! в ключи на экране.
//!
//! **Язык один на всё время работы процесса.** Выбирается при старте,
//! до окна (`start`), смена — перезапуском (ответ владельца на вопрос 3
//! плана этапа 21). Поэтому он хранится в `OnceLock` — ячейке, которую
//! заполняют один раз и потом читают из любого потока без замка: `Mutex`
//! стерёг бы значение, которое никогда не меняется.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Настройка `[appearance] language`: `auto` или код языка.
///
/// `try_from`/`into` — serde разбирает значение через строку: так в файле
/// оно пишется как есть (`language = "de"`), а негодное называется словами
/// из `TryFrom`, как любое негодное значение настроек (Р-248).
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub enum LanguageSetting {
    /// Русский, если русский есть в списке языков Windows (ответ владельца
    /// на вопрос 2 плана этапа 21); иначе первый язык из того же списка,
    /// для которого есть перевод; иначе английский.
    #[default]
    Auto,
    /// Код языка: встроенного (`ru`, `en`) или своего перевода (`de`, `pt-BR`).
    Code(String),
}

impl TryFrom<String> for LanguageSetting {
    type Error = String;

    fn try_from(value: String) -> Result<Self, String> {
        let value = value.trim();
        if value.eq_ignore_ascii_case("auto") {
            return Ok(LanguageSetting::Auto);
        }
        normalize_code(value)
            .map(LanguageSetting::Code)
            .ok_or_else(|| tr_with("l10n.code.invalid", &[("value", value)]))
    }
}

impl From<LanguageSetting> for String {
    fn from(setting: LanguageSetting) -> String {
        match setting {
            LanguageSetting::Auto => "auto".to_owned(),
            LanguageSetting::Code(code) => code,
        }
    }
}

/// Встроенный язык — его таблица вшита в программу.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Builtin {
    Ru,
    En,
}

/// Все встроенные языки. Новый — файл в `l10n/`, вариант здесь и строка
/// в `source`; тест сверяет этот список с папкой.
pub const BUILTIN: [Builtin; 2] = [Builtin::Ru, Builtin::En];

impl Builtin {
    /// Код языка: так называется файл таблицы и так его понимает `Intl` окна.
    pub fn code(self) -> &'static str {
        match self {
            Builtin::Ru => "ru",
            Builtin::En => "en",
        }
    }

    /// Номер в `BUILTIN` — место его таблицы в `TABLES`.
    fn index(self) -> usize {
        match self {
            Builtin::Ru => 0,
            Builtin::En => 1,
        }
    }

    /// Текст таблицы, вшитый в программу при сборке.
    fn source(self) -> &'static str {
        match self {
            Builtin::Ru => include_str!("../../l10n/ru.json"),
            Builtin::En => include_str!("../../l10n/en.json"),
        }
    }

    /// Встроенный язык по коду — по основной части: `en-GB` опирается
    /// на `en`, и свой британский перевод правит только то, что иначе.
    pub fn for_code(code: &str) -> Option<Builtin> {
        let primary = primary(code);
        BUILTIN.into_iter().find(|builtin| builtin.code() == primary)
    }
}

/// Строка таблицы: просто текст или формы числа.
///
/// `untagged` — serde пробует варианты по очереди: строка JSON становится
/// `Text`, объект — `Forms`. Метки вида в файле нет, и переводчику
/// не нужно о ней знать.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(untagged)]
pub enum Message {
    Text(String),
    Forms(BTreeMap<String, String>),
}

pub type Table = HashMap<String, Message>;

/// Язык процесса: код и то, откуда брать строки.
#[derive(Debug)]
struct Current {
    code: String,
    /// Свой файл перевода, если он есть.
    user: Option<Table>,
    /// Встроенный язык того же кода — у него берётся то, чего нет в своём.
    builtin: Option<Builtin>,
}

static CURRENT: OnceLock<Current> = OnceLock::new();

/// Разобранные встроенные таблицы — по ячейке на язык, разбираются при
/// первой нужде. По ячейке, а не одна на выбранный язык: строка, попрошенная
/// до выбора, разберёт русскую таблицу, и это не должно закрыть дорогу
/// остальным.
static TABLES: [OnceLock<Table>; 2] = [OnceLock::new(), OnceLock::new()];

/// Имена форм числа по Unicode — то же, что знает `Intl.PluralRules`.
const FORMS: [&str; 6] = ["zero", "one", "two", "few", "many", "other"];

// ---------------------------------------------------------------------------
// Выбор языка при старте

/// То, что не удалось при выборе языка. Словами становится после выбора:
/// сказать о неудаче надо на том языке, который в итоге выбран.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Problem {
    /// В настройке язык, которого нет ни среди встроенных, ни в папке.
    Unknown(String),
    /// Файл перевода не читается или не JSON-объект.
    Broken { file: String, error: String },
    /// Строки своего файла, которые пропущены: не строка и не формы числа
    /// или не те подстановки. Вместо них — встроенные.
    Skipped { file: String, count: u64 },
}

impl Problem {
    fn text(&self) -> String {
        match self {
            Problem::Unknown(code) => tr_with("l10n.unknown", &[("code", code)]),
            Problem::Broken { file, error } => tr_with("l10n.file.broken", &[("file", file), ("error", error)]),
            Problem::Skipped { file, count } => tr_n("l10n.file.skipped", *count, &[("file", file)]),
        }
    }
}

/// Выбрать язык процесса: по настройке, а `auto` — по языкам Windows.
/// Вернуть жалобы — уже на выбранном языке — для полосы предупреждений.
///
/// Настройки читаются здесь отдельно от окна: язык нужен раньше окна.
/// Нечитаемый файл настроек значит `auto`; жалобу на него назовёт окно.
pub fn start(data_dir: &Path) -> Vec<String> {
    let (current, problems) = decide(data_dir, windows_languages().as_deref(), windows_ui_is_russian());
    let _ = CURRENT.set(current);
    problems.iter().map(Problem::text).collect()
}

fn decide(data_dir: &Path, windows: Option<&[String]>, ui_is_russian: bool) -> (Current, Vec<Problem>) {
    let setting = crate::settings::load(&data_dir.join("settings.toml"))
        .map(|settings| settings.appearance.language)
        .unwrap_or_default();
    let files = user_files(data_dir);
    let mut problems = Vec::new();

    let wanted = match setting {
        LanguageSetting::Code(code) if available(&code, &files) => Some(code),
        LanguageSetting::Code(code) => {
            problems.push(Problem::Unknown(code));
            None
        }
        LanguageSetting::Auto => None,
    };
    let code = wanted.unwrap_or_else(|| choose_auto(windows, ui_is_russian, &files));

    let builtin = Builtin::for_code(&code);
    let mut user = None;
    if let Some(path) = file_for(&code, &files) {
        match read_user(path) {
            Ok((table, skipped)) => {
                if skipped > 0 {
                    problems.push(Problem::Skipped { file: file_name(path), count: skipped });
                }
                user = Some(table);
            }
            Err(error) => problems.push(Problem::Broken { file: file_name(path), error }),
        }
    }

    // Свой язык без встроенной опоры и с нечитаемым файлом — это пустой
    // язык: всё было бы по-английски под чужим кодом. Честнее выбрать сам.
    if user.is_none() && builtin.is_none() {
        let code = choose_auto(windows, ui_is_russian, &[]);
        let builtin = Builtin::for_code(&code);
        return (Current { code, user: None, builtin }, problems);
    }

    (Current { code, user, builtin }, problems)
}

/// Правило `auto`: русский, если русский есть в списке языков Windows;
/// иначе первый язык списка, для которого есть перевод; иначе английский.
///
/// Список не прочитался — запасной путь: язык интерфейса Windows.
fn choose_auto(windows: Option<&[String]>, ui_is_russian: bool, files: &[(String, PathBuf)]) -> String {
    let Some(list) = windows else {
        return if ui_is_russian { "ru" } else { "en" }.to_owned();
    };
    if list.iter().any(|tag| primary(tag) == "ru") {
        return "ru".to_owned();
    }
    for tag in list {
        if let Some(code) = normalize_code(tag) {
            if available(&code, files) {
                return code;
            }
            // `de-DE` в Windows и `de.json` в папке — один язык.
            let primary = primary(&code).to_owned();
            if available(&primary, files) {
                return primary;
            }
        }
    }
    "en".to_owned()
}

/// Есть ли у языка строки: встроенный с точно таким кодом или свой файл.
fn available(code: &str, files: &[(String, PathBuf)]) -> bool {
    BUILTIN.iter().any(|builtin| builtin.code().eq_ignore_ascii_case(code)) || file_for(code, files).is_some()
}

fn file_for<'a>(code: &str, files: &'a [(String, PathBuf)]) -> Option<&'a Path> {
    files
        .iter()
        .find(|(file_code, _)| file_code.eq_ignore_ascii_case(code))
        .map(|(_, path)| path.as_path())
}

// ---------------------------------------------------------------------------
// Свои переводы: папка данных, `l10n/<код>.json`

/// Папка своих переводов.
pub fn translations_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("l10n")
}

/// Файлы своих переводов: код из имени и путь. Файл с именем, которое
/// не код языка, — не перевод, и его здесь нет.
fn user_files(data_dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(translations_dir(data_dir)) else {
        return Vec::new();
    };
    let mut files: Vec<(String, PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
                && crate::tree::is_plain_file(path)
        })
        .filter_map(|path| {
            let code = normalize_code(path.file_stem()?.to_str()?)?;
            Some((code, path))
        })
        .collect();
    files.sort();
    files
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Прочитать свой перевод терпимо: годные строки берутся, негодные
/// считаются и пропускаются — вместо них покажутся встроенные.
///
/// Негодная — не строка и не формы числа или подстановки не те, что
/// у английской: `{count}`, переведённое словом, показало бы на экране
/// скобки вместо числа. Ключ, которого у английской нет, — не ошибка
/// переводчика, а строка из другой версии; он молча не нужен.
fn read_user(path: &Path) -> Result<(Table, u64), String> {
    let source = crate::fsx::config::read(path)?.ok_or_else(|| tr("l10n.file.gone"))?;
    let value: serde_json::Value = serde_json::from_str(&source).map_err(|error| error.to_string())?;
    let serde_json::Value::Object(entries) = value else {
        return Err(tr("l10n.file.not-object"));
    };

    let english = builtin_table(Builtin::En);
    let mut table = Table::new();
    let mut skipped = 0;
    for (key, value) in entries {
        let Some(origin) = english.get(&key) else { continue };
        match message_of(value) {
            Some(message) if placeholders(&message) == placeholders(origin) => {
                table.insert(key, message);
            }
            _ => skipped += 1,
        }
    }
    Ok((table, skipped))
}

/// Значение JSON как строка таблицы: строка — текст, объект одних строк
/// с именами форм — формы числа; иное — `None`.
fn message_of(value: serde_json::Value) -> Option<Message> {
    match value {
        serde_json::Value::String(text) => Some(Message::Text(text)),
        serde_json::Value::Object(map) => {
            let mut forms = BTreeMap::new();
            for (form, text) in map {
                let serde_json::Value::String(text) = text else { return None };
                if !FORMS.contains(&form.as_str()) {
                    return None;
                }
                forms.insert(form, text);
            }
            (!forms.is_empty()).then_some(Message::Forms(forms))
        }
        _ => None,
    }
}

/// Имена подстановок `{имя}` — у форм числа все вместе.
fn placeholders(message: &Message) -> BTreeSet<String> {
    let texts: Vec<&str> = match message {
        Message::Text(text) => vec![text.as_str()],
        Message::Forms(forms) => forms.values().map(String::as_str).collect(),
    };
    let mut names = BTreeSet::new();
    for text in texts {
        let mut rest = text;
        while let Some(open) = rest.find('{') {
            let after = &rest[open + 1..];
            let len = after
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .unwrap_or(after.len());
            let name = &after[..len];
            if after[len..].starts_with('}') && name.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
                names.insert(name.to_owned());
            }
            rest = after;
        }
    }
    names
}

/// Язык в списке окна параметров.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct LanguageInfo {
    pub code: String,
    /// Есть встроенная таблица этого кода.
    pub builtin: bool,
    /// Есть свой файл этого кода в папке переводов.
    pub file: bool,
    /// Сколько строк английской таблицы есть в своём файле, в процентах.
    /// У встроенного без своего файла — 100.
    pub coverage: u8,
}

/// Все языки, которые можно выбрать: встроенные и свои файлы.
pub fn languages(data_dir: &Path) -> Vec<LanguageInfo> {
    let files = user_files(data_dir);
    let english = builtin_table(Builtin::En);
    let mut list: Vec<LanguageInfo> = BUILTIN
        .iter()
        .map(|builtin| LanguageInfo {
            code: builtin.code().to_owned(),
            builtin: true,
            file: false,
            coverage: 100,
        })
        .collect();
    for (code, path) in &files {
        let coverage = match read_user(path) {
            Ok((table, _)) => percent(table.len(), english.len()),
            Err(_) => 0,
        };
        match list.iter_mut().find(|info| info.code.eq_ignore_ascii_case(code)) {
            // Свой файл встроенного языка правит его строки поштучно —
            // язык остаётся полным, чего бы в файле ни было.
            Some(info) => info.file = true,
            None => list.push(LanguageInfo { code: code.clone(), builtin: false, file: true, coverage }),
        }
    }
    list
}

fn percent(part: usize, whole: usize) -> u8 {
    if whole == 0 {
        return 100;
    }
    u8::try_from(part.min(whole) * 100 / whole).unwrap_or(100)
}

/// Какой язык выбрал бы `auto` — для подписи «Как в Windows (…)».
pub fn auto_code(data_dir: &Path) -> String {
    choose_auto(windows_languages().as_deref(), windows_ui_is_russian(), &user_files(data_dir))
}

/// Завести свой перевод: файл `<код>.json` в папке переводов — копия
/// таблицы встроенного языка того же кода, а без него — английской.
///
/// Существующий файл не переписывается никогда: имя занимается
/// `create_new`, и второй создатель получит отказ — даже появившийся
/// в этот самый миг. Потом содержимое пишется атомарно (инвариант 3).
pub fn create_translation(data_dir: &Path, code: &str) -> Result<PathBuf, String> {
    let code = normalize_code(code.trim()).ok_or_else(|| tr_with("l10n.code.invalid", &[("value", code.trim())]))?;
    let dir = translations_dir(data_dir);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("{code}.json"));

    match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(tr_with("l10n.create.exists", &[("file", &file_name(&path))]));
        }
        Err(error) => return Err(error.to_string()),
    }

    let base = builtin_table(Builtin::for_code(&code).unwrap_or(Builtin::En));
    // Ключи по порядку: переводчику легче идти по файлу областями.
    let sorted: BTreeMap<&String, &Message> = base.iter().collect();
    let mut text = serde_json::to_string_pretty(&sorted).map_err(|error| error.to_string())?;
    text.push('\n');
    if let Err(error) = crate::fsx::atomic_save::save(&path, text.as_bytes()) {
        // Пустой файл, занявший имя, — наш: убрать, чтобы не оставлять
        // пустышку, которую запуск назвал бы нечитаемой.
        std::fs::remove_file(&path).ok();
        return Err(error.to_string());
    }
    Ok(path)
}

// ---------------------------------------------------------------------------
// Коды языков

/// Код языка в привычной записи: `de`, `pt-BR`, `zh-Hans`. `None` — не код.
///
/// Проверяется только вид (BCP 47 в простой форме): основная часть — две-три
/// латинские буквы, дальше до трёх частей из букв и цифр. Есть ли такой
/// язык на свете, знает `Intl` окна, а не мы.
pub fn normalize_code(value: &str) -> Option<String> {
    let parts: Vec<&str> = value.split(['-', '_']).collect();
    let (first, rest) = parts.split_first()?;
    if !(2..=3).contains(&first.len()) || !first.chars().all(|c| c.is_ascii_alphabetic()) || rest.len() > 3 {
        return None;
    }
    let mut out = first.to_ascii_lowercase();
    for part in rest {
        if !(2..=8).contains(&part.len()) || !part.chars().all(|c| c.is_ascii_alphanumeric()) {
            return None;
        }
        out.push('-');
        let alphabetic = part.chars().all(|c| c.is_ascii_alphabetic());
        if part.len() == 2 && alphabetic {
            // Страна: `BR`, `GB`.
            out.push_str(&part.to_ascii_uppercase());
        } else if part.len() == 4 && alphabetic {
            // Письменность: `Hans`, `Latn`.
            out.push_str(&part[..1].to_ascii_uppercase());
            out.push_str(&part[1..].to_ascii_lowercase());
        } else {
            out.push_str(part);
        }
    }
    Some(out)
}

/// Основная часть кода: `ru` у `ru-RU`, `pt` у `pt-BR`.
fn primary(code: &str) -> &str {
    code.split(['-', '_']).next().unwrap_or(code)
}

// ---------------------------------------------------------------------------
// Строки

/// Код языка процесса. До `start` — русский: так живут тесты.
pub fn code() -> String {
    CURRENT.get().map_or_else(|| "ru".to_owned(), |current| current.code.clone())
}

/// Что окну нужно, чтобы говорить на языке процесса.
#[derive(Debug, Clone, serde::Serialize)]
pub struct WindowLanguage {
    pub code: String,
    /// Встроенная таблица, на которую опереться: окно грузит её само.
    pub builtin: Option<&'static str>,
    /// Свой перевод — уже проверенный: только годные строки.
    pub table: Option<Table>,
    /// Первый день недели для календаря: 0 — понедельник, 6 — воскресенье.
    #[serde(rename = "weekStart")]
    pub week_start: u8,
}

pub fn window_language() -> WindowLanguage {
    let week_start = windows_week_start();
    match CURRENT.get() {
        Some(current) => WindowLanguage {
            code: current.code.clone(),
            builtin: current.builtin.map(Builtin::code),
            table: current.user.clone(),
            week_start,
        },
        None => WindowLanguage { code: "ru".to_owned(), builtin: Some("ru"), table: None, week_start },
    }
}

/// Строка по ключу на языке процесса.
pub fn tr(key: &str) -> String {
    translate(CURRENT.get(), key, &[])
}

/// Строка по ключу с подстановками `{имя}`.
pub fn tr_with(key: &str, params: &[(&str, &str)]) -> String {
    translate(CURRENT.get(), key, params)
}

/// Строка с числом — в форме, которой число требует язык. `{count}`
/// подставляется само, с разрядами.
pub fn tr_n(key: &str, count: u64, params: &[(&str, &str)]) -> String {
    translate_n(CURRENT.get(), key, count, params)
}

/// Разобранная встроенная таблица. Файл вшит в программу и сверен тестом,
/// поэтому неудача разбора здесь невозможна; случись она — пустая таблица
/// и ключи на экране, а не паника (Р-308).
fn builtin_table(builtin: Builtin) -> &'static Table {
    TABLES[builtin.index()].get_or_init(|| serde_json::from_str(builtin.source()).unwrap_or_default())
}

/// Строка по цепочке: свой файл → встроенный язык того же кода →
/// английский. До выбора языка — русский.
fn lookup<'a>(current: Option<&'a Current>, key: &str) -> Option<&'a Message> {
    let (user, builtin) = match current {
        Some(current) => (current.user.as_ref(), current.builtin),
        None => (None, Some(Builtin::Ru)),
    };
    user.and_then(|table| table.get(key))
        .or_else(|| builtin.and_then(|builtin| builtin_table(builtin).get(key)))
        .or_else(|| builtin_table(Builtin::En).get(key))
}

fn language_of(current: Option<&Current>) -> &str {
    current.map_or("ru", |current| current.code.as_str())
}

fn translate(current: Option<&Current>, key: &str, params: &[(&str, &str)]) -> String {
    match lookup(current, key) {
        Some(Message::Text(text)) => fill(text, params),
        // Ключа нет — сам ключ: видно сразу и называет, чего не хватает.
        _ => key.to_owned(),
    }
}

fn translate_n(current: Option<&Current>, key: &str, count: u64, params: &[(&str, &str)]) -> String {
    let code = language_of(current);
    let text = match lookup(current, key) {
        Some(Message::Text(text)) => text.as_str(),
        Some(Message::Forms(forms)) => {
            // Нужной формы нет — «other», потом «many», потом любая: у
            // русского целые числа в «other» не попадают, а строка,
            // взятая у английского, знает только «one» и «other».
            let form = plural_form(code, count);
            match [form, "other", "many"].iter().find_map(|name| forms.get(*name)).or_else(|| forms.values().next()) {
                Some(text) => text.as_str(),
                None => return key.to_owned(),
            }
        }
        None => return key.to_owned(),
    };
    let formatted = format_count(code, count);
    let mut all: Vec<(&str, &str)> = vec![("count", formatted.as_str())];
    all.extend_from_slice(params);
    fill(text, &all)
}

/// Форма числа для целых — правила Unicode для русского и его соседей;
/// у остальных «one» для единицы и «other» для прочего.
///
/// Окно считает формы через `Intl.PluralRules` — верно для любого языка.
/// Ядру правила всех языков не нужны: строк с числом у него единицы,
/// и у своего перевода польского или чешского они выйдут в «other» —
/// это цена отказа от библиотеки правил, названная в Р-315.
fn plural_form(code: &str, count: u64) -> &'static str {
    match primary(code) {
        "ru" | "uk" | "be" => {
            let (mod10, mod100) = (count % 10, count % 100);
            if mod10 == 1 && mod100 != 11 {
                "one"
            } else if (2..=4).contains(&mod10) && !(12..=14).contains(&mod100) {
                "few"
            } else {
                "many"
            }
        }
        _ => {
            if count == 1 {
                "one"
            } else {
                "other"
            }
        }
    }
}

/// Число с разрядами, как пишет `Intl.NumberFormat` окна у встроенных
/// языков: по-русски — неразрывным пробелом и только с пяти знаков
/// (`1234`, `12 345`), по-английски — запятой с четырёх (`1,234`).
/// У своего перевода — без разрядов: запятая и точка в разных языках
/// значат противоположное, и `12345` верно везде.
fn format_count(code: &str, count: u64) -> String {
    let (separator, from) = match primary(code) {
        // Неразрывный пробел — из кода знака: записанный escape-последовательностью
        // в исходнике, он однажды доехал до файла самим знаком (CLAUDE.md).
        "ru" => (char::from_u32(0xA0).unwrap_or(' '), 10_000),
        "en" => (',', 1_000),
        _ => return count.to_string(),
    };
    let digits = count.to_string();
    if count < from {
        return digits;
    }
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(separator);
        }
        out.push(digit);
    }
    out
}

/// Подстановка `{имя}`. Имя, которого нет среди подстановок, остаётся как
/// написано: `{{date}}` в тексте о шаблонах — текст, а не подстановка.
fn fill(text: &str, params: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let name_len = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(after.len());
        let name = &after[..name_len];
        let closed = after[name_len..].starts_with('}');
        let starts_with_letter = name.chars().next().is_some_and(|c| c.is_ascii_alphabetic());
        match params.iter().find(|(key, _)| *key == name) {
            Some((_, value)) if closed && starts_with_letter => {
                out.push_str(value);
                rest = &after[name_len + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

// ---------------------------------------------------------------------------
// Языки Windows

/// Список языков из параметров Windows («Время и язык → Язык и регион»):
/// `ru`, `en-US`. Хранится в реестре значением `Languages` вида
/// `REG_MULTI_SZ` — строки подряд, каждая с нулём на конце, и ещё один
/// ноль в конце списка.
///
/// Почему не `GetUserPreferredUILanguages`: на машине владельца она
/// первым назвала `en-US` при русской Windows и списке `ru, en-US`
/// (замер задачи 152) — это список языков показа, а не тот, что человек
/// видит в параметрах.
pub fn windows_languages() -> Option<Vec<String>> {
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_MULTI_SZ,
    };

    let subkey = wide(r"Control Panel\International\User Profile");
    let value = wide("Languages");

    // Первый вызов — узнать размер в байтах, второй — прочитать.
    let mut size: u32 = 0;
    // unsafe — вызов Win32 (Р-314): `RegGetValueW` получает указатели
    // на живые векторы с нулём на конце и на `size`, которые живут до конца
    // функции; буфер не передаётся — система только пишет размер.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_MULTI_SZ,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if status != 0 || size == 0 {
        return None;
    }

    // Размер — в байтах, знак UTF-16 — два байта.
    let mut buffer: Vec<u16> = vec![0; (size as usize).div_ceil(2)];
    // Буфер той длины, что назвала система; `size` она обновит до
    // записанного. Список, выросший между вызовами, — отказ и запасной путь.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_MULTI_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if status != 0 {
        return None;
    }
    buffer.truncate(size as usize / 2);
    Some(split_multi(&buffer))
}

/// Разобрать `REG_MULTI_SZ`: строки через ноль, пустые — конец списка.
fn split_multi(buffer: &[u16]) -> Vec<String> {
    buffer
        .split(|&unit| unit == 0)
        .filter(|part| !part.is_empty())
        .map(String::from_utf16_lossy)
        .collect()
}

/// Русский ли язык интерфейса Windows — запасной путь, когда список языков
/// не прочитался.
pub fn windows_ui_is_russian() -> bool {
    use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;

    // Вызов без аргументов, только возвращает число.
    let id = unsafe { GetUserDefaultUILanguage() };
    // Младшие десять бит — основной язык; русский — 0x19 (`LANG_RUSSIAN`).
    id & 0x3FF == 0x19
}

/// Первый день недели по региональным настройкам Windows («Формат региона»):
/// 0 — понедельник, 6 — воскресенье. Решает регион, а не язык окна
/// (план этапа 21): человек с английским окном и русским регионом ждёт
/// неделю с понедельника. Не прочиталось — понедельник, как до задачи 154.
pub fn windows_week_start() -> u8 {
    use windows_sys::Win32::Globalization::{GetLocaleInfoEx, LOCALE_IFIRSTDAYOFWEEK};

    let mut buffer = [0u16; 4];
    // unsafe — вызов Win32 (Р-314): имя региона — пустой указатель, то есть
    // «регион человека»; буфер — живой массив, его длина названа в знаках.
    let written = unsafe {
        GetLocaleInfoEx(
            std::ptr::null(),
            LOCALE_IFIRSTDAYOFWEEK,
            buffer.as_mut_ptr(),
            buffer.len() as i32,
        )
    };
    // Ответ — одна цифра строкой, «0»…«6», и ноль на конце: два знака.
    match buffer[0] {
        digit @ 0x30..=0x36 if written == 2 => (digit - 0x30) as u8,
        _ => 0,
    }
}

/// Строка для Win32: UTF-16 с нулём на конце.
fn wide(text: &str) -> Vec<u16> {
    OsStr::new(text).encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn language(code: &str) -> Current {
        Current { code: code.to_owned(), user: None, builtin: Builtin::for_code(code) }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("zeronote-l10n-{name}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn list(tags: &[&str]) -> Vec<String> {
        tags.iter().map(|tag| tag.to_string()).collect()
    }

    #[test]
    fn every_builtin_table_parses_into_messages() {
        // Окно читает JSON само и простит то, чего ядро не поймёт: значение
        // не строкой и не формами. Разбор здесь — строгий, без умолчаний.
        for builtin in BUILTIN {
            let parsed: Result<Table, _> = serde_json::from_str(builtin.source());
            assert!(parsed.is_ok(), "{}: {:?}", builtin.code(), parsed.err());
        }
    }

    #[test]
    fn builtin_list_matches_the_folder() {
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../l10n");
        let mut files: Vec<String> = std::fs::read_dir(&folder)
            .expect("папка l10n")
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
            .filter(|name| name.ends_with(".json"))
            .collect();
        files.sort();
        let mut known: Vec<String> = BUILTIN.iter().map(|builtin| format!("{}.json", builtin.code())).collect();
        known.sort();
        assert_eq!(files, known, "файл таблицы без языка в BUILTIN или язык без файла");
        for (index, builtin) in BUILTIN.iter().enumerate() {
            assert_eq!(builtin.index(), index);
        }
    }

    #[test]
    fn russian_is_the_default_language() {
        // `start` в тестах не зовётся — язык по умолчанию русский.
        assert_eq!(tr("status.wrap.on"), "перенос");
        assert_eq!(translate(Some(&language("en")), "status.wrap.on", &[]), "wrap");
    }

    #[test]
    fn missing_key_shows_itself() {
        assert_eq!(translate(Some(&language("ru")), "нет.такого", &[]), "нет.такого");
        assert_eq!(translate_n(Some(&language("en")), "нет.такого", 3, &[]), "нет.такого");
    }

    #[test]
    fn placeholders_are_filled_and_unknown_ones_stay() {
        assert_eq!(fill("стр {line}, кол {column}", &[("line", "3"), ("column", "14")]), "стр 3, кол 14");
        assert_eq!(fill("Подставляются {{date}} и {title}", &[("title", "X")]), "Подставляются {{date}} и X");
        assert_eq!(fill("{1} {} { name} {name", &[("name", "N")]), "{1} {} { name} {name");
        assert_eq!(
            translate(Some(&language("en")), "status.position", &[("line", "7"), ("column", "2")]),
            "Ln 7, Col 2"
        );
    }

    #[test]
    fn russian_plural_forms() {
        let form = |n| plural_form("ru", n);
        for n in [1, 21, 101, 1001] {
            assert_eq!(form(n), "one", "{n}");
        }
        for n in [2, 3, 4, 22, 104] {
            assert_eq!(form(n), "few", "{n}");
        }
        for n in [0, 5, 11, 12, 14, 19, 25, 111, 112] {
            assert_eq!(form(n), "many", "{n}");
        }
        // Украинский считает так же.
        assert_eq!(plural_form("uk", 22), "few");
        let ru = language("ru");
        assert_eq!(translate_n(Some(&ru), "status.words", 21, &[]), "21 слово");
        assert_eq!(translate_n(Some(&ru), "status.words", 22, &[]), "22 слова");
        assert_eq!(translate_n(Some(&ru), "status.words", 11, &[]), "11 слов");
    }

    #[test]
    fn english_plural_forms_and_extra_params() {
        let en = language("en");
        assert_eq!(translate_n(Some(&en), "status.words", 1, &[]), "1 word");
        assert_eq!(translate_n(Some(&en), "status.words", 0, &[]), "0 words");
        assert_eq!(
            translate_n(Some(&en), "status.words.selected", 1234, &[("selected", "12")]),
            "12 of 1,234 words"
        );
    }

    #[test]
    fn counts_are_grouped_like_intl() {
        let nbsp = char::from_u32(0xA0).unwrap();
        assert_eq!(format_count("ru", 1234), "1234");
        assert_eq!(format_count("ru", 12345), format!("12{nbsp}345"));
        assert_eq!(format_count("ru", 1234567), format!("1{nbsp}234{nbsp}567"));
        assert_eq!(format_count("en", 999), "999");
        assert_eq!(format_count("en-GB", 1234), "1,234");
        assert_eq!(format_count("en", 1234567), "1,234,567");
        // У своего языка — без разрядов: у немецкого точка, у французского пробел.
        assert_eq!(format_count("de", 1234567), "1234567");
    }

    #[test]
    fn codes_are_checked_and_written_the_usual_way() {
        assert_eq!(normalize_code("DE").as_deref(), Some("de"));
        assert_eq!(normalize_code("pt_br").as_deref(), Some("pt-BR"));
        assert_eq!(normalize_code("zh-hans").as_deref(), Some("zh-Hans"));
        assert_eq!(normalize_code("sr-Latn-RS").as_deref(), Some("sr-Latn-RS"));
        for bad in ["", "d", "deutsch", "de-", "de-x", "немецкий", "de/..", "a-b-c-d-e"] {
            assert_eq!(normalize_code(bad), None, "{bad}");
        }
    }

    #[test]
    fn setting_is_auto_or_a_code() {
        assert_eq!(LanguageSetting::try_from("auto".to_owned()), Ok(LanguageSetting::Auto));
        assert_eq!(LanguageSetting::try_from("pt-br".to_owned()), Ok(LanguageSetting::Code("pt-BR".into())));
        let error = LanguageSetting::try_from("немецкий".to_owned()).unwrap_err();
        assert!(error.contains("немецкий") && error.contains("pt-BR"), "{error}");
        assert_eq!(String::from(LanguageSetting::Code("de".into())), "de");
    }

    #[test]
    fn auto_follows_the_windows_language_list() {
        let none: &[(String, PathBuf)] = &[];
        // Список владельца: русская Windows, английский добавлен.
        assert_eq!(choose_auto(Some(&list(&["ru", "en-US"])), true, none), "ru");
        // Английская Windows с русской раскладкой — всё равно русский.
        assert_eq!(choose_auto(Some(&list(&["en-US", "ru"])), false, none), "ru");
        assert_eq!(choose_auto(Some(&list(&["en-GB", "ru-RU"])), false, none), "ru");
        // Русского нет — первый язык списка с переводом, иначе английский.
        assert_eq!(choose_auto(Some(&list(&["en-US", "de-DE"])), true, none), "en");
        assert_eq!(choose_auto(Some(&list(&["ro-RO", "rue"])), false, none), "en");
        let de = vec![("de".to_owned(), PathBuf::from("de.json"))];
        assert_eq!(choose_auto(Some(&list(&["de-DE", "en-US"])), false, &de), "de");
        assert_eq!(choose_auto(Some(&list(&["en-US", "de-DE"])), false, &de), "en");
        // Список не прочитался — по языку интерфейса.
        assert_eq!(choose_auto(None, true, none), "ru");
        assert_eq!(choose_auto(None, false, none), "en");
    }

    #[test]
    fn multi_string_is_split_on_zeros() {
        let units: Vec<u16> = "ru\0en-US\0\0".encode_utf16().collect();
        assert_eq!(split_multi(&units), vec!["ru".to_owned(), "en-US".to_owned()]);
        assert!(split_multi(&[0, 0]).is_empty());
    }

    #[test]
    fn windows_is_asked_without_failing() {
        // Содержимое у машины своё — у непрерывной сборки английская
        // Windows, у владельца русская, — проверяется только сам вызов.
        let _ = windows_languages();
        let _ = windows_ui_is_russian();
    }

    #[test]
    fn explicit_setting_wins_over_windows() {
        let dir = temp_dir("explicit");
        std::fs::write(dir.join("settings.toml"), "[appearance]\nlanguage = \"en\"\n").unwrap();
        let (current, problems) = decide(&dir, Some(&list(&["ru"])), true);
        assert_eq!((current.code.as_str(), current.builtin), ("en", Some(Builtin::En)));
        assert!(problems.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unknown_language_is_named_and_auto_is_used() {
        let dir = temp_dir("unknown");
        std::fs::write(dir.join("settings.toml"), "[appearance]\nlanguage = \"de\"\n").unwrap();
        let (current, problems) = decide(&dir, Some(&list(&["ru"])), true);
        assert_eq!(current.code, "ru");
        assert_eq!(problems, vec![Problem::Unknown("de".into())]);
        assert!(problems[0].text().contains("de"));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Свой перевод (задача 153): годные строки — свои, негодные и
    /// недостающие — по-английски; формы числа — по правилам языка окна.
    #[test]
    fn own_translation_falls_back_to_english() {
        let dir = temp_dir("own");
        std::fs::create_dir_all(translations_dir(&dir)).unwrap();
        std::fs::write(dir.join("settings.toml"), "[appearance]\nlanguage = \"DE\"\n").unwrap();
        std::fs::write(
            translations_dir(&dir).join("de.json"),
            r#"{
              "status.wrap.on": "Umbruch",
              "status.position": "Z. {zeile}, Sp. {column}",
              "status.words": { "one": "{count} Wort", "other": "{count} Wörter" },
              "status.cursors": { "one": 1 },
              "nicht.bekannt": "egal"
            }"#,
        )
        .unwrap();

        let (current, problems) = decide(&dir, Some(&list(&["ru"])), true);
        assert_eq!((current.code.as_str(), current.builtin), ("de", None));
        // Подстановки не те и не строка — две пропущены; чужой ключ — молча.
        assert_eq!(problems, vec![Problem::Skipped { file: "de.json".into(), count: 2 }]);
        let current = Some(&current);
        assert_eq!(translate(current, "status.wrap.on", &[]), "Umbruch");
        assert_eq!(translate(current, "status.wrap.off", &[]), "no wrap");
        assert_eq!(translate(current, "status.position", &[("line", "1"), ("column", "2")]), "Ln 1, Col 2");
        assert_eq!(translate_n(current, "status.words", 12345, &[]), "12345 Wörter");
        assert_eq!(translate_n(current, "status.cursors", 2, &[]), "2 cursors");

        let listed = languages(&dir);
        let de = listed.iter().find(|info| info.code == "de").expect("de в списке");
        assert!(de.file && !de.builtin && de.coverage < 100);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn own_file_of_a_builtin_language_edits_it_one_by_one() {
        let dir = temp_dir("override");
        std::fs::create_dir_all(translations_dir(&dir)).unwrap();
        std::fs::write(dir.join("settings.toml"), "[appearance]\nlanguage = \"ru\"\n").unwrap();
        std::fs::write(translations_dir(&dir).join("ru.json"), r#"{ "status.wrap.on": "перенос строк" }"#).unwrap();
        let (current, _) = decide(&dir, None, false);
        let current = Some(&current);
        assert_eq!(translate(current, "status.wrap.on", &[]), "перенос строк");
        assert_eq!(translate(current, "status.wrap.off", &[]), "без переноса");
        let listed = languages(&dir);
        assert_eq!(listed.iter().filter(|info| info.code == "ru").count(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn broken_own_file_is_named_and_the_language_chosen_by_itself() {
        let dir = temp_dir("broken");
        std::fs::create_dir_all(translations_dir(&dir)).unwrap();
        std::fs::write(dir.join("settings.toml"), "[appearance]\nlanguage = \"de\"\n").unwrap();
        std::fs::write(translations_dir(&dir).join("de.json"), "{ не json").unwrap();
        let (current, problems) = decide(&dir, None, false);
        assert_eq!(current.code, "en");
        assert!(matches!(&problems[..], [Problem::Broken { file, .. }] if file == "de.json"), "{problems:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn new_translation_is_a_copy_and_never_overwrites() {
        let dir = temp_dir("create");
        let path = create_translation(&dir, "pt_br").unwrap();
        assert_eq!(file_name(&path), "pt-BR.json");
        let (table, skipped) = read_user(&path).unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(table.len(), builtin_table(Builtin::En).len());

        // Второй раз — отказ, и файл, в котором уже переводили, цел.
        std::fs::write(&path, "{}").unwrap();
        let error = create_translation(&dir, "pt-BR").unwrap_err();
        assert!(error.contains("pt-BR.json"), "{error}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");

        // Свой файл русского начинается с русской таблицы.
        let ru = create_translation(&dir, "ru").unwrap();
        assert!(std::fs::read_to_string(&ru).unwrap().contains("перенос"));
        assert!(create_translation(&dir, "немецкий").is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
