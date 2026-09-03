//! Показать файл или папку в проводнике Windows.
//!
//! Единственное место в проекте, откуда запускается чужая программа. Ничего
//! не читаем и не пишем: только просим проводник открыться в нужном месте.

use std::path::Path;
use std::process::Command;

/// Ошибка, которую видит пользователь.
#[derive(Debug)]
pub enum RevealError {
    /// Пути на диске нет: файл переименовали или удалили мимо нас.
    Missing,
    /// Проводник не запустился.
    Failed(String),
}

impl std::fmt::Display for RevealError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RevealError::Missing => write!(f, "пути больше нет на диске"),
            RevealError::Failed(why) => write!(f, "не удалось запустить проводник: {why}"),
        }
    }
}

/// Открыть проводник на этом пути.
///
/// Папка открывается сама, файл — выделенным в своей папке. Проверка
/// существования не лишняя: `explorer` на несуществующем пути молча
/// открывает «Документы», и пользователь решит, что промахнулся мимо пункта
/// меню.
pub fn reveal(path: &Path) -> Result<(), RevealError> {
    if !path.exists() {
        return Err(RevealError::Missing);
    }

    let mut command = Command::new("explorer.exe");

    if path.is_dir() {
        command.arg(path);
    } else {
        // `raw_arg`, а не `arg`: обычная передача аргумента заключает его
        // в кавычки целиком — `"/select,C:\путь\файл.md"`, — а проводник
        // такую запись не понимает и открывает «Документы». Кавычки нужны
        // вокруг пути, а не вокруг всего аргумента. Метод безопасный,
        // никакого `unsafe` здесь нет: он лишь отключает автоматическое
        // экранирование, а строку мы составляем сами.
        //
        // Кавычка внутри пути невозможна: Windows её в именах не допускает.
        use std::os::windows::process::CommandExt;
        command.raw_arg(format!("/select,\"{}\"", path.display()));
    }

    // `spawn`, а не `status`: проводник — чужое окно, и ждать его закрытия
    // нам незачем. Дескриптор процесса тут же и бросается — за жизнью
    // проводника мы не следим.
    match command.spawn() {
        Ok(_) => Ok(()),
        Err(error) => Err(RevealError::Failed(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Единственное, что здесь можно проверить без запуска проводника:
    /// несуществующий путь не должен доходить до запуска программы.
    #[test]
    fn missing_path_is_rejected() {
        let path = std::env::temp_dir().join("zeronote-нет-такого-файла-32.md");
        assert!(matches!(reveal(&path), Err(RevealError::Missing)));
    }
}
