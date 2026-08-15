//! Ядро ZeroNote.
//!
//! Вся логика живёт здесь, а не в `main.rs`, чтобы её можно было подключить
//! из интеграционных тестов в `tests/` без запуска приложения.

pub mod bench;

pub fn run() {
    // Первым делом — засечь момент старта, до любой другой работы,
    // иначе замер холодного старта окажется заниженным.
    bench::init();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            bench::bench_config,
            bench::bench_ready,
            bench::bench_gen_only,
            bench::bench_gen_text,
            bench::bench_gen_bytes,
            bench::bench_sink_text,
            bench::bench_write_report,
            bench::bench_exit,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение Tauri");
}
