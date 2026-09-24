//! Проверка читаемости темы (Р-078, Р-143).
//!
//! До задачи 105 правила жили внутри теста и проверяли только встроенные
//! темы — при сборке. У своей темы единственным судьёй был глаз. Редактору
//! тем судья нужен в окне, пока цвет подбирают, поэтому правила вынесены
//! сюда: тест встроенных тем и редактор зовут одну и ту же `check`,
//! и разойтись им не с чего.
//!
//! Правил два. Текст обязан читаться на всех трёх фонах — отношение
//! контраста WCAG. Цвета подсветки обязаны отличаться **друг от друга** —
//! расстояние в CIE Lab: у двух цветов разного оттенка и одной яркости
//! отношение контраста равно единице, хотя глаз их различает.

use std::collections::BTreeMap;

use super::parse_hex;

/// Основной текст — 7:1, как требует WCAG для строгого уровня.
pub const MAIN_TEXT: f64 = 7.0;
/// Второстепенный текст и всё, что несёт смысл цветом.
pub const TEXT: f64 = 4.5;
/// Самое тихое: номера строк, подсказки в пустых полях.
pub const QUIET_TEXT: f64 = 3.0;

/// Насколько цвета подсветки обязаны отличаться друг от друга.
///
/// Порог выбран по замерам, а не на глаз. Жёлтый `#e5c07b` и оранжевый
/// `#e8a05c` — расхождение 18, и в тексте они читаются как один цвет;
/// у пар, которые глаз уверенно делит, расхождение начинается с 24.
/// Двадцать — граница между этими двумя случаями.
pub const SYNTAX_MIN_DELTA: f64 = 20.0;

/// Шесть цветов подсветки. Роли, у которых свой цвет в палитре; остальные
/// (операторы, знаки препинания, заголовки) берут цвет обычного текста
/// и проверяются вместе с ним.
pub const SYNTAX: [&str; 6] = [
    "color-syntax-keyword",
    "color-syntax-string",
    "color-syntax-comment",
    "color-syntax-number",
    "color-syntax-type",
    "color-syntax-function",
];

/// Что не прошло.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub kind: FindingKind,
    /// Токен, который проверяли: текст или первый из пары цветов.
    pub token: String,
    /// Фон, на котором читали, или второй цвет пары.
    pub against: String,
    /// Что вышло: отношение контраста или расстояние в Lab.
    pub value: f64,
    /// Сколько нужно.
    pub need: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FindingKind {
    /// Текст на фоне читается хуже порога.
    Contrast,
    /// Два цвета подсветки неразличимы.
    Distance,
    /// Цвет задан не как `#rrggbb` — посчитать нечего. Сказать об этом
    /// честнее, чем промолчать: молчание читается как «всё в порядке».
    Unchecked,
}

/// Проверить готовую таблицу токенов. Пустой список — тема читаема.
///
/// Порядок и состав правил — те же, что были в тесте встроенных тем:
/// тест теперь зовёт эту функцию.
pub fn check(tokens: &BTreeMap<String, String>) -> Vec<Finding> {
    let mut findings = Vec::new();
    let mut unchecked: Vec<&str> = Vec::new();

    // Не разобрали цвет — одна запись на токен, а не по записи на каждую
    // пару, в которой он участвует.
    let mut ratio = |text: &'static str, back: &'static str, need: f64, findings: &mut Vec<Finding>| {
        let (Some(a), Some(b)) = (tokens.get(text), tokens.get(back)) else {
            return;
        };
        match contrast(a, b) {
            Some(value) if value < need => findings.push(Finding {
                kind: FindingKind::Contrast,
                token: text.to_owned(),
                against: back.to_owned(),
                value,
                need,
            }),
            Some(_) => {}
            None => {
                for name in [text, back] {
                    if parse_hex(&tokens[name]).is_none() && !unchecked.contains(&name) {
                        unchecked.push(name);
                    }
                }
            }
        }
    };

    for back in ["color-bg-surface", "color-bg-raised", "color-bg-canvas"] {
        ratio("color-fg-default", back, MAIN_TEXT, &mut findings);
        for role in [
            "color-fg-muted",
            "color-accent",
            "color-danger",
            "color-warning",
            "color-success",
        ] {
            ratio(role, back, TEXT, &mut findings);
        }
        ratio("color-fg-subtle", back, QUIET_TEXT, &mut findings);
    }

    // Код читают там же, где текст: в рабочей области и на подложке —
    // ею залит блок кода внутри markdown.
    for back in ["color-bg-raised", "color-bg-canvas"] {
        for role in SYNTAX {
            ratio(role, back, TEXT, &mut findings);
        }
    }

    // Надпись на кнопке, залитой акцентом. Здесь ошибаются чаще всего:
    // белый по светлому акценту выглядит нарядно и не читается.
    ratio("color-fg-on-accent", "color-accent", TEXT, &mut findings);

    for (i, first) in SYNTAX.iter().enumerate() {
        for second in &SYNTAX[i + 1..] {
            let (Some(a), Some(b)) = (tokens.get(*first), tokens.get(*second)) else {
                continue;
            };
            if let Some(value) = delta_e(a, b)
                && value < SYNTAX_MIN_DELTA
            {
                findings.push(Finding {
                    kind: FindingKind::Distance,
                    token: (*first).to_owned(),
                    against: (*second).to_owned(),
                    value,
                    need: SYNTAX_MIN_DELTA,
                });
            }
        }
    }

    for name in unchecked {
        findings.push(Finding {
            kind: FindingKind::Unchecked,
            token: name.to_owned(),
            against: String::new(),
            value: 0.0,
            need: 0.0,
        });
    }

    findings
}

/// Составляющие цвета, приведённые из значения, каким его хранит файл,
/// к значению, каким его видит глаз (гамма-коррекция наоборот).
fn linear(hex: &str) -> Option<[f64; 3]> {
    let [r, g, b] = parse_hex(hex)?;
    let channel = |value: f64| {
        let raw = value / 255.0;
        if raw <= 0.04045 {
            raw / 12.92
        } else {
            ((raw + 0.055) / 1.055).powf(2.4)
        }
    };
    Some([channel(r), channel(g), channel(b)])
}

/// Относительная яркость по WCAG 2: составляющие складываются с весами,
/// потому что зелёный человек различает лучше синего почти на порядок.
fn luminance(hex: &str) -> Option<f64> {
    let [r, g, b] = linear(hex)?;
    Some(0.2126 * r + 0.7152 * g + 0.0722 * b)
}

/// Отношение контраста двух цветов: от 1 (одинаковые) до 21 (чёрный
/// и белый). Не цвета `#rgb`/`#rrggbb` — `None`.
pub fn contrast(a: &str, b: &str) -> Option<f64> {
    let (x, y) = (luminance(a)?, luminance(b)?);
    let (light, dark) = if x > y { (x, y) } else { (y, x) };
    Some((light + 0.05) / (dark + 0.05))
}

/// Цвет в координатах CIE Lab: светлота и две оси цветности. Расстояние
/// в нём примерно соответствует тому, насколько цвета кажутся разными.
/// Белая точка — D65, та же, что подразумевает sRGB.
fn lab(hex: &str) -> Option<[f64; 3]> {
    let [r, g, b] = linear(hex)?;

    let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;

    let f = |t: f64| {
        if t > 0.008856 {
            t.cbrt()
        } else {
            7.787 * t + 16.0 / 116.0
        }
    };

    Some([
        116.0 * f(y) - 16.0,
        500.0 * (f(x) - f(y)),
        200.0 * (f(y) - f(z)),
    ])
}

/// Расстояние между цветами в Lab (ΔE по формуле 1976 года).
///
/// Формула самая простая из трёх существующих: более поздние точнее возле
/// порога «глаз едва замечает разницу», а нам нужен порог намного выше —
/// «это очевидно разные цвета».
pub fn delta_e(a: &str, b: &str) -> Option<f64> {
    let (x, y) = (lab(a)?, lab(b)?);
    Some(((x[0] - y[0]).powi(2) + (x[1] - y[1]).powi(2) + (x[2] - y[2]).powi(2)).sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect()
    }

    /// Порог обязан срабатывать: проверка, которая не может провалиться,
    /// выглядит точно так же, как проверка, которая проходит.
    #[test]
    fn contrast_has_the_reference_numbers() {
        // Серый по чуть более светлому серому — 1,7:1.
        assert!(contrast("#808080", "#9a9a9a").unwrap() < TEXT);
        // Чёрный по белому — предел шкалы.
        assert!((contrast("#000000", "#ffffff").unwrap() - 21.0).abs() < 0.01);
        assert!((contrast("#000", "#fff").unwrap() - 21.0).abs() < 0.01);
        assert_eq!(contrast("rgba(0, 0, 0, 0.5)", "#fff"), None);
    }

    /// Случай настоящий: шесть голубых оттенков, каждый из которых
    /// **проходит** проверку читаемости на тёмном фоне. Первое правило их
    /// пропускает, второе обязано остановить.
    #[test]
    fn distinctness_rejects_palette_of_one_hue() {
        let shades = ["#8ab4f8", "#93b9f8", "#9cbef9", "#a5c3f9", "#aec8fa", "#b7cdfa"];

        for shade in shades {
            let ratio = contrast(shade, "#1a1b26").unwrap();
            assert!(ratio >= TEXT, "оттенок {shade} должен быть читаемым");
        }

        let worst = shades
            .iter()
            .enumerate()
            .flat_map(|(i, first)| {
                shades[i + 1..].iter().map(move |second| delta_e(first, second).unwrap())
            })
            .fold(f64::MAX, f64::min);

        assert!(
            worst < SYNTAX_MIN_DELTA,
            "оттенки одного цвета обязаны проваливать проверку, а расходятся на {worst:.0}"
        );
    }

    #[test]
    fn grey_on_grey_is_named_with_numbers() {
        let tokens = table(&[
            ("color-fg-default", "#808080"),
            ("color-bg-surface", "#9a9a9a"),
        ]);
        let findings = check(&tokens);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, FindingKind::Contrast);
        assert_eq!(findings[0].token, "color-fg-default");
        assert_eq!(findings[0].against, "color-bg-surface");
        assert_eq!(findings[0].need, MAIN_TEXT);
        assert!(findings[0].value < 2.0);
    }

    /// Цвет не `#rrggbb` посчитать нельзя — и об этом говорится один раз,
    /// а не на каждой паре, где он участвует.
    #[test]
    fn colour_that_cannot_be_counted_is_named_once() {
        let tokens = table(&[
            ("color-fg-default", "rebeccapurple"),
            ("color-bg-surface", "#ffffff"),
            ("color-bg-raised", "#ffffff"),
            ("color-bg-canvas", "#ffffff"),
        ]);
        let findings = check(&tokens);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, FindingKind::Unchecked);
        assert_eq!(findings[0].token, "color-fg-default");
    }
}
