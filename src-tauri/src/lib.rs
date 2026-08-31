//! Ядро ZeroNote.
//!
//! Вся логика живёт здесь, а не в `main.rs`, чтобы её можно было подключить
//! из интеграционных тестов в `tests/` без запуска приложения.

pub mod bench;
pub mod cli;
pub mod commands;
pub mod fsx;
pub mod index;
pub mod keymap;
pub mod markdown;
pub mod model;
pub mod project;
pub mod session;
pub mod settings;
pub mod state;
pub mod text;
pub mod theme;
pub mod tree;
pub mod watch;

use state::AppState;
use tauri::Manager;

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
    // Тот же приём с образцом: пустая папка ничего не объясняет,
    // а файл с комментариями объясняет.
    let keymap_file = data_dir.path.join("keymap.toml");
    if !keymap_file.exists()
        && let Err(e) = std::fs::write(&keymap_file, keymap::DEFAULT_TEMPLATE)
    {
        notices.push(format!("не удалось создать keymap.toml: {e}"));
    }
    if let Err(e) = std::fs::create_dir_all(data_dir.themes_dir()) {
        notices.push(format!("не удалось создать папку тем: {e}"));
    }

    AppState {
        data_dir,
        startup_notices: std::sync::Mutex::new(notices),
        buffers: std::sync::Mutex::new(model::buffer::Buffers::new()),
        roots: std::sync::Mutex::new(model::root::Roots::new()),
        watchers: std::sync::Mutex::new(tree::watch::Watchers::default()),
        index: std::sync::Mutex::new(index::jobs::Index::default()),
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

            // Поток-сборщик событий файловой системы. Наблюдатели за корнями
            // ставятся позже — при восстановлении сессии и при добавлении
            // папки; здесь только заводится приёмник их событий.
            let state: tauri::State<'_, AppState> = app.state();
            state
                .watchers
                .lock()
                .expect("наблюдатели повреждены")
                .start(app.handle().clone());

            // Индекс: база и рабочий поток. Без него приложение работает,
            // просто не ищет по проекту, — поэтому отказ не останавливает
            // запуск, а едет пользователю полосой предупреждений.
            let data_dir = state.data_dir.path.clone();
            let opened = state
                .index
                .lock()
                .expect("индекс повреждён")
                .start(app.handle().clone(), &data_dir);
            if let Err(message) = opened {
                state.notice(message);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::appearance::appearance_state,
            commands::appearance::builtin_theme_source,
            commands::keymap::keymap_state,
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
            commands::files::check_external,
            commands::files::accept_external,
            commands::files::mark_detached,
            commands::files::close_buffer,
            commands::files::reorder_buffer,
            commands::files::list_encodings,
            commands::roots::list_roots,
            commands::roots::add_root,
            commands::roots::remove_root,
            commands::roots::refresh_roots,
            commands::roots::create_project_file,
            commands::tree::read_children,
            commands::index::index_progress,
            commands::index::index_count,
            commands::index::cancel_index,
            commands::index::reindex_root,
            commands::index::search_project,
            commands::index::find_files,
            commands::index::resolve_link,
            commands::index::resolve_links,
            commands::index::backlinks,
            commands::index::files_with_tag,
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
            bench::bench_run_tree,
            bench::bench_run_index,
            bench::bench_write_report,
            bench::bench_exit,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение Tauri");
}
