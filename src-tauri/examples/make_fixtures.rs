//! Создаёт эталонные файлы в `tests/fixtures/`.
//!
//!     cargo run --example make_fixtures
//!
//! Файлы кладутся в репозиторий и служат образцом «чужого файла»: тест
//! `tests/roundtrip.rs` открывает каждый и сохраняет обратно, требуя полного
//! совпадения байтов.
//!
//! Генератор существует, чтобы набор можно было воспроизвести и расширить,
//! а не потому, что файлы пересоздаются при каждой сборке. Перезаписывать
//! их без причины не нужно: они и есть эталон.
//!
//! Важно: `.gitattributes` содержит `* -text`, поэтому git не тронет переносы
//! строк в этих файлах. Без этого эталоны перестали бы быть эталонами.

use std::fs;
use std::path::Path;

use zeronote_lib::text::encoding::{encode, Encoding};

const RUSSIAN: &str = "Съешь же ещё этих мягких французских булок, да выпей чаю";
const SECOND: &str = "Вторая строка с числами 1234 и знаками «кавычки» — тире";
const THIRD: &str = "Третья строка";

/// У IBM866 и KOI8-R в местах, где у windows-1251 кавычки-ёлочки и длинное
/// тире, стоит псевдографика. Это не недоработка эталона, а свойство кодировок:
/// для них берём текст без знаков, которых в них попросту нет.
const SECOND_PLAIN: &str = "Вторая строка с числами 1234 и обычной пунктуацией.";

fn body(eol: &str, final_newline: bool) -> String {
    compose(SECOND, eol, final_newline)
}

fn plain_body(eol: &str, final_newline: bool) -> String {
    compose(SECOND_PLAIN, eol, final_newline)
}

fn compose(second: &str, eol: &str, final_newline: bool) -> String {
    let mut text = format!("{RUSSIAN}{eol}{second}{eol}{THIRD}");
    if final_newline {
        text.push_str(eol);
    }
    text
}

fn write(dir: &Path, name: &str, bytes: &[u8]) {
    let path = dir.join(name);
    fs::write(&path, bytes).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    println!("{name}: {} байт", bytes.len());
}

fn write_text(dir: &Path, name: &str, text: &str, encoding: Encoding, bom: bool) {
    let mut bytes = if bom {
        encoding.bom_bytes().to_vec()
    } else {
        Vec::new()
    };
    bytes.extend_from_slice(&encode(text, encoding).unwrap_or_else(|e| panic!("{name}: {e}")));
    write(dir, name, &bytes);
}

fn main() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    fs::create_dir_all(&dir).expect("не удалось создать папку эталонов");

    // UTF-8 во всех сочетаниях метки, переносов и финальной строки.
    write_text(&dir, "utf8-lf.md", &body("\n", true), Encoding::Utf8, false);
    write_text(
        &dir,
        "utf8-crlf-no-final-newline.md",
        &body("\r\n", false),
        Encoding::Utf8,
        false,
    );
    write_text(
        &dir,
        "utf8-bom-crlf.md",
        &body("\r\n", true),
        Encoding::Utf8,
        true,
    );

    // UTF-16 с меткой и без.
    write_text(
        &dir,
        "utf16le-bom-crlf.txt",
        &body("\r\n", true),
        Encoding::Utf16Le,
        true,
    );
    write_text(
        &dir,
        "utf16be-bom-lf.txt",
        &body("\n", true),
        Encoding::Utf16Be,
        true,
    );
    write_text(
        &dir,
        "utf16le-nobom-crlf.txt",
        &body("\r\n", true),
        Encoding::Utf16Le,
        false,
    );

    // Однобайтовые.
    write_text(
        &dir,
        "cp1251-crlf.txt",
        &body("\r\n", true),
        Encoding::Windows1251,
        false,
    );
    write_text(
        &dir,
        "cp866-crlf.txt",
        &plain_body("\r\n", true),
        Encoding::Ibm866,
        false,
    );
    write_text(
        &dir,
        "koi8r-lf.txt",
        &plain_body("\n", true),
        Encoding::Koi8R,
        false,
    );
    write_text(
        &dir,
        "cp1252-crlf.txt",
        "Voilà, ça marche déjà!\r\nÜber den Größen — año pasado.\r\n",
        Encoding::Windows1252,
        false,
    );

    // Переносы и края.
    write_text(
        &dir,
        "cr-only.txt",
        &body("\r", true),
        Encoding::Utf8,
        false,
    );
    write(
        &dir,
        "ascii-no-final-newline.txt",
        b"fn main() {\r\n    println!(\"hello\");\r\n}",
    );
    write(&dir, "empty.txt", b"");
    write(&dir, "utf8-bom-only.txt", Encoding::Utf8.bom_bytes());
    write(&dir, "trailing-blank-lines.txt", b"one\r\n\r\n\r\n");

    // Frontmatter — прямо назван в инварианте 1.
    write_text(
        &dir,
        "frontmatter-crlf.md",
        "---\r\ntitle: Заметка\r\ntags: [дом, дела]\r\ndraft: false\r\n---\r\n\r\nТекст заметки.\r\n",
        Encoding::Utf8,
        false,
    );

    // Смешанные переносы: единственный файл, который байт в байт после правки
    // не переживает по построению. Тест это знает и проверяет другое.
    write(
        &dir,
        "mixed-eol.txt",
        "первая\r\nвторая\nтретья\r\nчетвёртая\n".as_bytes(),
    );

    println!("\nЭталоны записаны в {}", dir.display());
}
