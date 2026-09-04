//! Команды раскладки: отдать готовую и записать переназначение.
//!
//! Логики здесь нет: разбор и сборка — в `keymap/mod.rs`, правка файла
//! с сохранением комментариев — в `keymap/edit.rs`, запись — в
//! `fsx/atomic_save.rs`. Здесь только сведение их вместе, как и в командах
//! настроек.

use std::collections::BTreeMap;

use crate::fsx::atomic_save;
use crate::keymap::{self, edit};
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
#[serde(rename_all = "camelCase")]
pub struct CommandInfo {
    pub id: String,
    pub title: String,
    /// Чем команда нажимается сейчас. Обычно одно сочетание, но бывает
    /// и два: «перейти к парной скобке» — `Ctrl+Alt+B` и `Ctrl+Shift+\`.
    /// Пусто — команда доступна только из палитры и меню.
    pub bindings: Vec<String>,
    /// Чем она нажималась бы без файла пользователя. Редактор клавиш
    /// сравнивает одно с другим, чтобы показать «изменено» и предложить сброс:
    /// иначе ему пришлось бы держать свою копию умолчаний и расходиться с ней.
    pub defaults: Vec<String>,
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

    let commands = keymap::COMMANDS
        .iter()
        .map(|(id, title)| CommandInfo {
            id: (*id).to_owned(),
            title: (*title).to_owned(),
            bindings: bindings
                .iter()
                .filter(|(_, command)| command.as_str() == *id)
                .map(|(binding, _)| binding.clone())
                .collect(),
            defaults: edit::defaults_for(id),
        })
        .collect();

    KeymapState {
        bindings,
        commands,
        problems,
    }
}

#[tauri::command]
pub fn keymap_state(state: tauri::State<'_, AppState>) -> KeymapState {
    build(&state.data_dir.path)
}

fn keymap_path(state: &AppState) -> std::path::PathBuf {
    state.data_dir.path.join("keymap.toml")
}

/// Прочитать файл раскладки для правки.
///
/// Файла может не быть — тогда правится образец, а не пустота: иначе первое
/// же переназначение из окна оставило бы файл без единого пояснения. Так же
/// устроены и настройки.
///
/// А вот испорченный файл не правится вовсе (Р-089). Мы не знаем, что именно
/// в нём сломано, и запись поверх стёрла бы то, что человек не дописал.
fn source_for_edit(state: &AppState) -> Result<String, String> {
    match std::fs::read_to_string(keymap_path(state)) {
        Ok(source) => match keymap::parse(&source) {
            Ok(_) => Ok(source),
            Err(e) => Err(format!("файл раскладки не разбирается, правка отменена: {e}")),
        },
        Err(_) => Ok(keymap::DEFAULT_TEMPLATE.to_owned()),
    }
}

/// Записать итог правки и вернуть заново собранную раскладку.
///
/// Раскладка возвращается, а не ожидается от слежения за файлами: событие
/// придёт и так, но с задержкой в полсекунды, и всё это время окно параметров
/// показывало бы вчерашнее сочетание рядом с только что нажатым.
fn write(state: &AppState, updated: String) -> Result<KeymapState, String> {
    // Итог обязан разбираться и собираться нашим же кодом. Проверка не лишняя:
    // правка могла оказаться верной по TOML и неверной по смыслу.
    let file = keymap::parse(&updated).map_err(|e| e.to_string())?;
    keymap::resolve(Some(&file)).map_err(|e| e.to_string())?;

    atomic_save::save(&keymap_path(state), updated.as_bytes()).map_err(|e| e.to_string())?;

    Ok(build(&state.data_dir.path))
}

/// Назначить команде сочетание. `binding = null` — снять вовсе.
#[tauri::command]
pub fn set_binding(
    state: tauri::State<'_, AppState>,
    command: String,
    binding: Option<String>,
) -> Result<KeymapState, String> {
    let source = source_for_edit(&state)?;
    let updated =
        edit::assign(&source, &command, binding.as_deref()).map_err(|e| e.to_string())?;
    write(&state, updated)
}

/// Вернуть команде умолчание.
#[tauri::command]
pub fn reset_binding(
    state: tauri::State<'_, AppState>,
    command: String,
) -> Result<KeymapState, String> {
    let source = source_for_edit(&state)?;
    let updated = edit::reset(&source, &command).map_err(|e| e.to_string())?;
    write(&state, updated)
}

/// Убрать все переназначения разом.
#[tauri::command]
pub fn reset_keymap(state: tauri::State<'_, AppState>) -> Result<KeymapState, String> {
    let source = source_for_edit(&state)?;
    let updated = edit::reset_all(&source).map_err(|e| e.to_string())?;
    write(&state, updated)
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
