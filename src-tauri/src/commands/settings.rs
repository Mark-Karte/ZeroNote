//! Команды окна параметров.
//!
//! Логики здесь нет: разбор — в `settings/mod.rs`, правка с сохранением
//! комментариев — в `settings/edit.rs`, запись на диск — в `fsx/atomic_save.rs`.
//! Здесь только сведение их вместе.

use crate::fsx::atomic_save;
use crate::settings::{self, Settings, edit};
use crate::state::AppState;

/// Всё, что нужно окну параметров.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsState {
    /// Значения, действующие сейчас. При испорченном файле — умолчания.
    pub settings: Settings,
    /// Путь к файлу: окно параметров показывает его и умеет открыть.
    pub path: String,
    /// Файл не разбирается. Тогда окно показывает значения, но не даёт править:
    /// запись в непонятный файл стёрла бы то, что человек не дописал.
    pub broken: Option<String>,
}

fn settings_path(state: &AppState) -> std::path::PathBuf {
    state.data_dir.path.join("settings.toml")
}

#[tauri::command]
pub fn settings_state(state: tauri::State<'_, AppState>) -> SettingsState {
    let path = settings_path(&state);

    let (settings, broken) = match settings::load(&path) {
        Ok(settings) => (settings, None),
        Err(e) => (Settings::default(), Some(e.to_string())),
    };

    SettingsState {
        settings,
        path: path.display().to_string(),
        broken,
    }
}

/// Записать одну настройку.
///
/// По одной, а не пачкой: окно параметров применяет изменение сразу, как только
/// его сделали, — «применить» и «отменить» здесь были бы лишним шагом над
/// файлом, который и так правится руками (Р-077).
///
/// `value = null` означает «убрать ключ»: для шрифта интерфейса это не пустая
/// строка, а «брать из темы».
#[tauri::command]
pub fn update_setting(
    state: tauri::State<'_, AppState>,
    path: Vec<String>,
    value: Option<edit::Setting>,
) -> Result<(), String> {
    if path.is_empty() {
        return Err("путь к настройке пуст".to_owned());
    }

    let file = settings_path(&state);

    // Файла может не быть: первый запуск, а окно параметров открыли раньше,
    // чем что-либо записалось. Правим образец, а не пустоту, — иначе первая же
    // настройка из окна оставила бы файл без единого пояснения.
    let source = match std::fs::read_to_string(&file) {
        Ok(source) => source,
        Err(_) => settings::DEFAULT_TEMPLATE.to_owned(),
    };

    let keys: Vec<&str> = path.iter().map(String::as_str).collect();
    let updated = match &value {
        Some(value) => edit::set(&source, &keys, value),
        None => edit::unset(&source, &keys),
    }
    .map_err(|e| e.to_string())?;

    // Итог обязан разбираться нашим же разбором. Проверка не лишняя: правка
    // могла оказаться верной по TOML и неверной по смыслу — например, тема
    // с именем, которого не бывает, или размер шрифта строкой. Записать такое
    // значило бы сломать пользователю оформление руками окна параметров.
    settings::parse(&updated).map_err(|e| e.to_string())?;

    // Атомарно, как и любой файл: настройки не наши, их правят руками
    // и кладут в git (инвариант 3).
    atomic_save::save(&file, updated.as_bytes()).map_err(|e| e.to_string())
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
        let dir = std::env::temp_dir().join(format!("zeronote-settings-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Правка через команду проходит весь путь: разбор, подмена, проверка,
    /// запись. Проверяем по байтам файла, а не по возвращённому значению.
    #[test]
    fn writing_keeps_the_file_readable_and_commented() {
        let dir = temp_dir("write");
        let file = dir.join("settings.toml");
        fs::write(&file, settings::DEFAULT_TEMPLATE).unwrap();

        let source = fs::read_to_string(&file).unwrap();
        let updated = edit::set(
            &source,
            &["appearance", "theme"],
            &edit::Setting::Text("pine".to_owned()),
        )
        .unwrap();
        atomic_save::save(&file, updated.as_bytes()).unwrap();

        let after = fs::read_to_string(&file).unwrap();
        assert!(after.contains("theme = \"pine\""));
        assert!(after.contains("# Настройки ZeroNote."));
        assert_eq!(
            settings::parse(&after).unwrap().appearance.theme,
            "pine".to_owned()
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Значение, верное по TOML, но неверное по смыслу, до файла не доходит.
    #[test]
    fn nonsense_value_is_rejected_before_writing() {
        let source = "schema = 1\n[appearance]\ndensity = \"normal\"\n";

        let updated = edit::set(
            source,
            &["appearance", "density"],
            &edit::Setting::Text("очень плотная".to_owned()),
        )
        .expect("по TOML это верная правка");

        // А по смыслу — нет, и команда обязана остановиться здесь.
        assert!(settings::parse(&updated).is_err());
    }
}
