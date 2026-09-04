//! Работа с файловой системой: разрешение путей, атомарное сохранение,
//! отслеживание внешних изменений.

pub mod atomic_save;
pub mod entry_ops;
pub mod link_edit;
pub mod paths;
pub mod recycle;
pub mod reveal;
pub mod text_file;
