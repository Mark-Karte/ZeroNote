//! Показать файл или папку в проводнике Windows.
//!
//! Единственное место в проекте, откуда запускается чужая программа. Ничего
//! не читаем и не пишем: только просим проводник открыться в нужном месте.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::process::Command;

use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

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

/// Адрес страницы «Приложения по умолчанию» с карточкой ZeroNote.
///
/// Имя `ZeroNote` — то же, что установщик пишет в `RegisteredApplications`
/// (Р-190). Если приложение не установлено — например, запущено из сборки
/// разработчика, — Windows откроет общий список: это разумный запасной путь,
/// а не ошибка.
const DEFAULT_APPS: &str = "ms-settings:defaultapps?registeredAppUser=ZeroNote";

/// Открыть страницу «Приложения по умолчанию».
///
/// Единственный честный способ стать умолчанием для `.md` — назначает его
/// человек (Р-190), а наше дело довести до нужной страницы одним нажатием.
pub fn default_apps() -> Result<(), String> {
    // Не `explorer.exe`, и это выяснилось на живом окне: адрес `ms-settings:`
    // проводник открывать не умеет — ни в кавычках, ни без них. Он принимает
    // его за путь и молча показывает «Документы», ровно как с несуществующим
    // путём. Правильный способ запустить адрес по его протоколу — `ShellExecuteW`,
    // и это шестой `unsafe` в проекте.
    let verb: Vec<u16> = OsStr::new("open").encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = OsStr::new(DEFAULT_APPS).encode_wide().chain(Some(0)).collect();

    // Указатели на живые векторы с нулём на конце; оба живут до конца функции.
    // Окна-владельца нет — оболочка откроет своё.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };

    // Единственная функция Windows с таким соглашением: возвращается не
    // дескриптор, а число, и успехом считается всё, что больше 32. Так
    // написано в документации, и никакой логики за этим нет — только история.
    if result as isize > 32 {
        Ok(())
    } else {
        Err(format!(
            "не удалось открыть параметры Windows (код {})",
            result as isize
        ))
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
