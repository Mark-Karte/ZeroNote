//! Ядро ZeroNote.
//!
//! Вся логика живёт здесь, а не в `main.rs`, чтобы её можно было подключить
//! из интеграционных тестов в `tests/` без запуска приложения.

pub mod bench;
pub mod cli;
pub mod commands;
pub mod fsx;
pub mod model;
pub mod session;
pub mod settings;
pub mod state;
pub mod text;
pub mod theme;
pub mod watch;

use state::AppState;

/// Подготовка папки с данными.
///
/// Возвращает состояние и список сообщений для пользователя. Ошибку разрешения
/// путей не превращаем в панику: приложение должно открыться и объяснить, что
/// не так, а не молча исчезнуть.
fn prepare_state() -> AppState {
    let mut notices = Vec::new();

    let data_dir = match fsx::paths::resolve() {
        Ok(dir) => {
            if !dir.portable {
                notices.push(format!(
                    "Папка рядом с приложением недоступна на запись. \
                     Настройки и черновики хранятся в {}.",
                    dir.path.display()
                ));
            }
            dir
        }
        Err(e) => {
            // Крайний случай: писать некуда вообще. Работаем на умолчаниях,
            // но говорим об этом прямо — иначе пользователь потеряет черновики,
            // не подозревая об этом.
            notices.push(format!(
                "{e}. Настройки не сохраняются, черновики не пишутся."
            ));
            fsx::paths::DataDir {
                path: std::env::temp_dir().join("ZeroNote"),
                portable: false,
            }
        }
    };

    // Образец настроек кладём при первом запуске: пустая папка ничего не
    // объясняет, а файл с комментариями — объясняет.
    if let Err(e) = settings::write_default_if_missing(&data_dir.settings_file()) {
        notices.push(format!("не удалось создать settings.toml: {e}"));
    }
    if let Err(e) = std::fs::create_dir_all(data_dir.themes_dir()) {
        notices.push(format!("не удалось создать папку тем: {e}"));
    }

    AppState {
        data_dir,
        startup_notices: notices,
        buffers: std::sync::Mutex::new(model::buffer::Buffers::new()),
    }
}

pub fn run() {
    // Первым делом — засечь момент старта, до любой другой работы,
    // иначе замер холодного старта окажется заниженным.
    bench::init();

    let app_state = prepare_state();
    let watched_dir = app_state.data_dir.path.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(move |app| {
            // `app.handle()` даёт ручку к приложению, которую можно передать
            // в другой поток. Клонируем её, потому что сам `app` остаётся здесь.
            watch::spawn(app.handle().clone(), watched_dir);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::appearance::appearance_state,
            commands::appearance::builtin_theme_source,
            commands::files::startup_paths,
            commands::files::list_buffers,
            commands::files::new_buffer,
            commands::files::open_file,
            commands::files::reload_buffer,
            commands::files::reinterpret_encoding,
            commands::files::convert_encoding,
            commands::files::set_bom,
            commands::files::set_line_ending,
            commands::files::set_modified,
            commands::files::save_buffer,
            commands::files::close_buffer,
            commands::files::reorder_buffer,
            commands::files::list_encodings,
            commands::session::save_session,
            commands::session::flush_drafts,
            commands::session::drop_draft,
            commands::session::restore_session,
            bench::bench_config,
            bench::bench_ready,
            bench::bench_gen_only,
            bench::bench_gen_text,
            bench::bench_gen_bytes,
            bench::bench_sink_text,
            bench::bench_run_open,
            bench::bench_write_report,
            bench::bench_exit,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение Tauri");
}
