// В релизной сборке приложение не должно открывать окно консоли.
// В отладочной консоль нужна — туда идут логи и вывод паник.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    zeronote_lib::run();
}
