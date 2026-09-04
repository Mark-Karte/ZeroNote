//! Горячие клавиши: список команд, раскладка по умолчанию и переназначение
//! через `data/keymap.toml`.
//!
//! Раскладка выросла из Notepad++ и в основном такой и осталась: ломать то,
//! чем тестировщики пользуются четвёртый месяц, дороже, чем совпасть
//! с эталоном. Но ориентир теперь VS Code и Obsidian (Р-114), и новые
//! сочетания берутся оттуда.
//!
//! Сочетание записывается строкой вида `ctrl+shift+d`. Порядок частей и
//! регистр в файле пользователя произвольны — при разборе всё приводится
//! к одному виду, иначе `Shift+Ctrl+D` и `ctrl+shift+d` считались бы
//! разными сочетаниями и молча перекрывали бы друг друга.

pub mod edit;

use std::collections::BTreeMap;

/// Все команды, которым можно назначить сочетание.
///
/// Список канонический: имена отсюда обязаны совпадать с реестром обработчиков
/// во фронтенде, это проверяет тест `tests/keymap.test.ts`. Опечатка в файле
/// пользователя тоже сверяется с этим списком и называется по имени.
pub const COMMANDS: &[(&str, &str)] = &[
    ("file.new", "Создать файл"),
    ("file.open", "Открыть файл"),
    ("file.save", "Сохранить"),
    ("file.save-as", "Сохранить как"),
    ("file.save-all", "Сохранить всё"),
    ("file.close-tab", "Закрыть вкладку"),
    ("file.close-all", "Закрыть все вкладки"),
    ("edit.undo", "Отменить"),
    ("edit.redo", "Повторить"),
    // Буфер обмена. Сочетания за ними записаны, но нажатие перехватывает
    // не приложение, а вебвью — он делает это правильно (Р-108). Команды
    // нужны меню и палитре: пункт меню нажатием клавиши не является.
    ("edit.cut", "Вырезать"),
    ("edit.copy", "Копировать"),
    ("edit.paste", "Вставить"),
    ("edit.select-all", "Выделить всё"),
    ("edit.select-line", "Выделить строку"),
    // Отмена курсора, а не текста: снимает последний добавленный курсор
    // или возвращает выделение, каким оно было до промаха. До задачи 41
    // команда была недоступна вовсе — сочетание над ней перекрывалось.
    ("edit.undo-cursor", "Отменить последний курсор"),
    ("edit.redo-cursor", "Вернуть последний курсор"),
    ("edit.toggle-comment", "Закомментировать или раскомментировать"),
    ("edit.duplicate-line", "Продублировать строку"),
    ("edit.add-cursor-next", "Курсор на следующее совпадение"),
    ("edit.toggle-wrap", "Перенос длинных строк"),
    ("edit.delete-line", "Удалить строку"),
    ("edit.move-line-up", "Переместить строку вверх"),
    ("edit.move-line-down", "Переместить строку вниз"),
    ("edit.upper-case", "В верхний регистр"),
    ("edit.lower-case", "В нижний регистр"),
    ("search.find", "Найти"),
    ("search.replace", "Заменить"),
    ("search.find-next", "Найти далее"),
    ("search.find-previous", "Найти ранее"),
    ("view.bookmark", "Поставить или снять закладку"),
    ("view.bookmark-next", "Следующая закладка"),
    ("view.bookmark-previous", "Предыдущая закладка"),
    ("view.bookmarks-clear", "Снять все закладки"),
    ("view.invisibles", "Показывать невидимые символы"),
    ("view.fold", "Свернуть блок"),
    ("view.unfold", "Развернуть блок"),
    ("view.fold-all", "Свернуть всё"),
    ("view.unfold-all", "Развернуть всё"),
    ("view.go-to-bracket", "Перейти к парной скобке"),
    ("view.go-to-line", "Перейти к строке"),
    ("view.next-tab", "Следующая вкладка"),
    ("view.previous-tab", "Предыдущая вкладка"),
    ("view.sidebar", "Показать боковую панель"),
    // Сочетания нет: в VS Code и Obsidian у оглавления его тоже нет,
    // а место в раскладке дорого. Назначить можно во вкладке «Клавиши».
    ("view.outline", "Оглавление документа"),
    ("view.settings", "Параметры"),
    ("project.add-root", "Открыть папку"),
    ("project.quick-open", "Быстрое открытие по имени"),
    ("project.commands", "Палитра команд"),
    ("project.tags", "Палитра тегов"),
    ("project.search", "Найти в проекте"),
    ("project.follow-link", "Перейти по ссылке под курсором"),
    ("project.backlinks", "Обратные ссылки"),
    // Подпись начинается со слова «версия» намеренно: в палитре ищут по ней,
    // а не по «о программе». Спрашивают всегда версию.
    ("help.about", "Версия и сведения о программе"),
    // Единственная команда, открывающая сетевое соединение (Р-118).
    ("help.check-updates", "Проверить обновления"),
    // Разметка markdown. Сочетаний у них нет по решению владельца: в Obsidian
    // это Ctrl+B, Ctrl+I и Ctrl+K, но Ctrl+B у нас боковая панель (Р-053),
    // и жмут её постоянно. Команды в реестре есть, и назначить им сочетание
    // можно во вкладке «Клавиши» (Р-127).
    ("md.bold", "Жирный"),
    ("md.italic", "Курсив"),
    ("md.strikethrough", "Зачёркнутый"),
    ("md.highlight", "Выделение цветом"),
    ("md.code", "Код в строке"),
    ("md.link", "Ссылка"),
    ("md.heading-1", "Заголовок 1"),
    ("md.heading-2", "Заголовок 2"),
    ("md.heading-3", "Заголовок 3"),
    ("md.bullet-list", "Маркированный список"),
    ("md.ordered-list", "Нумерованный список"),
    ("md.task-list", "Список задач"),
    ("md.quote", "Цитата"),
    // Заготовки. Подпись начинается с «Заготовка», чтобы все три находились
    // в палитре одним словом.
    ("md.table", "Заготовка: таблица"),
    ("md.code-block", "Заготовка: блок кода"),
    ("md.divider", "Заготовка: разделитель"),
];

/// Раскладка по умолчанию.
///
/// Основа — Notepad++ 8.x, сверенная с его меню. Там, где сочетания в нём нет
/// или оно занято под другое, берётся привычное по VS Code: решения Р-053
/// и Р-114. Каждый такой случай отмечен комментарием рядом.
pub const DEFAULTS: &[(&str, &str)] = &[
    ("ctrl+n", "file.new"),
    ("ctrl+o", "file.open"),
    ("ctrl+s", "file.save"),
    ("ctrl+alt+s", "file.save-as"),
    ("ctrl+shift+s", "file.save-all"),
    ("ctrl+w", "file.close-tab"),
    ("ctrl+shift+w", "file.close-all"),
    ("ctrl+z", "edit.undo"),
    ("ctrl+y", "edit.redo"),
    ("ctrl+x", "edit.cut"),
    ("ctrl+c", "edit.copy"),
    ("ctrl+v", "edit.paste"),
    ("ctrl+a", "edit.select-all"),
    // Ctrl+D отдан мультикурсору, как в VS Code (Р-091): дублирование строки
    // переехало на соседнее сочетание. Это единственное расхождение
    // с раскладкой Notepad++, и оно сделано по решению владельца.
    ("ctrl+d", "edit.add-cursor-next"),
    ("ctrl+shift+d", "edit.duplicate-line"),
    // Удаление строки переехало с Ctrl+L на сочетание VS Code (Р-120).
    // Ctrl+L там выделяет строку, и рука, пришедшая оттуда, удаляла у нас
    // строку молча — единственное расхождение, которое портило текст,
    // а не просто не совпадало.
    ("ctrl+shift+k", "edit.delete-line"),
    ("ctrl+l", "edit.select-line"),
    ("ctrl+shift+up", "edit.move-line-up"),
    ("ctrl+shift+down", "edit.move-line-down"),
    // Отмена курсора — сочетание VS Code, и оно же родное для CodeMirror.
    // До задачи 41 его перекрывала смена регистра; у смены регистра
    // сочетания теперь нет вовсе, как и в VS Code, — она осталась командой
    // в палитре и в контекстном меню (Р-120).
    ("ctrl+u", "edit.undo-cursor"),
    ("alt+u", "edit.redo-cursor"),
    ("ctrl+slash", "edit.toggle-comment"),
    ("ctrl+f", "search.find"),
    ("ctrl+h", "search.replace"),
    ("f3", "search.find-next"),
    ("shift+f3", "search.find-previous"),
    // Свёртка. «Свернуть всё» и «развернуть всё» — сочетания Notepad++.
    // Для одного блока там стоит «свернуть текущий уровень»; смысл близкий,
    // но не тот же: у нас сворачивается блок под курсором, а не весь уровень.
    // Сочетание взято оттуда же, чтобы рука попадала.
    ("alt+0", "view.fold-all"),
    ("alt+shift+0", "view.unfold-all"),
    ("ctrl+alt+f", "view.fold"),
    ("ctrl+alt+shift+f", "view.unfold"),
    // В Notepad++ переход к парной скобке висит на Ctrl+B, но у нас это
    // боковая панель по решению Р-053 — сочетание из VS Code, взятое потому,
    // что папки как проекта в Notepad++ нет вовсе. Двигать его теперь дороже,
    // чем найти скобкам соседнее свободное.
    ("ctrl+alt+b", "view.go-to-bracket"),
    // И то же самое сочетанием VS Code. Записать его стало можно только
    // в задаче 41: до неё в сочетании не выражался ни один знак препинания,
    // кроме запятой.
    ("ctrl+shift+backslash", "view.go-to-bracket"),
    // Закладки — сочетания Notepad++. В VS Code закладок нет вовсе, брать
    // оттуда нечего, и Р-114 здесь молчит.
    ("ctrl+f2", "view.bookmark"),
    ("f2", "view.bookmark-next"),
    ("shift+f2", "view.bookmark-previous"),
    ("ctrl+g", "view.go-to-line"),
    ("ctrl+tab", "view.next-tab"),
    ("ctrl+shift+tab", "view.previous-tab"),
    // Перенос строк — сочетание VS Code (Р-114). До задачи 36 команда была
    // в реестре без сочетания вовсе.
    ("alt+z", "edit.toggle-wrap"),
    // Двух сочетаний из Notepad++ здесь нет и быть не может: папки как проекта
    // в нём тоже нет. Взяты привычные по VS Code — решение Р-053.
    ("ctrl+b", "view.sidebar"),
    ("ctrl+shift+o", "project.add-root"),
    // Ctrl+P в Notepad++ — печать, которой у нас нет и в первом круге
    // не будет. Ctrl+Shift+F там же — «найти в файлах», то есть ровно
    // тот же смысл, что и у нас.
    ("ctrl+p", "project.quick-open"),
    ("ctrl+shift+p", "project.commands"),
    ("ctrl+comma", "view.settings"),
    ("ctrl+shift+f", "project.search"),
    // F12 — «перейти к определению» в привычке любого, кто пользовался
    // средой разработки. Ссылка между заметками — то же самое движение.
    ("f12", "project.follow-link"),
    ("ctrl+shift+b", "project.backlinks"),
];

/// Именованные клавиши, которые разрешено использовать в сочетаниях.
///
/// Буквы и цифры сюда не входят: они распознаются отдельно и всегда состоят
/// из одного знака.
///
/// Знаки препинания названы по положению клавиши, а не по нанесённому знаку
/// (`slash`, а не `/`): раскладка у пользователя может быть любая, а сочетание
/// обязано от неё не зависеть — то же правило, что и для букв. До задачи 41
/// здесь была одна `comma`, и оттого сочетания вроде `Ctrl+/` нельзя было
/// ни назначить, ни отнять: разбор нажатия их попросту не видел.
const NAMED_KEYS: &[&str] = &[
    "enter", "tab", "escape", "space", "backspace", "delete", "insert", "home", "end", "pageup",
    "pagedown", "left", "right", "up", "down", "comma", "period", "slash", "backslash",
    "bracketleft", "bracketright", "semicolon", "quote", "backquote", "minus", "equal", "f1", "f2",
    "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeymapError {
    Parse(String),
    UnsupportedSchema { found: u32 },
    UnknownCommand { binding: String, command: String },
    BadBinding { binding: String },
}

impl std::fmt::Display for KeymapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeymapError::Parse(message) => {
                write!(f, "не удалось разобрать keymap.toml: {message}")
            }
            KeymapError::UnsupportedSchema { found } => write!(
                f,
                "версия формата раскладки {found} не поддерживается, ожидается {KEYMAP_SCHEMA}"
            ),
            KeymapError::UnknownCommand { binding, command } => write!(
                f,
                "сочетание {binding}: неизвестная команда «{command}»"
            ),
            KeymapError::BadBinding { binding } => {
                write!(f, "не удалось разобрать сочетание «{binding}»")
            }
        }
    }
}

impl std::error::Error for KeymapError {}

pub const KEYMAP_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeymapFile {
    pub schema: u32,
    /// Сочетание → команда. Пустая строка снимает сочетание, назначенное
    /// по умолчанию: без этого от ненужной привязки нельзя было бы избавиться.
    #[serde(default)]
    pub bindings: BTreeMap<String, String>,
}

/// Привести сочетание к единому виду: `ctrl+alt+shift+клавиша`.
///
/// Возвращает `None`, если разобрать не удалось. Порядок частей в исходной
/// строке значения не имеет, регистр тоже.
pub fn normalize(binding: &str) -> Option<String> {
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut key: Option<String> = None;

    for part in binding.split('+') {
        let part = part.trim().to_lowercase();
        if part.is_empty() {
            return None;
        }

        match part.as_str() {
            "ctrl" | "control" => ctrl = true,
            "alt" => alt = true,
            "shift" => shift = true,
            other => {
                // Двух клавиш в одном сочетании не бывает: скорее всего опечатка.
                if key.is_some() {
                    return None;
                }
                let named = NAMED_KEYS.contains(&other);
                let single = other.chars().count() == 1
                    && other.chars().all(|c| c.is_ascii_alphanumeric());

                if !named && !single {
                    return None;
                }
                key = Some(other.to_owned());
            }
        }
    }

    let key = key?;

    let mut out = String::new();
    if ctrl {
        out.push_str("ctrl+");
    }
    if alt {
        out.push_str("alt+");
    }
    if shift {
        out.push_str("shift+");
    }
    out.push_str(&key);
    Some(out)
}

fn known_commands() -> Vec<&'static str> {
    COMMANDS.iter().map(|(id, _)| *id).collect()
}

pub fn parse(source: &str) -> Result<KeymapFile, KeymapError> {
    let file: KeymapFile =
        toml::from_str(source).map_err(|e| KeymapError::Parse(e.message().to_owned()))?;

    if file.schema != KEYMAP_SCHEMA {
        return Err(KeymapError::UnsupportedSchema {
            found: file.schema,
        });
    }

    Ok(file)
}

/// Итоговая раскладка: умолчания плюс правки пользователя.
pub fn resolve(user: Option<&KeymapFile>) -> Result<BTreeMap<String, String>, KeymapError> {
    let known = known_commands();
    let mut result: BTreeMap<String, String> = BTreeMap::new();

    for (binding, command) in DEFAULTS {
        let normalized = normalize(binding).expect("умолчания обязаны разбираться");
        result.insert(normalized, (*command).to_owned());
    }

    let Some(user) = user else {
        return Ok(result);
    };

    for (binding, command) in &user.bindings {
        let Some(normalized) = normalize(binding) else {
            return Err(KeymapError::BadBinding {
                binding: binding.clone(),
            });
        };

        // Пустая команда снимает сочетание.
        if command.is_empty() {
            result.remove(&normalized);
            continue;
        }

        if !known.contains(&command.as_str()) {
            return Err(KeymapError::UnknownCommand {
                binding: normalized,
                command: command.clone(),
            });
        }

        result.insert(normalized, command.clone());
    }

    Ok(result)
}

/// Образец файла раскладки, который кладётся при первом запуске.
///
/// Записывается дословно вместе с комментариями: сериализация через serde
/// их не переживает, а для файла, который правят руками, они и есть польза.
pub const DEFAULT_TEMPLATE: &str = r#"# Горячие клавиши ZeroNote.
#
# По умолчанию действует раскладка ZeroNote: основа взята у Notepad++,
# часть сочетаний — у VS Code. Здесь задаются только отличия: всё, что
# не упомянуто, остаётся как было. Приложение подхватывает изменения
# на лету, перезапуск не нужен.
#
# Формат: "сочетание" = "команда"
# Порядок частей и регистр не важны: "Shift+Ctrl+D" и "ctrl+shift+d" — одно
# и то же. Пустая команда снимает сочетание.
#
# Пример:
#   [bindings]
#   "ctrl+shift+d" = "edit.duplicate-line"   # добавить своё
#   "ctrl+l" = ""                            # снять стандартное
#
# Список команд — в DESIGN.md, раздел «Горячие клавиши».

schema = 1

[bindings]
"#;

#[cfg(test)]
mod tests {
    use super::*;

    /// Умолчания обязаны разбираться и ссылаться на существующие команды:
    /// иначе приложение стартует с нерабочей раскладкой.
    #[test]
    fn defaults_are_valid() {
        let known = known_commands();
        for (binding, command) in DEFAULTS {
            assert!(
                normalize(binding).is_some(),
                "не разбирается сочетание по умолчанию: {binding}"
            );
            assert!(
                known.contains(command),
                "умолчание ссылается на несуществующую команду: {command}"
            );
        }
    }

    /// Одно сочетание не должно быть занято дважды: вторая привязка молча
    /// перекрыла бы первую.
    #[test]
    fn defaults_do_not_collide() {
        let mut seen = std::collections::BTreeSet::new();
        for (binding, _) in DEFAULTS {
            let normalized = normalize(binding).unwrap();
            assert!(seen.insert(normalized.clone()), "занято дважды: {normalized}");
        }
    }

    /// Порядок частей и регистр не должны создавать разные сочетания.
    #[test]
    fn normalization_ignores_order_and_case() {
        let expected = Some("ctrl+alt+shift+d".to_owned());
        assert_eq!(normalize("ctrl+alt+shift+d"), expected);
        assert_eq!(normalize("Shift+Alt+Ctrl+D"), expected);
        assert_eq!(normalize("  CTRL + SHIFT + ALT + D  "), expected);
        assert_eq!(normalize("Control+Alt+Shift+d"), expected);
    }

    #[test]
    fn named_keys_are_accepted() {
        assert_eq!(normalize("ctrl+g"), Some("ctrl+g".to_owned()));
        assert_eq!(normalize("F5"), Some("f5".to_owned()));
        assert_eq!(
            normalize("ctrl+shift+Up"),
            Some("ctrl+shift+up".to_owned())
        );
        assert_eq!(normalize("alt+PageDown"), Some("alt+pagedown".to_owned()));
    }

    /// Мусор должен отвергаться, а не превращаться в сочетание, которое
    /// никогда не сработает.
    #[test]
    fn garbage_is_rejected() {
        assert_eq!(normalize(""), None);
        assert_eq!(normalize("ctrl+"), None);
        assert_eq!(normalize("ctrl"), None, "одни модификаторы — не сочетание");
        assert_eq!(normalize("ctrl+ддд"), None);
        assert_eq!(normalize("ctrl+a+b"), None, "двух клавиш не бывает");
    }

    #[test]
    fn user_binding_overrides_default() {
        let file = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+d" = "edit.delete-line"
        "#,
        )
        .unwrap();

        let map = resolve(Some(&file)).unwrap();
        assert_eq!(map["ctrl+d"], "edit.delete-line");
        // Остальное не тронуто.
        assert_eq!(map["ctrl+s"], "file.save");
    }

    /// Снять стандартное сочетание должно быть можно: иначе от мешающей
    /// привязки не избавиться.
    #[test]
    fn empty_command_unbinds() {
        let file = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+l" = ""
        "#,
        )
        .unwrap();

        let map = resolve(Some(&file)).unwrap();
        assert!(!map.contains_key("ctrl+l"));
    }

    /// Опечатка в имени команды называется по имени, а не игнорируется.
    #[test]
    fn unknown_command_is_reported() {
        let file = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+d" = "edit.duplicate-lines"
        "#,
        )
        .unwrap();

        let error = resolve(Some(&file)).expect_err("должна быть ошибка");
        let message = error.to_string();
        assert!(
            message.contains("edit.duplicate-lines"),
            "сообщение должно называть команду: {message}"
        );
    }

    #[test]
    fn bad_binding_is_reported() {
        let file = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+нет" = "file.save"
        "#,
        )
        .unwrap();

        assert!(matches!(
            resolve(Some(&file)),
            Err(KeymapError::BadBinding { .. })
        ));
    }

    /// Образец должен разбираться и не менять раскладку по умолчанию.
    #[test]
    fn template_parses_and_changes_nothing() {
        let file = parse(DEFAULT_TEMPLATE).expect("образец должен разбираться");
        assert_eq!(resolve(Some(&file)).unwrap(), resolve(None).unwrap());
    }

    #[test]
    fn future_schema_is_rejected() {
        assert_eq!(
            parse("schema = 77"),
            Err(KeymapError::UnsupportedSchema { found: 77 })
        );
    }
}
