//! Работа с файловой системой: разрешение путей, атомарное сохранение,
//! отслеживание внешних изменений.

pub mod atomic_save;
pub mod paths;
pub mod reveal;
pub mod text_file;
