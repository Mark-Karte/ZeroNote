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
    let settings = match settings::load(&settings_path) {
        Ok(settings) => settings,
        Err(e) => {
            // Испорченный файл не должен оставлять пользователя без интерфейса.
            // Работаем на умолчаниях, но громко говорим почему.
            problems.push(e.to_string());
            settings::Settings::default()
        }
    };

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

    // Настройки шрифта интерфейса ложатся поверх темы: выбранный пользователем
    // шрифт не должен сбрасываться при смене темы.
    let mut overrides: BTreeMap<String, String> = BTreeMap::new();
    if let Some(family) = &settings.font.ui.family
        && !family.trim().is_empty()
    {
        overrides.insert("font-family-ui".to_owned(), family.clone());
    }
    if let Some(size) = settings.font.ui.size {
        overrides.insert("font-size-ui".to_owned(), format!("{size}px"));
    }

    let density = settings.appearance.density;

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

    /// Шрифт из настроек ложится поверх темы.
    #[test]
    fn ui_font_from_settings_overrides_theme() {
        let dir = temp_dir("font");
        fs::write(
            dir.join("settings.toml"),
            "schema = 1\n[font.ui]\nfamily = \"Verdana\"\nsize = 17\n",
        )
        .unwrap();

        let state = build(&dir, true, true, &[]);

        assert_eq!(state.tokens["font-family-ui"], "Verdana");
        assert_eq!(state.tokens["font-size-ui"], "17px");
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
