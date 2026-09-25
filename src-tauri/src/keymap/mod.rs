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
    // Привычка из браузера (задача 86). Возвращается вкладка с файлом:
    // безымянному буферу возвращать нечего — черновик удалён, а на вопрос
    // про несохранённое человек уже ответил (Р-219).
    ("file.reopen-tab", "Вернуть закрытую вкладку"),
    // Печать (задача 109): заметка — как её показывает превью, код —
    // с раскраской и переносом, картинка — по размеру страницы. Сочетания
    // нет: `Ctrl+P` — быстрое открытие, как в VS Code (Р-127).
    ("file.print", "Печать…"),
    // Экспорт в HTML (задача 110): один файл со стилем и картинками внутри,
    // для чужих глаз. Сочетания нет — команду жмут не каждый день (Р-127).
    ("file.export-html", "Экспорт в HTML…"),
    // Экспорт в PDF одной командой (задача 111): лист A4, свои колонтитулы —
    // имя файла и номер страницы, без адреса страницы приложения.
    ("file.export-pdf", "Экспорт в PDF…"),
    ("edit.undo", "Отменить"),
    ("edit.redo", "Повторить"),
    // Буфер обмена. Сочетания за ними записаны, но нажатие перехватывает
    // не приложение, а вебвью — он делает это правильно (Р-108). Команды
    // нужны меню и палитре: пункт меню нажатием клавиши не является.
    ("edit.cut", "Вырезать"),
    ("edit.copy", "Копировать"),
    // Копировать с оформлением (задача 112): в буфер HTML и текст — для
    // почты и Word. Сочетания нет: `Ctrl+C` остаётся за вебвью и копирует
    // исходник (Р-108, Р-160).
    ("edit.copy-rich", "Копировать с оформлением"),
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
    ("view.live-preview", "Живое превью markdown"),
    ("view.fold", "Свернуть блок"),
    ("view.unfold", "Развернуть блок"),
    ("view.fold-all", "Свернуть всё"),
    ("view.unfold-all", "Развернуть всё"),
    ("view.go-to-bracket", "Перейти к парной скобке"),
    ("view.go-to-line", "Перейти к строке"),
    ("view.next-tab", "Следующая вкладка"),
    ("view.previous-tab", "Предыдущая вкладка"),
    // История мест курсора (задача 85). «Место» — вкладка, область
    // и строка; записывается при смене вкладки и при дальнем прыжке внутри
    // файла. Названия говорят «по местам», а не «назад»: назад по чему —
    // первый вопрос, который задаёт человек, читая палитру.
    ("view.back", "Назад по местам"),
    ("view.forward", "Вперёд по местам"),
    // Области редактора (этап 11). Текущая вкладка получает зеркало в новой
    // области — как в VS Code (Р-209, Р-210). У «вниз» сочетания нет:
    // в VS Code оно аккордом, а аккордов у нас не будет (Р-123).
    ("view.split-right", "Разделить область вправо"),
    ("view.split-down", "Разделить область вниз"),
    // Область по номеру — порядок обхода дерева слева направо и сверху
    // вниз, как нумерует VS Code. Девять команд, а не одна с аргументом:
    // у сочетания нет аргумента, и у пункта палитры тоже.
    ("view.pane-1", "Область 1"),
    ("view.pane-2", "Область 2"),
    ("view.pane-3", "Область 3"),
    ("view.pane-4", "Область 4"),
    ("view.pane-5", "Область 5"),
    ("view.pane-6", "Область 6"),
    ("view.pane-7", "Область 7"),
    ("view.pane-8", "Область 8"),
    ("view.pane-9", "Область 9"),
    ("view.move-tab-next-pane", "Перенести вкладку в следующую область"),
    ("view.move-tab-previous-pane", "Перенести вкладку в предыдущую область"),
    ("view.close-pane", "Закрыть область"),
    ("view.sidebar", "Показать боковую панель"),
    // Сочетания нет: в VS Code и Obsidian у оглавления его тоже нет,
    // а место в раскладке дорого. Назначить можно во вкладке «Клавиши».
    ("view.outline", "Оглавление документа"),
    // Отличается от «Палитры тегов» тем, что отвечает на другой вопрос:
    // палитра ищет тег, который знаешь, панель показывает все, какие есть.
    ("view.tags", "Панель тегов"),
    // Список отдельно от меток у номеров строк: метки показывают, где
    // закладка в открытом файле, список — что на этих строках написано
    // и какие закладки в соседних вкладках (Р-157).
    ("view.bookmarks", "Панель закладок"),
    ("view.settings", "Параметры"),
    ("project.add-root", "Открыть папку"),
    ("project.quick-open", "Быстрое открытие по имени"),
    ("project.commands", "Палитра команд"),
    ("project.tags", "Палитра тегов"),
    ("project.search", "Найти в проекте"),
    // Сочетания у обеих нет по умолчанию (Р-127): `Ctrl+H` занят заменой
    // в файле, а замену по проекту делают не каждый день. Назначить можно
    // во вкладке «Клавиши».
    ("project.replace", "Заменить в проекте"),
    // Заметка на сегодня (задача 90). Сочетания нет: в Obsidian у неё его
    // тоже нет по умолчанию, а свободных сочетаний в раскладке Notepad++
    // почти не осталось. Назначить можно во вкладке «Клавиши».
    ("project.daily-note", "Заметка на сегодня"),
    ("view.notes", "Панель заметок"),
    ("notes.insert-template", "Вставить шаблон"),
    ("notes.new-from-template", "Новая заметка из шаблона"),
    ("project.undo-replace", "Отменить замену в проекте"),
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
    // В markdown подчёркивания нет, и Obsidian пишет его тегом `<u>` —
    // так же делаем и мы: файл обязан читаться там одинаково (задача 102).
    ("md.underline", "Подчёркнутый"),
    ("md.highlight", "Выделение цветом"),
    ("md.code", "Код в строке"),
    ("md.link", "Ссылка"),
    ("md.wikilink", "Ссылка на заметку"),
    ("md.image", "Картинка"),
    ("md.heading-1", "Заголовок 1"),
    ("md.heading-2", "Заголовок 2"),
    ("md.heading-3", "Заголовок 3"),
    ("md.heading-4", "Заголовок 4"),
    ("md.heading-5", "Заголовок 5"),
    ("md.heading-6", "Заголовок 6"),
    ("md.bullet-list", "Маркированный список"),
    ("md.ordered-list", "Нумерованный список"),
    ("md.task-list", "Список задач"),
    ("md.quote", "Цитата"),
    // Заготовки. Подпись начинается с «Заготовка», чтобы все три находились
    // в палитре одним словом.
    ("md.table", "Заготовка: таблица"),
    ("md.code-block", "Заготовка: блок кода"),
    ("md.divider", "Заготовка: разделитель"),
    ("md.mermaid", "Заготовка: схема mermaid"),
    // Список коллаутов у курсора (задача 103). Сам список — файл
    // `callouts.toml`, и у каждого коллаута своей команды нет: реестр
    // канонический, строки из файла человека в него не попадают.
    ("md.callout", "Коллаут…"),
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
    // Сочетание VS Code (решение владельца, Р-210). `Ctrl+Shift+\` занято
    // переходом к парной скобке ещё с раскладки Notepad++.
    ("ctrl+backslash", "view.split-right"),
    ("ctrl+1", "view.pane-1"),
    ("ctrl+2", "view.pane-2"),
    ("ctrl+3", "view.pane-3"),
    ("ctrl+4", "view.pane-4"),
    ("ctrl+5", "view.pane-5"),
    ("ctrl+6", "view.pane-6"),
    ("ctrl+7", "view.pane-7"),
    ("ctrl+8", "view.pane-8"),
    ("ctrl+9", "view.pane-9"),
    // Как в VS Code. На некоторых драйверах Intel `Ctrl+Alt+стрелка`
    // поворачивает экран; VS Code это не остановило, а у нас переназначаемо.
    ("ctrl+alt+right", "view.move-tab-next-pane"),
    ("ctrl+alt+left", "view.move-tab-previous-pane"),
    // Как в VS Code и в браузере: стрелка с Alt — это «назад».
    // `Ctrl+Alt+стрелка` рядом занята переносом вкладки между областями,
    // и спутать их трудно: у одной под пальцем два модификатора, у другой
    // один.
    ("ctrl+shift+t", "file.reopen-tab"),
    ("alt+left", "view.back"),
    ("alt+right", "view.forward"),
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

/// Файл раскладки нельзя прочитать вовсе.
///
/// Только два случая, как у настроек (Р-248): сломан сам TOML или версия
/// формата чужая. Опечатка в команде или в сочетании — не ошибка файла,
/// а строка в `Loaded::problems`: до задачи 114 одна такая строка
/// отвергала раскладку целиком, и каждая новая команда ломала откат.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeymapError {
    Parse(String),
    UnsupportedSchema { found: u32 },
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
        }
    }
}

impl std::error::Error for KeymapError {}

pub const KEYMAP_SCHEMA: u32 = 1;

/// Прочитанная раскладка и то, что из файла применить не удалось.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Loaded {
    /// Итог: умолчания плюс правки из файла. Сочетание в приведённом
    /// виде → команда.
    pub bindings: BTreeMap<String, String>,
    /// По строке на каждую непринятую запись. Имени файла в строке нет:
    /// его добавляет тот, кто показывает, — как у настроек.
    pub problems: Vec<String>,
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

/// Раскладка без файла пользователя.
pub fn defaults() -> BTreeMap<String, String> {
    DEFAULTS
        .iter()
        .map(|(binding, command)| {
            let normalized = normalize(binding).expect("умолчания обязаны разбираться");
            (normalized, (*command).to_owned())
        })
        .collect()
}

/// Разбор файла раскладки: умолчания плюс то, что в файле годно.
///
/// Правило то же, что у настроек (Р-248): **всё незнакомое называется, всё
/// знакомое применяется**. Строка с незнакомой командой, неразборчивым
/// сочетанием или не строкой вместо команды пропускается со словом о ней,
/// и на её месте действует умолчание; остальные строки работают. Ошибка —
/// только когда из файла нечего взять: сломан TOML или версия чужая.
///
/// Разбор идёт по таблице TOML, а не в структуру через serde: serde
/// отверг бы файл целиком на первом же значении не того вида.
pub fn parse(source: &str) -> Result<Loaded, KeymapError> {
    let mut root: toml::Table =
        toml::from_str(source).map_err(|e| KeymapError::Parse(e.message().to_owned()))?;

    // Версия формата решает, как читать остальное, — к ней терпимости нет.
    // Её отсутствие — не ошибка: как и в настройках, это текущая версия.
    let schema = match root.remove("schema") {
        None => KEYMAP_SCHEMA,
        Some(toml::Value::Integer(n)) => u32::try_from(n).map_err(|_| {
            KeymapError::Parse(format!("schema = {n} — версия формата не бывает такой"))
        })?,
        Some(other) => {
            return Err(KeymapError::Parse(format!(
                "schema должна быть числом, а в файле {}",
                other.type_str()
            )));
        }
    };
    if schema != KEYMAP_SCHEMA {
        return Err(KeymapError::UnsupportedSchema { found: schema });
    }

    let known = known_commands();
    let mut problems = Vec::new();
    let mut bindings = defaults();

    let table = match root.remove("bindings") {
        None => toml::Table::new(),
        Some(toml::Value::Table(table)) => table,
        Some(other) => {
            problems.push(format!(
                "bindings должен быть разделом, а в файле {} — действует раскладка по умолчанию",
                other.type_str()
            ));
            toml::Table::new()
        }
    };

    // Какая строка файла уже задала это сочетание. Одно сочетание можно
    // записать по-разному — `Ctrl+D` и `ctrl+d`, — и тогда какая из строк
    // действует, решает порядок ключей в таблице, а не человек. Молчать
    // об этом значило бы оставить его гадать, почему правка не работает.
    let mut written: BTreeMap<String, String> = BTreeMap::new();

    for (binding, command) in table {
        let toml::Value::String(command) = command else {
            problems.push(format!(
                "сочетание «{binding}»: команда пишется строкой, а в файле {} — строка пропущена",
                command.type_str()
            ));
            continue;
        };
        let Some(normalized) = normalize(&binding) else {
            problems.push(format!("сочетание «{binding}» не разбирается — строка пропущена"));
            continue;
        };
        // Пустая команда — не опечатка, а снятие умолчания.
        if !command.is_empty() && !known.contains(&command.as_str()) {
            problems.push(format!(
                "сочетание «{binding}»: команды «{command}» нет — строка пропущена"
            ));
            continue;
        }

        if let Some(earlier) = written.insert(normalized.clone(), binding.clone()) {
            problems.push(format!(
                "сочетание {normalized} записано дважды, «{earlier}» и «{binding}» — действует «{binding}»"
            ));
        }

        if command.is_empty() {
            bindings.remove(&normalized);
        } else {
            bindings.insert(normalized, command);
        }
    }

    // Что осталось — не наше. Раздел из будущей версии и опечатка
    // (`[bindigns]`) выглядят одинаково, и оба случая заслуживают слова.
    for (key, value) in root {
        if value.is_table() {
            problems.push(format!("раздел [{key}] незнаком — пропущен"));
        } else {
            problems.push(format!("ключ «{key}» незнаком — пропущен"));
        }
    }

    Ok(Loaded { bindings, problems })
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
        let loaded = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+d" = "edit.delete-line"
        "#,
        )
        .unwrap();

        assert_eq!(loaded.bindings["ctrl+d"], "edit.delete-line");
        // Остальное не тронуто.
        assert_eq!(loaded.bindings["ctrl+s"], "file.save");
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
    }

    /// Снять стандартное сочетание должно быть можно: иначе от мешающей
    /// привязки не избавиться.
    #[test]
    fn empty_command_unbinds() {
        let loaded = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+l" = ""
        "#,
        )
        .unwrap();

        assert!(!loaded.bindings.contains_key("ctrl+l"));
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
    }

    /// Главное требование задачи 114 (Р-248 для раскладки): опечатка
    /// в одной строке называется по имени, а остальные строки работают.
    /// До неё эта же строка отвергала файл целиком, и своё сочетание
    /// `Ctrl+Alt+Q` пропадало вместе с опечаткой.
    #[test]
    fn unknown_command_is_named_and_the_rest_applies() {
        let loaded = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+d" = "edit.duplicate-lines"
            "ctrl+alt+q" = "file.save"
        "#,
        )
        .unwrap();

        // Опечатка пропущена — на её месте умолчание.
        assert_eq!(loaded.bindings["ctrl+d"], "edit.add-cursor-next");
        // Соседняя строка действует.
        assert_eq!(loaded.bindings["ctrl+alt+q"], "file.save");
        assert_eq!(loaded.problems.len(), 1, "{:?}", loaded.problems);
        assert!(
            loaded.problems[0].contains("edit.duplicate-lines"),
            "жалоба должна называть команду: {:?}",
            loaded.problems
        );
    }

    /// Откат на прошлую версию: файл, где назначена команда, которой в ней
    /// ещё нет. Так выглядела бы раскладка 0.16.0, прочитанная 0.15.0, —
    /// приёмка этапа 16 нашла, что строгая версия отвергает её целиком.
    #[test]
    fn a_command_from_a_newer_version_does_not_break_the_file() {
        let loaded = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+alt+e" = "file.export-to-the-future"
            "ctrl+shift+d" = "edit.delete-line"
            "ctrl+l" = ""
        "#,
        )
        .unwrap();

        assert_eq!(loaded.bindings["ctrl+shift+d"], "edit.delete-line");
        assert!(!loaded.bindings.contains_key("ctrl+l"));
        assert!(!loaded.bindings.contains_key("ctrl+alt+e"));
        assert_eq!(loaded.problems.len(), 1, "{:?}", loaded.problems);
    }

    #[test]
    fn bad_binding_is_named_and_skipped() {
        let loaded = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+нет" = "file.save"
            "ctrl+alt+q" = "file.open"
        "#,
        )
        .unwrap();

        assert_eq!(loaded.bindings["ctrl+alt+q"], "file.open");
        // Команда, чью строку пропустили, осталась на своём умолчании.
        assert_eq!(loaded.bindings["ctrl+s"], "file.save");
        assert_eq!(loaded.problems.len(), 1, "{:?}", loaded.problems);
        assert!(loaded.problems[0].contains("ctrl+нет"), "{:?}", loaded.problems);
    }

    /// Значение не того вида — строка, а не весь файл: serde отверг бы
    /// раскладку на первом же числе.
    #[test]
    fn a_value_that_is_not_a_string_is_named_and_skipped() {
        let loaded = parse(
            r#"
            schema = 1
            [bindings]
            "ctrl+d" = 5
            "ctrl+alt+q" = "file.save"
        "#,
        )
        .unwrap();

        assert_eq!(loaded.bindings["ctrl+d"], "edit.add-cursor-next");
        assert_eq!(loaded.bindings["ctrl+alt+q"], "file.save");
        assert_eq!(loaded.problems.len(), 1, "{:?}", loaded.problems);
        assert!(loaded.problems[0].contains("integer"), "{:?}", loaded.problems);
    }

    #[test]
    fn bindings_that_are_not_a_table_leave_the_defaults() {
        let loaded = parse("schema = 1\nbindings = 5\n").unwrap();

        assert_eq!(loaded.bindings, defaults());
        assert_eq!(loaded.problems.len(), 1, "{:?}", loaded.problems);
    }

    /// Раздел из будущей версии и опечатка в имени раздела выглядят
    /// одинаково — называются оба, как у настроек.
    #[test]
    fn unknown_keys_and_sections_are_named() {
        let loaded = parse(
            r#"
            schema = 1
            chords = true
            [bindigns]
            "ctrl+alt+q" = "file.save"
            [bindings]
            "ctrl+alt+w" = "file.open"
        "#,
        )
        .unwrap();

        assert_eq!(loaded.bindings["ctrl+alt+w"], "file.open");
        assert!(!loaded.bindings.contains_key("ctrl+alt+q"));
        assert_eq!(loaded.problems.len(), 2, "{:?}", loaded.problems);
        assert!(loaded.problems.iter().any(|p| p.contains("[bindigns]")), "{:?}", loaded.problems);
        assert!(loaded.problems.iter().any(|p| p.contains("chords")), "{:?}", loaded.problems);
    }

    /// Одно сочетание двумя строками: какая действует, решает порядок
    /// ключей, а не человек, — значит, об этом надо сказать.
    #[test]
    fn a_binding_written_twice_is_named() {
        let loaded = parse(
            r#"
            schema = 1
            [bindings]
            "Ctrl+Alt+Q" = "file.open"
            "ctrl+alt+q" = "file.save"
        "#,
        )
        .unwrap();

        assert_eq!(loaded.problems.len(), 1, "{:?}", loaded.problems);
        let problem = &loaded.problems[0];
        assert!(problem.contains("записано дважды"), "{problem}");
        // Жалоба называет ту строку, что действует, — и это правда.
        let acting = &loaded.bindings["ctrl+alt+q"];
        let line = if acting == "file.save" { "«ctrl+alt+q»" } else { "«Ctrl+Alt+Q»" };
        assert!(problem.ends_with(&format!("действует {line}")), "{problem} / {acting}");
    }

    /// Образец должен разбираться и не менять раскладку по умолчанию.
    #[test]
    fn template_parses_and_changes_nothing() {
        let loaded = parse(DEFAULT_TEMPLATE).expect("образец должен разбираться");
        assert_eq!(loaded.bindings, defaults());
        assert!(loaded.problems.is_empty(), "{:?}", loaded.problems);
    }

    /// Файл без версии — текущая версия, как у настроек. Сломанный TOML
    /// и чужая версия — единственное, что отвергает файл целиком.
    #[test]
    fn only_broken_toml_and_a_foreign_schema_reject_the_file() {
        assert!(parse("[bindings]\n\"ctrl+alt+q\" = \"file.save\"\n").is_ok());
        assert_eq!(parse("schema = 77"), Err(KeymapError::UnsupportedSchema { found: 77 }));
        assert!(matches!(parse("schema = \"один\""), Err(KeymapError::Parse(_))));
        assert!(matches!(parse("= = ="), Err(KeymapError::Parse(_))));
    }
}
