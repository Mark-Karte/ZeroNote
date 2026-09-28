//! Язык интерфейса и таблицы строк (задача 152, Р-314).
//!
//! Таблица — файл на язык в `l10n/` в корне репозитория: плоский JSON,
//! ключ — область и смысл через точку (`status.words`), значение — строка
//! или формы числа (`{"one": …, "few": …, "many": …}`). Таблица одна
//! на ядро и окно: окно грузит её само, ядро вшивает в себя
//! (`include_str!`) и пишет по ней свои сообщения — жалобы на конфиги,
//! ошибки.
//!
//! **Язык один на всё время работы процесса.** Выбирается при старте,
//! до окна (`init`), смена — перезапуском (ответ владельца на вопрос 3
//! плана этапа 21). Поэтому хранится он в `OnceLock` — ячейке, которую
//! можно заполнить один раз и потом читать из любого потока без замка:
//! `Mutex` здесь стерёг бы значение, которое никогда не меняется.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::OnceLock;

/// Настройка `[appearance] language`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LanguageSetting {
    /// Русский, если русский есть в списке языков Windows, иначе английский
    /// (ответ владельца на вопрос 2 плана этапа 21).
    #[default]
    Auto,
    Ru,
    En,
}

/// Язык, на котором говорит приложение.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Ru,
    En,
}

/// Все языки приложения. Новый язык — файл в `l10n/`, вариант здесь
/// и строка в `source`; тест сверяет этот список с папкой.
pub const LANGUAGES: [Lang; 2] = [Lang::Ru, Lang::En];

impl Lang {
    /// Код языка: так называется файл таблицы и так его понимает `Intl` окна.
    pub fn code(self) -> &'static str {
        match self {
            Lang::Ru => "ru",
            Lang::En => "en",
        }
    }

    /// Номер в `LANGUAGES` — место его таблицы в `TABLES`.
    fn index(self) -> usize {
        match self {
            Lang::Ru => 0,
            Lang::En => 1,
        }
    }

    /// Текст таблицы, вшитый в программу при сборке.
    fn source(self) -> &'static str {
        match self {
            Lang::Ru => include_str!("../../l10n/ru.json"),
            Lang::En => include_str!("../../l10n/en.json"),
        }
    }
}

/// Строка таблицы: просто текст или формы числа.
///
/// `untagged` — serde пробует варианты по очереди: строка JSON становится
/// `Text`, объект — `Forms`. Метки вида в файле нет, и переводчику
/// не нужно о ней знать.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(untagged)]
enum Message {
    Text(String),
    Forms(HashMap<String, String>),
}

type Table = HashMap<String, Message>;

static LANG: OnceLock<Lang> = OnceLock::new();

/// Разобранные таблицы — по ячейке на язык, разбираются при первой нужде.
///
/// По ячейке, а не одна на выбранный язык: строка, попрошенная до `init`,
/// разберёт русскую таблицу, и это не должно навсегда закрыть дорогу
/// английской.
static TABLES: [OnceLock<Table>; 2] = [OnceLock::new(), OnceLock::new()];

/// Поставить язык процесса. Второй вызов ничего не меняет: язык
/// выбирается один раз, при старте.
pub fn init(lang: Lang) {
    let _ = LANG.set(lang);
}

/// Язык процесса. До `init` — русский: так живут тесты, и так было
/// до задачи 152.
pub fn current() -> Lang {
    LANG.get().copied().unwrap_or(Lang::Ru)
}

/// Выбрать язык при старте: по настройке, а `auto` — по языкам Windows.
///
/// Настройки читаются здесь отдельно от окна: язык нужен раньше окна,
/// и нечитаемый файл — не повод молчать по-английски тому, кто выбрал
/// русский, поэтому неудача значит `auto`, а жалобу на файл назовёт окно.
pub fn decide(data_dir: &Path) -> Lang {
    let setting = crate::settings::load(&data_dir.join("settings.toml"))
        .map(|settings| settings.appearance.language)
        .unwrap_or_default();
    match setting {
        LanguageSetting::Ru => Lang::Ru,
        LanguageSetting::En => Lang::En,
        // Спрашиваем Windows, только когда выбирать ей.
        LanguageSetting::Auto => choose_auto(windows_languages().as_deref(), windows_ui_is_russian()),
    }
}

/// Правило `auto`: русский, если русский есть в списке языков Windows.
///
/// Список не прочитался — запасной путь: язык интерфейса Windows.
pub fn choose_auto(windows_languages: Option<&[String]>, ui_is_russian: bool) -> Lang {
    let russian = match windows_languages {
        Some(list) => list.iter().any(|tag| is_russian(tag)),
        None => ui_is_russian,
    };
    if russian { Lang::Ru } else { Lang::En }
}

/// `ru`, `ru-RU`, `ru-UA` — русский; `ro` и `rue` — нет.
fn is_russian(tag: &str) -> bool {
    tag.split(['-', '_'])
        .next()
        .is_some_and(|primary| primary.eq_ignore_ascii_case("ru"))
}

/// Строка по ключу на языке процесса.
pub fn tr(key: &str) -> String {
    translate(current(), key, &[])
}

/// Строка по ключу с подстановками `{имя}`.
pub fn tr_with(key: &str, params: &[(&str, &str)]) -> String {
    translate(current(), key, params)
}

/// Строка с числом — в форме, которой число требует язык. `{count}`
/// подставляется само, с разрядами.
pub fn tr_n(key: &str, count: u64, params: &[(&str, &str)]) -> String {
    translate_n(current(), key, count, params)
}

/// Разобранная таблица языка. Файл вшит в программу и сверен тестом,
/// поэтому неудача разбора здесь невозможна; случись она — пустая
/// таблица и ключи на экране, а не паника (Р-308).
fn table(lang: Lang) -> &'static Table {
    TABLES[lang.index()].get_or_init(|| serde_json::from_str(lang.source()).unwrap_or_default())
}

fn translate(lang: Lang, key: &str, params: &[(&str, &str)]) -> String {
    match table(lang).get(key) {
        Some(Message::Text(text)) => fill(text, params),
        // Ключа нет — сам ключ: видно сразу и называет, чего не хватает.
        _ => key.to_owned(),
    }
}

fn translate_n(lang: Lang, key: &str, count: u64, params: &[(&str, &str)]) -> String {
    let text = match table(lang).get(key) {
        Some(Message::Text(text)) => text.as_str(),
        Some(Message::Forms(forms)) => {
            // Нужной формы нет — «other», потом «many»: у русского целые
            // числа в «other» не попадают, и таблица его держать не обязана.
            let form = plural_form(lang, count);
            match [form, "other", "many"].iter().find_map(|name| forms.get(*name)) {
                Some(text) => text.as_str(),
                None => return key.to_owned(),
            }
        }
        None => return key.to_owned(),
    };
    let formatted = format_count(lang, count);
    let mut all: Vec<(&str, &str)> = vec![("count", formatted.as_str())];
    all.extend_from_slice(params);
    fill(text, &all)
}

/// Форма числа по правилам Unicode — те же, что у `Intl.PluralRules`
/// в окне, для целых чисел.
fn plural_form(lang: Lang, count: u64) -> &'static str {
    match lang {
        Lang::Ru => {
            let (mod10, mod100) = (count % 10, count % 100);
            if mod10 == 1 && mod100 != 11 {
                "one"
            } else if (2..=4).contains(&mod10) && !(12..=14).contains(&mod100) {
                "few"
            } else {
                "many"
            }
        }
        Lang::En => {
            if count == 1 {
                "one"
            } else {
                "other"
            }
        }
    }
}

/// Число с разрядами, как пишет `Intl.NumberFormat` окна: по-русски —
/// неразрывным пробелом и только с пяти знаков (`1234`, `12 345`),
/// по-английски — запятой с четырёх (`1,234`).
fn format_count(lang: Lang, count: u64) -> String {
    let (separator, from) = match lang {
        // Неразрывный пробел — из кода знака: записанный escape-последовательностью
        // в исходнике, он однажды доехал до файла самим знаком (CLAUDE.md).
        Lang::Ru => (char::from_u32(0xA0).unwrap_or(' '), 10_000),
        Lang::En => (',', 1_000),
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

/// Строка для Win32: UTF-16 с нулём на конце.
fn wide(text: &str) -> Vec<u16> {
    OsStr::new(text).encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_table_parses_into_messages() {
        // Окно читает JSON само и простит то, чего ядро не поймёт: значение
        // не строкой и не формами. Разбор здесь — строгий, без умолчаний.
        for lang in LANGUAGES {
            let parsed: Result<Table, _> = serde_json::from_str(lang.source());
            assert!(parsed.is_ok(), "{}: {:?}", lang.code(), parsed.err());
        }
    }

    #[test]
    fn languages_list_matches_the_folder() {
        let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../l10n");
        let mut files: Vec<String> = std::fs::read_dir(&folder)
            .expect("папка l10n")
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
            .filter(|name| name.ends_with(".json"))
            .collect();
        files.sort();
        let mut known: Vec<String> = LANGUAGES.iter().map(|lang| format!("{}.json", lang.code())).collect();
        known.sort();
        assert_eq!(files, known, "файл таблицы без языка в LANGUAGES или язык без файла");
        for (index, lang) in LANGUAGES.iter().enumerate() {
            assert_eq!(lang.index(), index);
        }
    }

    #[test]
    fn russian_is_the_default_language() {
        // `init` в тестах не зовётся — язык по умолчанию русский.
        assert_eq!(tr("status.wrap.on"), "перенос");
        assert_eq!(translate(Lang::En, "status.wrap.on", &[]), "wrap");
    }

    #[test]
    fn missing_key_shows_itself() {
        assert_eq!(translate(Lang::Ru, "нет.такого", &[]), "нет.такого");
        assert_eq!(translate_n(Lang::En, "нет.такого", 3, &[]), "нет.такого");
    }

    #[test]
    fn placeholders_are_filled_and_unknown_ones_stay() {
        assert_eq!(fill("стр {line}, кол {column}", &[("line", "3"), ("column", "14")]), "стр 3, кол 14");
        assert_eq!(fill("Подставляются {{date}} и {title}", &[("title", "X")]), "Подставляются {{date}} и X");
        assert_eq!(fill("{1} {} { name} {name", &[("name", "N")]), "{1} {} { name} {name");
        assert_eq!(
            translate(Lang::En, "status.position", &[("line", "7"), ("column", "2")]),
            "Ln 7, Col 2"
        );
    }

    #[test]
    fn russian_plural_forms() {
        let form = |n| plural_form(Lang::Ru, n);
        for n in [1, 21, 101, 1001] {
            assert_eq!(form(n), "one", "{n}");
        }
        for n in [2, 3, 4, 22, 104] {
            assert_eq!(form(n), "few", "{n}");
        }
        for n in [0, 5, 11, 12, 14, 19, 25, 111, 112] {
            assert_eq!(form(n), "many", "{n}");
        }
        assert_eq!(translate_n(Lang::Ru, "status.words", 21, &[]), "21 слово");
        assert_eq!(translate_n(Lang::Ru, "status.words", 22, &[]), "22 слова");
        assert_eq!(translate_n(Lang::Ru, "status.words", 11, &[]), "11 слов");
    }

    #[test]
    fn english_plural_forms_and_extra_params() {
        assert_eq!(translate_n(Lang::En, "status.words", 1, &[]), "1 word");
        assert_eq!(translate_n(Lang::En, "status.words", 0, &[]), "0 words");
        assert_eq!(
            translate_n(Lang::En, "status.words.selected", 1234, &[("selected", "12")]),
            "12 of 1,234 words"
        );
    }

    #[test]
    fn counts_are_grouped_like_intl() {
        let nbsp = char::from_u32(0xA0).unwrap();
        assert_eq!(format_count(Lang::Ru, 1234), "1234");
        assert_eq!(format_count(Lang::Ru, 12345), format!("12{nbsp}345"));
        assert_eq!(format_count(Lang::Ru, 1234567), format!("1{nbsp}234{nbsp}567"));
        assert_eq!(format_count(Lang::En, 999), "999");
        assert_eq!(format_count(Lang::En, 1234), "1,234");
        assert_eq!(format_count(Lang::En, 1234567), "1,234,567");
    }

    #[test]
    fn auto_follows_the_windows_language_list() {
        let list = |tags: &[&str]| tags.iter().map(|tag| tag.to_string()).collect::<Vec<_>>();
        // Список владельца: русская Windows, английский добавлен.
        assert_eq!(choose_auto(Some(&list(&["ru", "en-US"])), true), Lang::Ru);
        // Английская Windows с русской раскладкой — всё равно русский.
        assert_eq!(choose_auto(Some(&list(&["en-US", "ru"])), false), Lang::Ru);
        assert_eq!(choose_auto(Some(&list(&["en-GB", "ru-RU"])), false), Lang::Ru);
        // Русского в списке нет — английский, даже если интерфейс русский.
        assert_eq!(choose_auto(Some(&list(&["en-US", "de-DE"])), true), Lang::En);
        assert_eq!(choose_auto(Some(&list(&["ro-RO", "rue"])), false), Lang::En);
        // Список не прочитался — по языку интерфейса.
        assert_eq!(choose_auto(None, true), Lang::Ru);
        assert_eq!(choose_auto(None, false), Lang::En);
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
        let dir = std::env::temp_dir().join(format!("zeronote-l10n-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.toml"), "[appearance]\nlanguage = \"en\"\n").unwrap();
        assert_eq!(decide(&dir), Lang::En);
        std::fs::write(dir.join("settings.toml"), "[appearance]\nlanguage = \"ru\"\n").unwrap();
        assert_eq!(decide(&dir), Lang::Ru);
        std::fs::remove_dir_all(&dir).ok();
    }
}
