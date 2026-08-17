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
    // Шрифты. Пустая семья интерфейса означает «системный»; подстановка
    // системного стека — забота CSS, здесь мы не знаем ОС пользователя.
    (
        "font-family-ui",
        "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    ),
    (
        "font-family-editor",
        "'Cascadia Mono', Consolas, 'Courier New', monospace",
    ),
    ("font-size-editor", "14px"),
    ("font-line-height-editor", "1.5"),
    ("font-weight-normal", "400"),
    ("font-weight-medium", "600"),
    // Разрядка для набранных прописными подписей: без неё они читаются хуже.
    ("font-letter-spacing-caps", "0.06em"),
    // Скругления.
    ("radius-sm", "3px"),
    ("radius-md", "5px"),
    ("radius-lg", "8px"),
    // Границы.
    ("border-width", "1px"),
    ("border-width-thick", "2px"),
    // Тени. Значения по умолчанию нейтральные; встроенные темы их переопределяют,
    // потому что тёмной теме нужна заметно более плотная тень.
    ("shadow-raised", "0 1px 2px rgba(0, 0, 0, 0.16)"),
    ("shadow-overlay", "0 8px 24px rgba(0, 0, 0, 0.24)"),
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
    ("font-line-height-ui", "1.4"),
    ("control-statusbar-height", "24px"),
    ("control-titlebar-height", "34px"),
    ("control-tab-height", "32px"),
    ("control-tab-min-width", "110px"),
    ("control-tab-max-width", "220px"),
    ("control-window-button-width", "46px"),
    ("control-toolbar-height", "36px"),
    ("control-row-height", "24px"),
    ("control-icon-size", "16px"),
    ("control-dialog-min-width", "420px"),
    ("control-dialog-max-width", "560px"),
    ("control-popup-min-width", "260px"),
    ("control-sidebar-width", "240px"),
    ("control-sidebar-min-width", "160px"),
    ("control-sidebar-max-width", "640px"),
    ("control-tree-indent", "14px"),
    // Отдельно от `control-row-height`: строка дерева плотнее прочих списков,
    // и подгонка одного не должна двигать другое.
    ("control-tree-row-height", "22px"),
    ("control-strip-width", "40px"),
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
    ("font-line-height-ui", "1.3"),
    ("control-statusbar-height", "20px"),
    ("control-titlebar-height", "30px"),
    ("control-tab-height", "26px"),
    ("control-tab-min-width", "90px"),
    ("control-tab-max-width", "180px"),
    ("control-window-button-width", "40px"),
    ("control-toolbar-height", "30px"),
    ("control-row-height", "20px"),
    ("control-icon-size", "14px"),
    ("control-dialog-min-width", "360px"),
    ("control-dialog-max-width", "500px"),
    ("control-popup-min-width", "220px"),
    ("control-sidebar-width", "200px"),
    ("control-sidebar-min-width", "140px"),
    ("control-sidebar-max-width", "560px"),
    ("control-tree-indent", "12px"),
    ("control-tree-row-height", "19px"),
    ("control-strip-width", "34px"),
];

/// Семантические роли, выраженные через палитру.
///
/// Один и тот же список для светлой и тёмной темы: разница целиком в палитре.
/// Поэтому пользовательская тема — это, как правило, только раздел `[palette]`.
pub const SEMANTIC_COLORS: &[(&str, &str)] = &[
    ("color-bg-canvas", "{palette.bg-0}"),
    ("color-bg-surface", "{palette.bg-1}"),
    ("color-bg-raised", "{palette.bg-2}"),
    ("color-bg-hover", "{palette.bg-3}"),
    ("color-bg-active", "{palette.bg-4}"),
    ("color-bg-selected", "{palette.accent-soft}"),
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
    ("color-syntax-operator", "{palette.syn-operator}"),
    ("color-syntax-variable", "{palette.fg-0}"),
    ("color-syntax-punctuation", "{palette.fg-1}"),
    ("color-syntax-heading", "{palette.syn-heading}"),
    ("color-syntax-link", "{palette.accent}"),
    ("color-syntax-emphasis", "{palette.fg-0}"),
    ("color-syntax-strong", "{palette.fg-0}"),
    ("color-syntax-quote", "{palette.fg-1}"),
    ("color-syntax-invalid", "{palette.danger}"),
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
