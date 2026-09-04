//! Удаление в корзину.
//!
//! Решение Р-110: удалять **только в корзину и никогда мимо неё**. Промах
//! мышью по пункту меню обязан быть обратимым — иначе это не удаление,
//! а потеря данных по одному щелчку.
//!
//! Ловушка, ради которой этот модуль вообще написан отдельно: `SHFileOperationW`
//! с флагом «в корзину» удаляет **мимо корзины молча**, когда корзины нет
//! (сетевой диск, съёмный носитель) или когда файл в неё не помещается.
//! То есть самый опасный случай выглядит как обычный успех.
//!
//! Отсюда две меры, и обе нужны:
//!
//! 1. **Проверка до удаления.** `SHQueryRecycleBin` на том томе, где лежит
//!    файл. Нет корзины — отказ с объяснением, и ничего не тронуто.
//! 2. **Флаг `FOF_WANTNUKEWARNING`.** Он частично отменяет «без вопросов»
//!    и предупреждает ровно в том случае, когда система собралась удалить
//!    насовсем, — например, файл больше корзины. Узнать её вместимость
//!    заранее нечем, поэтому этот случай остаётся за системой: она спросит,
//!    человек ответит. Молча не удалится ничего.

use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows_sys::Win32::UI::Shell::{
    FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_WANTNUKEWARNING, FO_DELETE,
    SHFILEOPSTRUCTW, SHQUERYRBINFO, SHFileOperationW, SHQueryRecycleBinW,
};

#[derive(Debug, PartialEq, Eq)]
pub enum RecycleError {
    /// Пути на диске нет.
    Missing,
    /// На этом томе корзины нет: сетевой диск, съёмный носитель.
    NoBin,
    /// Пользователь отменил удаление в системном предупреждении.
    Cancelled,
    /// Система отказала. Код — из `SHFileOperationW`.
    Failed(i32),
}

impl std::fmt::Display for RecycleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RecycleError::Missing => write!(f, "этого файла или папки уже нет на диске"),
            RecycleError::NoBin => write!(
                f,
                "на этом диске нет корзины, а мимо корзины ZeroNote не удаляет. \
                 Удалите вручную в проводнике, если это правда нужно"
            ),
            RecycleError::Cancelled => write!(f, "удаление отменено"),
            RecycleError::Failed(code) => {
                write!(f, "система отказалась удалять, код ошибки {code}")
            }
        }
    }
}

impl std::error::Error for RecycleError {}

/// Строка в виде, который ждёт Windows: UTF-16 с нулём на конце.
fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

/// Есть ли корзина на томе, где лежит этот путь.
///
/// `SHQueryRecycleBin` спрашивают про корень тома. Для сетевого диска и для
/// носителя без корзины он возвращает не `S_OK`, и это единственный доступный
/// способ узнать заранее — до того, как файл исчезнет насовсем.
fn has_recycle_bin(path: &Path) -> bool {
    // Корень тома: `C:\` для обычного пути, `\\сервер\шара` для сетевого.
    let Some(root) = path.ancestors().last() else {
        return false;
    };

    let root_wide = wide(root);
    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        i64Size: 0,
        i64NumItems: 0,
    };

    // Третий unsafe в проекте (первые два — `ReplaceFileW` и чтение буфера
    // обмена). Что здесь может пойти не так и почему не идёт:
    //
    // * указатель ведёт на вектор, объявленный строкой выше, живой до конца
    //   этого блока, и оканчивающийся нулём — об этом заботится `wide`;
    // * `info` — обычная структура на стеке, её адрес действителен;
    // * `cbSize` заполнен: по нему система понимает версию структуры,
    //   и без него вызов вернул бы ошибку.
    let result = unsafe { SHQueryRecycleBinW(root_wide.as_ptr(), &mut info) };
    result == 0
}

/// Удалить файл или папку в корзину.
pub fn to_recycle_bin(path: &Path) -> Result<(), RecycleError> {
    if !path.exists() {
        return Err(RecycleError::Missing);
    }
    if !has_recycle_bin(path) {
        return Err(RecycleError::NoBin);
    }

    // Список путей для `SHFileOperationW` оканчивается **двумя** нулями:
    // это перечень, а не строка, и второй ноль означает его конец. Без него
    // система читала бы дальше по памяти.
    let mut from = wide(path);
    from.push(0);

    let mut op = SHFILEOPSTRUCTW {
        hwnd: std::ptr::null_mut(),
        wFunc: FO_DELETE,
        pFrom: from.as_ptr(),
        pTo: std::ptr::null(),
        // «В корзину» плюс «не спрашивать» — спросили уже мы, своим диалогом
        // (Р-093). `WANTNUKEWARNING` частично отменяет «не спрашивать»
        // и оставляет вопрос ровно там, где система собралась удалить насовсем.
        // `NOERRORUI` убирает системные окна об ошибках: сообщение показываем
        // своё, полосой предупреждений.
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_WANTNUKEWARNING | FOF_NOERRORUI) as u16,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };

    // Тот же unsafe и те же основания: указатель на живой вектор с двумя
    // нулями на конце, структура на стеке, результат проверяется сразу.
    let code = unsafe { SHFileOperationW(&mut op) };

    if code != 0 {
        return Err(RecycleError::Failed(code));
    }
    // Отмена — не ошибка системы, а ответ человека, и путать их нельзя:
    // «не удалось удалить» и «вы отказались» требуют разных слов.
    if op.fAnyOperationsAborted != 0 {
        return Err(RecycleError::Cancelled);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Единственное, что проверяется без настоящего удаления: несуществующий
    /// путь не доходит до системного вызова.
    #[test]
    fn missing_path_is_refused() {
        let path = std::env::temp_dir().join("zeronote-нет-такого-файла-38");
        assert_eq!(to_recycle_bin(&path), Err(RecycleError::Missing));
    }

    /// На системном диске корзина есть всегда. Проверка нужна не ради ответа,
    /// а ради того, что вызов не падает и не врёт: если бы он возвращал `false`
    /// на обычном диске, удаление не работало бы вовсе.
    #[test]
    fn system_drive_has_a_recycle_bin() {
        let temp = std::env::temp_dir();
        assert!(has_recycle_bin(&temp), "на диске с временной папкой должна быть корзина");
    }
}
