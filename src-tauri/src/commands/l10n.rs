//! Язык окна и свои переводы (задачи 152 и 153).

use crate::l10n::{self, LanguageInfo, WindowLanguage};
use crate::state::AppState;

/// Язык, выбранный ядром при старте, и чем окну говорить: встроенная
/// таблица, которую оно грузит само, и свой перевод, если он есть.
#[tauri::command]
pub fn language() -> WindowLanguage {
    l10n::window_language()
}

/// Всё для выбора языка в окне параметров.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LanguagesState {
    pub languages: Vec<LanguageInfo>,
    /// Какой язык выбрал бы `auto` — для подписи «Как в Windows».
    pub auto: String,
    /// На каком языке процесс говорит сейчас.
    pub current: String,
    /// Папка своих переводов — показывается путём.
    pub dir: String,
}

#[tauri::command]
pub fn languages(state: tauri::State<'_, AppState>) -> LanguagesState {
    let data_dir = &state.data_dir.path;
    LanguagesState {
        languages: l10n::languages(data_dir),
        auto: l10n::auto_code(data_dir),
        current: l10n::code(),
        dir: l10n::translations_dir(data_dir).display().to_string(),
    }
}

/// Завести свой перевод и показать его в проводнике. Существующий файл
/// не переписывается никогда — это отказ со словами.
#[tauri::command]
pub fn create_translation(state: tauri::State<'_, AppState>, code: String) -> Result<String, String> {
    let path = l10n::create_translation(&state.data_dir.path, &code)?;
    crate::fsx::reveal::reveal(&path).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Открыть папку своих переводов. Её нет — создать: «открыть» не должно
/// превращаться в ошибку из-за того, что переводов ещё не было.
#[tauri::command]
pub fn open_translations_dir(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let dir = l10n::translations_dir(&state.data_dir.path);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::fsx::reveal::reveal(&dir).map_err(|e| e.to_string())
}

/// Перезапустить приложение — язык меняется только так (Р-315).
///
/// Черновики и сессию окно сбросило на диск до вызова: после перезапуска
/// всё поднимается, как после сбоя (инвариант 4), и вопросов о
/// несохранённом не нужно — ничего не теряется. Новый процесс получает
/// `--restarted` и ждёт, пока этот отпустит замок папки данных, а не
/// отдаёт ему свои пути (Р-191): иначе приложение просто закрылось бы.
#[tauri::command]
pub fn restart(app: tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| l10n::tr_with("l10n.restart.failed", &[("error", &e.to_string())]))?;
    std::process::Command::new(exe)
        .arg(crate::cli::RESTARTED)
        .spawn()
        .map_err(|e| l10n::tr_with("l10n.restart.failed", &[("error", &e.to_string())]))?;
    app.exit(0);
    Ok(())
}
