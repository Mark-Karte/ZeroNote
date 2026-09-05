//! Канонический список токенов оформления и значения по умолчанию.
//!
//! Это единственный источник истины о том, какие токены существуют. Фронтенд
//! объявляет их в `src/theme/tokens.css`, и тест `tests/tokens.test.ts` следит,
//! чтобы наборы имён совпадали. Расхождение — ошибка сборки, а не сюрприз
//! в рантайме.
//!
//! Два уровня токенов, и это принципиально:
//!
//! 1. **Палитра** — сырые цвета (`gray-0`, `accent`). Их задаёт тема, и только
//!    тема. В CSS они не попадают вовсе.
//! 2. **Семантические роли** — `color-bg-canvas`, `color-fg-muted`. Только их
//!    видят компоненты. Компонент не знает, какой именно серый ему достался.
//!
//! Ради этого разделения тема на практике сводится к десятку строк палитры:
//! семантические выражения общие для светлой и тёмной и живут здесь.

/// Токены, не зависящие ни от темы, ни от плотности.
pub const BASE: &[(&str, &str)] = &[
    // Шрифты. Вшитые семьи стоят первыми, системные — запасными на случай,
    // если файл шрифта почему-то не загрузился (Р-075, Р-081).
    (
        "font-family-ui",
        "'IBM Plex Sans', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    ),
    (
        "font-family-editor",
        "'JetBrains Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace",
    ),
    ("font-size-editor", "14px"),
    ("font-line-height-editor", "1.5"),
    // Заголовки markdown в исходнике. Доля, а не пиксели: размер шрифта
    // редактора настраивается, и заголовок обязан ехать за ним. Ниже
    // третьего уровня размер не растёт — там уже хватает веса (задача 57).
    ("font-size-editor-heading-1", "1.5em"),
    ("font-size-editor-heading-2", "1.28em"),
    ("font-size-editor-heading-3", "1.12em"),
    ("font-weight-normal", "400"),
    // Три начертания вместо двух: 500 для тихого выделения (имя корня,
    // активная вкладка), 600 для заголовков и надзаголовков. Пока шрифт был
    // системным, разница между ними была почти незаметна, и `medium` означал
    // 600. Со вшитым Plex различие видно, и имя должно означать вес.
    ("font-weight-medium", "500"),
    ("font-weight-strong", "600"),
    // Разрядка для набранных прописными подписей: без неё они читаются хуже.
    ("font-letter-spacing-caps", "0.09em"),
    // Крупные заголовки набираются плотнее: на большом кегле обычная разрядка
    // выглядит рыхлой.
    ("font-letter-spacing-tight", "-0.02em"),
    // Скругления. От мелких пометок до рамки окна.
    ("radius-sm", "4px"),
    ("radius-md", "6px"),
    ("radius-lg", "8px"),
    ("radius-xl", "10px"),
    ("radius-window", "14px"),
    // Границы.
    ("border-width", "1px"),
    ("border-width-thick", "2px"),
    // Тени. Геометрия общая, цвет — из палитры темы: тёмной теме нужна заметно
    // более плотная тень, и раньше каждая тема переписывала строку целиком.
    // Теперь тема задаёт два цвета, а четыре тени получаются сами.
    ("shadow-raised", "0 1px 2px {palette.shadow-weak}"),
    ("shadow-overlay", "0 18px 44px -16px {palette.shadow-strong}"),
    ("shadow-dialog", "0 32px 80px -20px {palette.shadow-strong}"),
    (
        "shadow-window",
        "0 24px 60px -20px {palette.shadow-strong}, 0 2px 6px {palette.shadow-weak}",
    ),
    // Движение. «Базовые переходы» — всё, что разрешено первым кругом.
    ("motion-duration-fast", "90ms"),
    ("motion-duration-normal", "160ms"),
    ("motion-easing", "cubic-bezier(0.2, 0, 0, 1)"),
    // Слои. Числа, а не «магические» z-index по месту.
    ("z-panel", "10"),
    ("z-overlay", "100"),
    ("z-dialog", "1000"),
];

/// Метрики обычной плотности.
pub const METRICS_NORMAL: &[(&str, &str)] = &[
    ("space-1", "2px"),
    ("space-2", "4px"),
    ("space-3", "8px"),
    ("space-4", "12px"),
    ("space-5", "16px"),
    ("space-6", "24px"),
    ("font-size-ui", "13px"),
    ("font-size-ui-small", "11px"),
    ("font-size-title", "22px"),
    ("font-line-height-ui", "1.4"),
    ("control-statusbar-height", "28px"),
    ("control-titlebar-height", "46px"),
    ("control-tab-height", "38px"),
    ("control-tab-min-width", "110px"),
    ("control-tab-max-width", "220px"),
    ("control-window-button-width", "46px"),
    ("control-toolbar-height", "36px"),
    // Кнопка панели инструментов — своя роль, а не плитка боковой полосы.
    // До задачи 56 панель разметки брала размер у навигационной плитки
    // (38 px) и от этого была выше любой другой полосы в окне. Размер —
    // роль, а не число (Р-096), и ролей у кнопки оказалось две.
    ("control-toolbar-button-size", "28px"),
    ("control-row-height", "26px"),
    // Высота полей ввода и кнопок. Отдельно от строки списка: поле выше её.
    ("control-field-height", "28px"),
    // Размер значка — роль, а не одно число (Р-096). Значок берёт размер
    // из контекста так же, как берёт цвет: `control-icon-size` — умолчание,
    // то есть строка списка, а контекст с другой ролью переопределяет его
    // у себя одной строкой.
    ("control-icon-size", "16px"),
    // Глиф кнопки окна рисуется в поле 10×10, как в Windows. Крупнее он
    // выглядит чужеродно рядом с системными окнами — с этого и началась
    // задача 26.
    ("control-icon-size-window", "10px"),
    // Значок в квадратной плитке `control-strip-button-size`: боковая полоса
    // и карточка в параметрах. Роль названа по форме, а не по месту, потому
    // что аудит задачи 26 нашёл два таких места, а не одно.
    ("control-icon-size-tile", "20px"),
    // Знак приложения в шапке и он же крупно на стартовом экране.
    ("control-icon-size-mark", "20px"),
    ("control-icon-size-mark-large", "32px"),
    ("control-dialog-min-width", "420px"),
    ("control-dialog-max-width", "560px"),
    ("control-popup-min-width", "260px"),
    ("control-search-width", "300px"),
    // Ширина текстовой полосы на экранах вроде параметров: строка длиннее
    // читается хуже, сколько бы места ни было.
    ("control-page-width", "660px"),
    // Ширина текстовой колонки в редакторе: markdown по центру окна
    // (задача 58). В знаках, а не в пикселях, — мера читаемости
    // измеряется знаками в строке, и при другом кегле шрифта колонка
    // обязана меняться вместе с ним.
    ("control-editor-width", "82ch"),
    ("control-sidebar-width", "240px"),
    ("control-sidebar-min-width", "160px"),
    ("control-sidebar-max-width", "640px"),
    ("control-tree-indent", "16px"),
    // Отдельно от `control-row-height`: строка дерева плотнее прочих списков,
    // и подгонка одного не должна двигать другое.
    ("control-tree-row-height", "22px"),
    ("control-strip-width", "50px"),
    ("control-strip-button-size", "38px"),
];

/// Метрики компактной плотности.
///
/// Набор ключей обязан совпадать с `METRICS_NORMAL` — это проверяет тест.
/// Плотность реализована подменой значений, а не ветвлением в CSS: иначе
/// каждый компонент пришлось бы учить про режимы, то есть гибкость протекла бы
/// в код компонентов.
pub const METRICS_COMPACT: &[(&str, &str)] = &[
    ("space-1", "1px"),
    ("space-2", "3px"),
    ("space-3", "6px"),
    ("space-4", "9px"),
    ("space-5", "12px"),
    ("space-6", "18px"),
    ("font-size-ui", "12px"),
    ("font-size-ui-small", "10px"),
    ("font-size-title", "20px"),
    ("font-line-height-ui", "1.3"),
    ("control-statusbar-height", "24px"),
    ("control-titlebar-height", "38px"),
    ("control-tab-height", "32px"),
    ("control-tab-min-width", "90px"),
    ("control-tab-max-width", "180px"),
    ("control-window-button-width", "40px"),
    ("control-toolbar-height", "30px"),
    ("control-toolbar-button-size", "24px"),
    ("control-row-height", "22px"),
    ("control-field-height", "24px"),
    ("control-icon-size", "14px"),
    ("control-icon-size-window", "9px"),
    ("control-icon-size-tile", "17px"),
    ("control-icon-size-mark", "18px"),
    ("control-icon-size-mark-large", "28px"),
    ("control-dialog-min-width", "360px"),
    ("control-dialog-max-width", "500px"),
    ("control-popup-min-width", "220px"),
    ("control-search-width", "240px"),
    ("control-page-width", "560px"),
    ("control-editor-width", "82ch"),
    ("control-sidebar-width", "200px"),
    ("control-sidebar-min-width", "140px"),
    ("control-sidebar-max-width", "560px"),
    ("control-tree-indent", "13px"),
    ("control-tree-row-height", "19px"),
    ("control-strip-width", "42px"),
    ("control-strip-button-size", "32px"),
];

/// Семантические роли, выраженные через палитру.
///
/// Один и тот же список для светлой и тёмной темы: разница целиком в палитре.
/// Поэтому пользовательская тема — это, как правило, только раздел `[palette]`.
pub const SEMANTIC_COLORS: &[(&str, &str)] = &[
    // Три слоя, а не «фон и фон посветлее». Порядок от дальнего к ближнему:
    // подложка окна видна только в зазорах между панелями, панели стоят на ней,
    // рабочая область лежит на панели. Так устроен референс, и так каждая
    // граница получается тоном, а не рамкой.
    ("color-bg-canvas", "{palette.bg-0}"),
    ("color-bg-surface", "{palette.bg-1}"),
    ("color-bg-raised", "{palette.bg-2}"),
    ("color-bg-hover", "{palette.bg-3}"),
    ("color-bg-active", "{palette.bg-4}"),
    // Две разные подложки акцентом, и путать их нельзя. `selected` — тихая,
    // ею залита активная строка списка и подсвеченное совпадение поиска.
    // `selection` — заметно плотнее: ею выделен текст в редакторе, и он должен
    // быть виден поверх подсвеченной строки, а не сливаться с ней.
    ("color-bg-selected", "{palette.accent-soft}"),
    ("color-bg-selection", "{palette.accent-selection}"),
    // Подложка под модальным окном и палитрой.
    ("color-bg-overlay", "{palette.overlay}"),
    ("color-fg-default", "{palette.fg-0}"),
    ("color-fg-muted", "{palette.fg-1}"),
    ("color-fg-subtle", "{palette.fg-2}"),
    ("color-fg-on-accent", "{palette.fg-on-accent}"),
    ("color-accent", "{palette.accent}"),
    ("color-accent-hover", "{palette.accent-hover}"),
    ("color-border-default", "{palette.border}"),
    ("color-border-subtle", "{palette.border-subtle}"),
    ("color-border-focus", "{palette.accent}"),
    ("color-danger", "{palette.danger}"),
    ("color-warning", "{palette.warning}"),
    ("color-success", "{palette.success}"),
    // Подсветка синтаксиса — такие же токены, как всё остальное (Р-047).
    // Иначе тема перестаёт быть темой: цвета кода остались бы прежними при
    // смене оформления, и светлая тема с тёмными цветами кода выглядела бы
    // сломанной.
    //
    // Часть ролей выражена через общую палитру, а не через свои цвета:
    // обычный текст в коде — это просто текст, а знаки препинания тише его.
    // Своих цветов у них быть не должно, иначе автор темы обязан подобрать
    // пятнадцать оттенков вместо восьми.
    ("color-syntax-keyword", "{palette.syn-keyword}"),
    ("color-syntax-string", "{palette.syn-string}"),
    ("color-syntax-comment", "{palette.syn-comment}"),
    ("color-syntax-number", "{palette.syn-number}"),
    ("color-syntax-type", "{palette.syn-type}"),
    ("color-syntax-function", "{palette.syn-function}"),
    ("color-syntax-operator", "{palette.fg-1}"),
    ("color-syntax-variable", "{palette.fg-0}"),
    ("color-syntax-punctuation", "{palette.fg-2}"),
    // Знаки разметки markdown: решётки заголовка, звёздочки жирного,
    // угловая скобка цитаты, кавычки строчного кода. Своя роль, а не
    // общий цвет знаков препинания: в исходном режиме они остаются
    // на экране всегда, и тема вправе приглушить их сильнее, не трогая
    // запятые в коде (задача 57).
    ("color-syntax-markup", "{palette.fg-2}"),
    // Заголовок markdown отличается весом, а не цветом (Р-082). Тема, которой
    // это не нравится, задаёт `[color] syntax-heading` — для того слой ролей
    // и нужен.
    ("color-syntax-heading", "{palette.fg-0}"),
    ("color-syntax-link", "{palette.accent}"),
    ("color-syntax-emphasis", "{palette.fg-0}"),
    ("color-syntax-strong", "{palette.fg-0}"),
    ("color-syntax-quote", "{palette.fg-1}"),
    ("color-syntax-invalid", "{palette.danger}"),
    // Цвет метки файла по виду содержимого. Ролей четыре, а не двадцать:
    // иначе автор темы обязан подобрать цвет каждому расширению, а добавление
    // языка означало бы правку всех тем. Какое расширение к какой роли
    // относится, решает реестр значков во фронтенде.
    ("color-file-note", "{palette.accent}"),
    ("color-file-code", "{palette.syn-function}"),
    ("color-file-data", "{palette.syn-number}"),
    ("color-file-other", "{palette.fg-2}"),
];

/// Полный список имён токенов. Используется для проверки пользовательских тем
/// и для сверки с `tokens.css`.
pub fn all_names() -> Vec<&'static str> {
    let mut names: Vec<&'static str> = BASE
        .iter()
        .chain(METRICS_NORMAL.iter())
        .chain(SEMANTIC_COLORS.iter())
        .map(|(name, _)| *name)
        .collect();
    names.sort_unstable();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Плотности обязаны описывать один и тот же набор метрик: иначе при
    /// переключении часть токенов осталась бы со значениями от прошлого режима.
    #[test]
    fn density_profiles_cover_the_same_keys() {
        let normal: BTreeSet<_> = METRICS_NORMAL.iter().map(|(k, _)| *k).collect();
        let compact: BTreeSet<_> = METRICS_COMPACT.iter().map(|(k, _)| *k).collect();
        assert_eq!(normal, compact);
    }

    /// Одно имя не должно определяться дважды в разных таблицах.
    #[test]
    fn token_names_do_not_collide() {
        let mut seen = BTreeSet::new();
        for (name, _) in BASE.iter().chain(METRICS_NORMAL).chain(SEMANTIC_COLORS) {
            assert!(seen.insert(*name), "имя токена задано дважды: {name}");
        }
    }

    /// Компоненты пользуются только семантическими ролями, поэтому в списке
    /// не должно оказаться токена с именем из палитры.
    #[test]
    fn palette_never_leaks_into_token_names() {
        for name in all_names() {
            assert!(
                !name.starts_with("palette"),
                "палитра не должна попадать в CSS: {name}"
            );
        }
    }
}
