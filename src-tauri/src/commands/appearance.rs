//! Команда, отдающая фронтенду готовое оформление.
//!
//! `commands/` не содержит логики — только сведение вместе того, что делают
//! `settings`, `theme` и `fsx`. Поэтому вся содержательная часть проверяется
//! обычным `cargo test` без запуска приложения.

use std::collections::BTreeMap;

use crate::settings;
use crate::state::AppState;
use crate::theme::{self, Appearance, Density, ThemeInfo};

/// Всё, что нужно интерфейсу, чтобы нарисовать себя.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceState {
    /// Имя токена без префикса `--zn-` → значение CSS.
    pub tokens: BTreeMap<String, String>,
    pub theme_id: String,
    pub theme_name: String,
    pub appearance: Appearance,
    pub density: Density,
    /// Список для выбора темы.
    pub themes: Vec<ThemeInfo>,
    /// Где лежат данные — показывается в строке состояния.
    pub data_dir: String,
    /// `false` — папка рядом с приложением недоступна, ушли в запасную.
    pub portable: bool,
    /// Проблемы, которые надо показать пользователю: опечатка в настройках,
    /// битый файл темы, ненайденная тема. Пустой список — всё в порядке.
    pub problems: Vec<String>,
}

/// Сборка состояния оформления.
///
/// Вынесена из команды и принимает пути явно — так её можно проверить тестом
/// на временной папке, не поднимая приложение.
///
/// `system_dark` приходит с фронтенда: системную тему проще и надёжнее узнать
/// из `prefers-color-scheme` в вебвью, чем спрашивать Windows из Rust.
pub fn build(
    data_dir: &std::path::Path,
    portable: bool,
    system_dark: bool,
    extra_notices: &[String],
) -> AppearanceState {
    let mut problems: Vec<String> = extra_notices.to_vec();

    let settings_path = data_dir.join("settings.toml");
    let settings = match settings::load_full(&settings_path) {
        Ok(loaded) => {
            // Что не применилось — в полосу предупреждений, по строке
            // на ключ (Р-248). Остальное работает.
            problems.extend(
                loaded
                    .problems
                    .into_iter()
                    .map(|problem| format!("settings.toml: {problem}")),
            );
            loaded.settings
        }
        Err(e) => {
            // Нечитаемый файл не должен оставлять пользователя без интерфейса.
            // Работаем на умолчаниях, но громко говорим почему.
            problems.push(e.to_string());
            settings::Settings::default()
        }
    };

    // Жалобы на файл коллаутов — в ту же полосу: превью рисует карточки
    // по этому файлу, и опечатка в нём видна ровно там (задача 103).
    match crate::callouts::load_full(&data_dir.join("callouts.toml")) {
        Ok(loaded) => problems.extend(
            loaded
                .problems
                .into_iter()
                .map(|problem| format!("callouts.toml: {problem}")),
        ),
        Err(e) => problems.push(e.to_string()),
    }

    let themes_dir = data_dir.join("themes");
    let (themes, theme_problems) = theme::available(&themes_dir);
    problems.extend(theme_problems);

    // Какая тема запрошена: явная или парная к системной настройке.
    let requested = if settings.appearance.theme == "system" {
        if system_dark {
            settings.appearance.dark_theme.clone()
        } else {
            settings.appearance.light_theme.clone()
        }
    } else {
        settings.appearance.theme.clone()
    };

    let fallback_appearance = if system_dark {
        Appearance::Dark
    } else {
        Appearance::Light
    };

    let selected = match theme::load_by_id(&themes_dir, &requested) {
        Some(theme) => theme,
        None => {
            problems.push(format!(
                "тема «{requested}» не найдена, взята встроенная"
            ));
            theme::builtin(fallback_appearance)
        }
    };

    let density = settings.appearance.density;

    // Шрифты человека ложатся поверх темы: выбранный шрифт не должен
    // сбрасываться при смене темы (задача 105). Шрифт темы остаётся
    // запасным — не нашёлся выбранный, на экране будет он.
    let mut overrides: BTreeMap<String, String> = BTreeMap::new();
    let places = [
        (&settings.font.ui, "font-family-ui", "font-size-ui"),
        (&settings.font.editor, "font-family-editor", "font-size-editor"),
    ];
    for (choice, family_token, size_token) in places {
        if let Some(family) = &choice.family
            && !family.trim().is_empty()
        {
            let fallback = theme::token_value(&selected, family_token, density).unwrap_or_default();
            overrides.insert(
                family_token.to_owned(),
                theme::font_family_with_fallback(family, &fallback),
            );
        }
        if let Some(size) = choice.size {
            overrides.insert(size_token.to_owned(), format!("{size}px"));
        }
    }

    let (tokens, theme_id, theme_name, appearance) =
        match theme::resolve_with(&selected, density, &overrides) {
            Ok(tokens) => (
                tokens,
                selected.id.clone(),
                selected.name.clone(),
                selected.appearance,
            ),
            Err(e) => {
                problems.push(format!("тема «{}»: {e}", selected.id));
                let safe = theme::builtin(fallback_appearance);
                let tokens = theme::resolve(&safe, density)
                    .expect("встроенная тема обязана собираться, это проверено тестом");
                (tokens, safe.id.clone(), safe.name.clone(), safe.appearance)
            }
        };

    AppearanceState {
        tokens,
        theme_id,
        theme_name,
        appearance,
        density,
        themes,
        data_dir: data_dir.display().to_string(),
        portable,
        problems,
    }
}

#[tauri::command]
pub fn appearance_state(state: tauri::State<'_, AppState>, system_dark: bool) -> AppearanceState {
    build(
        &state.data_dir.path,
        state.data_dir.portable,
        system_dark,
        &state
            .startup_notices
            .lock()
            .expect("список предупреждений повреждён"),
    )
}

/// Исходник встроенной темы — чтобы пользователь мог взять её за основу,
/// не выкапывая из репозитория.
#[tauri::command]
pub fn builtin_theme_source(appearance: Appearance) -> String {
    theme::builtin_source(appearance).to_owned()
}

/// Образцы тем для вкладки «Темы»: цвета каждой темы, какими их увидит глаз.
///
/// Отдельной командой, а не полем состояния оформления. Состояние собирается
/// при каждом запуске и при каждой правке файла в папке данных; образцы нужны
/// одному экрану, который открывают раз в месяц. Класть разбор и сборку всех
/// тем на путь запуска ради него — платить за вкладку постоянно.
#[tauri::command]
pub fn theme_samples(state: tauri::State<'_, AppState>) -> Vec<theme::ThemeSample> {
    theme::samples(&state.data_dir.themes_dir())
}

/// «Создать свою на основе этой»: копия файла темы в папке пользователя.
///
/// Возвращается описание новой темы — интерфейсу нужен её идентификатор,
/// чтобы тут же её выбрать.
#[tauri::command]
pub fn create_theme(state: tauri::State<'_, AppState>, id: String) -> Result<ThemeInfo, String> {
    theme::create_copy(&state.data_dir.themes_dir(), &id).map_err(|e| e.to_string())
}

/// Показать папку тем в проводнике.
///
/// Папку создаёт запуск приложения, но её могли удалить руками между запусками,
/// а «открыть» не должно превращаться в сообщение об ошибке из-за этого.
#[tauri::command]
pub fn open_themes_dir(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let dir = state.data_dir.themes_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::fsx::reveal::reveal(&dir).map_err(|e| e.to_string())
}

/// Тема для правки в редакторе тем (задача 105).
///
/// Плотность приходит из окна: от неё зависят умолчания метрик, и показывать
/// надо те, что на экране.
#[tauri::command]
pub fn theme_editor(
    state: tauri::State<'_, AppState>,
    id: String,
    density: Density,
) -> Result<theme::editor::EditorState, String> {
    theme::editor::editor_state(&state.data_dir.themes_dir(), &id, density).map_err(|e| e.to_string())
}

/// Записать одно значение в файл своей темы; `None` — убрать, вернув
/// умолчание.
///
/// Встроенная тема не правится: она в двоичном файле приложения. Правка,
/// после которой тема не собралась бы, не пишется. Запись атомарная, как
/// у настроек (инвариант 3); окно перерисуется от слежения за папкой тем.
#[tauri::command]
pub fn set_theme_value(
    state: tauri::State<'_, AppState>,
    id: String,
    section: String,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    let (path, source) = theme::editor::user_theme(&state.data_dir.themes_dir(), &id)
        .ok_or_else(|| "Встроенную тему не правим — сделайте свою на основе этой.".to_owned())?;
    let updated = theme::editor::set_value(&source, &section, &key, value.as_deref())
        .map_err(|e| e.to_string())?;
    crate::fsx::atomic_save::save(&path, updated.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-appearance-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Первый запуск: файлов нет, но интерфейс обязан получить полное оформление.
    #[test]
    fn works_on_empty_data_dir() {
        let dir = temp_dir("empty");

        let state = build(&dir, true, true, &[]);

        assert_eq!(state.theme_id, "dark");
        assert!(state.problems.is_empty(), "{:?}", state.problems);
        assert!(!state.tokens.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    /// `theme = "system"` действительно следует за системной настройкой.
    #[test]
    fn system_theme_follows_os() {
        let dir = temp_dir("system");

        assert_eq!(build(&dir, true, true, &[]).theme_id, "dark");
        assert_eq!(build(&dir, true, false, &[]).theme_id, "light");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Явно выбранная тема перекрывает системную настройку.
    #[test]
    fn explicit_theme_wins_over_system() {
        let dir = temp_dir("explicit");
        fs::write(
            dir.join("settings.toml"),
            "schema = 1\n[appearance]\ntheme = \"light\"\n",
        )
        .unwrap();

        let state = build(&dir, true, true, &[]);

        assert_eq!(state.theme_id, "light");
        assert_eq!(state.appearance, Appearance::Light);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Пользовательская тема из папки подхватывается и попадает в список.
    #[test]
    fn user_theme_is_picked_up() {
        let dir = temp_dir("user-theme");
        let themes = dir.join("themes");
        fs::create_dir_all(&themes).unwrap();
        fs::write(
            themes.join("моя.toml"),
            r##"
schema = 1
id = "моя"
name = "Моя тема"
appearance = "dark"

[palette]
bg-0 = "#010203"
"##,
        )
        .unwrap();
        fs::write(
            dir.join("settings.toml"),
            "schema = 1\n[appearance]\ntheme = \"моя\"\n",
        )
        .unwrap();

        let state = build(&dir, true, true, &[]);

        assert_eq!(state.theme_id, "моя");
        assert_eq!(state.tokens["color-bg-canvas"], "#010203");
        assert!(state.themes.iter().any(|t| t.id == "моя"));
        assert!(state.problems.is_empty(), "{:?}", state.problems);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Битая тема не оставляет пользователя с чёрным окном: берётся встроенная,
    /// а причина попадает в problems.
    #[test]
    fn broken_theme_falls_back_and_reports() {
        let dir = temp_dir("broken");
        let themes = dir.join("themes");
        fs::create_dir_all(&themes).unwrap();
        fs::write(themes.join("битая.toml"), "это не toml = = =").unwrap();

        let state = build(&dir, true, true, &[]);

        assert_eq!(state.theme_id, "dark");
        assert!(!state.tokens.is_empty());
        assert!(
            state.problems.iter().any(|p| p.contains("битая")),
            "{:?}",
            state.problems
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Ссылка на несуществующую тему — сообщение, а не пустой интерфейс.
    #[test]
    fn missing_theme_falls_back_and_reports() {
        let dir = temp_dir("missing");
        fs::write(
            dir.join("settings.toml"),
            "schema = 1\n[appearance]\ntheme = \"нет-такой\"\n",
        )
        .unwrap();

        let state = build(&dir, true, false, &[]);

        assert_eq!(state.theme_id, "light");
        assert!(
            state.problems.iter().any(|p| p.contains("нет-такой")),
            "{:?}",
            state.problems
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Шрифт из настроек ложится поверх темы, а шрифт темы остаётся
    /// запасным: не нашёлся выбранный — на экране он, а не засечки браузера.
    #[test]
    fn ui_font_from_settings_overrides_theme() {
        let dir = temp_dir("font");
        fs::write(
            dir.join("settings.toml"),
            "schema = 1\n[font.ui]\nfamily = \"Verdana\"\nsize = 17\n",
        )
        .unwrap();

        let state = build(&dir, true, true, &[]);

        let family = &state.tokens["font-family-ui"];
        assert!(family.starts_with("'Verdana', "), "{family}");
        assert!(family.contains("IBM Plex Sans"), "шрифт темы пропал: {family}");
        assert_eq!(state.tokens["font-size-ui"], "17px");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Шрифт редактора — такая же настройка (задача 105).
    #[test]
    fn editor_font_from_settings_overrides_theme() {
        let dir = temp_dir("editor-font");
        fs::write(
            dir.join("settings.toml"),
            "schema = 1\n[font.editor]\nfamily = \"Cascadia Code\"\nsize = 16\n",
        )
        .unwrap();

        let state = build(&dir, true, true, &[]);

        let family = &state.tokens["font-family-editor"];
        assert!(family.starts_with("'Cascadia Code', "), "{family}");
        assert!(family.contains("JetBrains Mono"), "шрифт темы пропал: {family}");
        assert_eq!(state.tokens["font-size-editor"], "16px");
        // Интерфейс не задет.
        assert!(!state.tokens["font-family-ui"].contains("Cascadia"));
        assert!(state.problems.is_empty(), "{:?}", state.problems);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Переход в запасную папку виден интерфейсу — это требование решения Р-008.
    #[test]
    fn fallback_location_is_visible() {
        let dir = temp_dir("notice");

        let state = build(&dir, false, true, &["папка недоступна".to_owned()]);

        assert!(!state.portable);
        assert!(state.problems.iter().any(|p| p.contains("недоступна")));
        let _ = fs::remove_dir_all(&dir);
    }
}
