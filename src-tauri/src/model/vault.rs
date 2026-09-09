//! Хранилище заметок — дом для записей, живущий рядом с проектами.
//!
//! Здесь только правила выбора путей, и они чистые: где лежит хранилище
//! и где внутри него ежедневная заметка. Приведение реестра корней
//! в согласие с настройкой — в `commands/roots.rs`, работа с диском — там же.
//!
//! Хранилище — это папка, назначенная человеком (часто хранилище Obsidian);
//! пока не назначена, ею служит `notes` в папке данных приложения. Второе
//! отличается от первого только происхождением пути: дальше это обычная
//! папка, которую приложение открывает корнем.

use std::path::{Path, PathBuf};

/// Где лежит хранилище заметок.
///
/// Пустая настройка означает папку данных приложения: дом обязан быть
/// у человека, который ничего не настраивал, — иначе панель «Заметки»
/// открывалась бы приглашением выбрать папку, а «Заметка на сегодня»
/// не работала бы вовсе.
pub fn path_of(setting: &str, data_dir: &Path) -> PathBuf {
    let trimmed = setting.trim();
    if trimmed.is_empty() {
        data_dir.join("notes")
    } else {
        PathBuf::from(trimmed)
    }
}

/// Куда класть ежедневную заметку.
///
/// Настройка `daily_folder` относительна хранилищу — как в Obsidian, где
/// папка ежедневных заметок называется путём внутри хранилища. Пусто —
/// корень хранилища. Абсолютный путь остаётся абсолютным: до задачи 94
/// настройка означала именно его, и файлы человека, настроившего её
/// на этапе 13, обязаны остаться там же, где лежали.
pub fn daily_folder(setting: &str, vault: &Path) -> PathBuf {
    let trimmed = setting.trim();
    if trimmed.is_empty() {
        return vault.to_path_buf();
    }

    let named = Path::new(trimmed);
    if named.is_absolute() {
        named.to_path_buf()
    } else {
        vault.join(named)
    }
}

/// Куда положены шаблоны.
///
/// Правило то же, что у папки ежедневных заметок: имя относительно
/// хранилища, абсолютный путь — сам по себе. Пусто означает «шаблонов нет»,
/// а не «весь дом», — иначе шаблоном стала бы каждая заметка.
pub fn templates_folder(setting: &str, vault: &Path) -> Option<PathBuf> {
    let trimmed = setting.trim();
    if trimmed.is_empty() {
        return None;
    }

    let named = Path::new(trimmed);
    Some(if named.is_absolute() {
        named.to_path_buf()
    } else {
        vault.join(named)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> PathBuf {
        PathBuf::from(r"C:\ZeroNote\data")
    }

    #[test]
    fn empty_setting_means_the_data_folder() {
        assert_eq!(path_of("", &data()), PathBuf::from(r"C:\ZeroNote\data\notes"));
        assert_eq!(
            path_of("   ", &data()),
            PathBuf::from(r"C:\ZeroNote\data\notes")
        );
    }

    #[test]
    fn a_named_folder_wins() {
        assert_eq!(
            path_of(r"D:\Хранилище", &data()),
            PathBuf::from(r"D:\Хранилище")
        );
    }

    #[test]
    fn daily_folder_is_relative_to_the_vault() {
        let vault = PathBuf::from(r"D:\Хранилище");
        assert_eq!(daily_folder("", &vault), vault);
        assert_eq!(
            daily_folder("Дневник", &vault),
            PathBuf::from(r"D:\Хранилище\Дневник")
        );
        assert_eq!(
            daily_folder(r"Дневник\2026", &vault),
            PathBuf::from(r"D:\Хранилище\Дневник\2026")
        );
    }

    /// Пустая настройка выключает шаблоны совсем: папка шаблонов в корне
    /// хранилища сделала бы заготовкой каждую заметку.
    #[test]
    fn templates_are_off_until_named() {
        let vault = PathBuf::from(r"D:\Хранилище");
        assert_eq!(templates_folder("", &vault), None);
        assert_eq!(
            templates_folder("Шаблоны", &vault),
            Some(PathBuf::from(r"D:\Хранилище\Шаблоны"))
        );
        assert_eq!(
            templates_folder(r"E:\Общие шаблоны", &vault),
            Some(PathBuf::from(r"E:\Общие шаблоны"))
        );
    }

    /// Настройка этапа 13 означала абсолютный путь, и он таким и остаётся:
    /// иначе у человека, задавшего `D:\Заметки`, команда начала бы создавать
    /// файлы в `<хранилище>\D:\Заметки`.
    #[test]
    fn an_absolute_daily_folder_stays_where_it_was() {
        let vault = PathBuf::from(r"D:\Хранилище");
        assert_eq!(
            daily_folder(r"E:\Дневник", &vault),
            PathBuf::from(r"E:\Дневник")
        );
    }
}
