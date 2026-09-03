//! Команда, отдающая фронтенду готовую раскладку клавиш.

use std::collections::BTreeMap;

use crate::keymap;
use crate::state::AppState;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeymapState {
    /// Сочетание в приведённом виде → идентификатор команды.
    pub bindings: BTreeMap<String, String>,
    /// Все команды с человеческими названиями — для будущего окна параметров.
    pub commands: Vec<CommandInfo>,
    /// Что не так с файлом раскладки. Пустой список — всё в порядке.
    pub problems: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct CommandInfo {
    pub id: String,
    pub title: String,
}

/// Сборка раскладки, отделённая от путей ради тестов.
pub fn build(data_dir: &std::path::Path) -> KeymapState {
    let mut problems = Vec::new();

    let user = match std::fs::read_to_string(data_dir.join("keymap.toml")) {
        Ok(source) => match keymap::parse(&source) {
            Ok(file) => Some(file),
            Err(e) => {
                // Испорченный файл не должен оставлять пользователя без
                // горячих клавиш вовсе: работаем на умолчаниях и говорим почему.
                problems.push(e.to_string());
                None
            }
        },
        // Файла нет — это нормально, действует раскладка по умолчанию.
        Err(_) => None,
    };

    let bindings = match keymap::resolve(user.as_ref()) {
        Ok(bindings) => bindings,
        Err(e) => {
            problems.push(e.to_string());
            keymap::resolve(None).expect("умолчания обязаны собираться")
        }
    };

    KeymapState {
        bindings,
        commands: keymap::COMMANDS
            .iter()
            .map(|(id, title)| CommandInfo {
                id: (*id).to_owned(),
                title: (*title).to_owned(),
            })
            .collect(),
        problems,
    }
}

#[tauri::command]
pub fn keymap_state(state: tauri::State<'_, AppState>) -> KeymapState {
    build(&state.data_dir.path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-keymap-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Без файла раскладки действует Notepad++ и никаких жалоб.
    #[test]
    fn works_without_user_file() {
        let dir = temp_dir("none");

        let state = build(&dir);

        assert_eq!(state.bindings["ctrl+d"], "edit.add-cursor-next");
        assert_eq!(state.bindings["ctrl+shift+d"], "edit.duplicate-line");
        assert!(state.problems.is_empty());
        assert!(!state.commands.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Испорченный файл не оставляет пользователя без горячих клавиш.
    #[test]
    fn broken_file_falls_back_and_reports() {
        let dir = temp_dir("broken");
        std::fs::write(dir.join("keymap.toml"), "это не toml = = =").unwrap();

        let state = build(&dir);

        assert_eq!(state.bindings["ctrl+s"], "file.save");
        assert!(!state.problems.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Опечатка в имени команды тоже не должна ломать раскладку целиком.
    #[test]
    fn unknown_command_falls_back_and_reports() {
        let dir = temp_dir("typo");
        std::fs::write(
            dir.join("keymap.toml"),
            "schema = 1\n[bindings]\n\"ctrl+d\" = \"edit.duplicate-lines\"\n",
        )
        .unwrap();

        let state = build(&dir);

        // Опечатка отвергнута, действует умолчание.
        assert_eq!(state.bindings["ctrl+d"], "edit.add-cursor-next");
        assert!(
            state.problems.iter().any(|p| p.contains("duplicate-lines")),
            "{:?}",
            state.problems
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn user_file_is_applied() {
        let dir = temp_dir("custom");
        std::fs::write(
            dir.join("keymap.toml"),
            "schema = 1\n[bindings]\n\"Ctrl+Shift+D\" = \"edit.delete-line\"\n",
        )
        .unwrap();

        let state = build(&dir);

        assert_eq!(state.bindings["ctrl+shift+d"], "edit.delete-line");
        assert!(state.problems.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
