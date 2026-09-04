//! Слой команд: маршалинг между фронтендом и ядром.
//!
//! Здесь не должно быть логики — только вызовы `text/`, `fsx/`, `model/`,
//! `theme/`, `settings/`. Это не стилистическое требование: логика, вынесенная
//! из команд, тестируется обычным `cargo test` без запуска приложения.

pub mod about;
pub mod appearance;
pub mod entries;
pub mod files;
pub mod index;
pub mod keymap;
pub mod roots;
pub mod session;
pub mod settings;
pub mod tree;
