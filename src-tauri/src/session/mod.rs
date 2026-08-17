//! Сессия и черновики — инвариант 4.
//!
//! Задача: после аварийного завершения процесса не потерять ничего. Ни правок
//! в открытых файлах, ни буферов, у которых файла на диске нет вовсе.
//!
//! Разделение на два вида файлов сознательное:
//!
//! * **`session.toml`** — маленький снимок: какие вкладки открыты, в каком
//!   порядке, какая активна, что за кодировка у каждой. Перезаписывается часто.
//! * **`drafts/<id>.draft`** — содержимое изменённых буферов, по файлу на буфер.
//!   Может быть большим, поэтому в снимок не кладётся: иначе правка одного
//!   символа в файле на десять мегабайт переписывала бы десять мегабайт.
//!
//! Черновики пишутся всегда в UTF-8, независимо от кодировки буфера. Это наши
//! служебные файлы, а не файлы пользователя: перекодировать их в cp1251 значило
//! бы рисковать потерей символов там, где рисковать нечем. Целевая кодировка
//! хранится в снимке и применяется при настоящем сохранении.

use std::path::{Path, PathBuf};

use crate::fsx::atomic_save;
use crate::fsx::text_file::DiskState;
use crate::model::buffer::BufferId;
use crate::model::root::RootId;
use crate::text::encoding::Encoding;
use crate::text::eol::Eol;

/// Версия формата сессии.
///
/// Появление корней её не подняло, и это решение Р-051: `read_session`
/// отвергает файл чужой версии целиком, то есть подъём версии означал бы
/// «при обновлении у всех молча закрылись открытые вкладки». Новое поле
/// с умолчанием обходится без этого.
pub const SESSION_SCHEMA: u32 = 1;

/// Снимок одного буфера. Содержимого здесь нет — оно в черновике.
///
/// Без `Eq`: прокрутка хранится дробным числом, а у дробных полного равенства
/// не бывает — сравнивать их на «точно то же самое» язык не разрешает.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct BufferSnapshot {
    pub id: BufferId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    pub title: String,
    pub encoding: Encoding,
    #[serde(default)]
    pub bom: bool,
    pub eol: Eol,
    #[serde(default)]
    pub eol_mixed: bool,
    #[serde(default)]
    pub modified: bool,
    #[serde(default)]
    pub large: bool,
    #[serde(default)]
    pub lossy: bool,
    #[serde(default = "yes")]
    pub encoding_confident: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disk_modified_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disk_size: Option<u64>,
    /// Для этого буфера есть черновик с несохранённым содержимым.
    #[serde(default)]
    pub has_draft: bool,
    /// Положение курсора в символах от начала.
    #[serde(default)]
    pub cursor: usize,
    /// Прокрутка в пикселях.
    #[serde(default)]
    pub scroll_top: f64,
    /// Язык подсветки, выбранный пользователем вручную.
    ///
    /// `None` — определять по имени файла. Ядро в этот выбор не вникает:
    /// подсветка живёт во фронтенде (Р-042), а сессия просто переносит его
    /// между запусками.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

fn yes() -> bool {
    true
}

impl BufferSnapshot {
    pub fn disk(&self) -> Option<DiskState> {
        self.disk_size.map(|size| DiskState {
            modified_ms: self.disk_modified_ms,
            size,
        })
    }
}

/// Снимок одного корня.
///
/// Только путь и номер: имя, правила игнорирования и всё остальное живёт
/// в `zeronote.toml` и перечитывается при запуске. Копия этих сведений
/// в файле сессии устарела бы в тот же день, когда пользователь поправил
/// файл проекта.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct RootSnapshot {
    pub id: RootId,
    pub path: PathBuf,
}

/// Снимок одного окна.
///
/// Поля-значения объявлены раньше полей-списков, и это требование формата,
/// а не вкусовщина: в TOML всё, что идёт после таблицы, принадлежит этой
/// таблице, поэтому одиночное значение после `[[buffers]]` записалось бы
/// внутрь последнего буфера.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct WorkspaceSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<BufferId>,
    /// Какой номер выдавать следующему буферу. Хранится, чтобы номера были
    /// сквозными между запусками: иначе восстановленная вкладка и новая
    /// могли бы получить один и тот же номер.
    #[serde(default)]
    pub next_id: BufferId,
    /// Какой номер выдавать следующему безымянному буферу.
    #[serde(default)]
    pub next_untitled: u32,
    /// Какой номер выдавать следующему корню.
    #[serde(default)]
    pub next_root_id: RootId,
    /// Была ли открыта боковая панель.
    #[serde(default)]
    pub sidebar: bool,
    /// Ширина панели в пикселях. Ноль — её не подгоняли, действует значение
    /// из темы. Так умолчание остаётся в одном месте — в токенах.
    #[serde(default)]
    pub sidebar_width: u32,
    /// Какая панель была показана: `tree` или `search`. Строка, а не
    /// перечисление: панелей будет больше, и файл сессии от старой версии
    /// не должен отвергаться из-за незнакомого имени.
    #[serde(default)]
    pub sidebar_panel: String,
    /// Открытые корни. Поле появилось вместе с задачей 9 и имеет умолчание:
    /// файл сессии от версии 0.1.0 обязан читаться (Р-051).
    #[serde(default)]
    pub roots: Vec<RootSnapshot>,
    /// Порядок в списке — порядок вкладок.
    #[serde(default)]
    pub buffers: Vec<BufferSnapshot>,
}

/// Файл сессии целиком.
///
/// Список окон, а не одно окно, — решение Р-005: этап 1 делает одно окно,
/// но формат готов ко второму, чтобы оно не сломало файлы у пользователей.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionFile {
    pub schema: u32,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceSnapshot>,
}

pub fn session_path(data: &Path) -> PathBuf {
    data.join("session.toml")
}

pub fn drafts_dir(data: &Path) -> PathBuf {
    data.join("drafts")
}

pub fn draft_path(data: &Path, id: BufferId) -> PathBuf {
    drafts_dir(data).join(format!("{id}.draft"))
}

/// Записать снимок сессии.
///
/// Через атомарную замену: оборванная на середине запись оставила бы файл
/// сессии испорченным, и при следующем запуске восстанавливать было бы нечего.
pub fn write_session(data: &Path, workspace: &WorkspaceSnapshot) -> Result<(), String> {
    let file = SessionFile {
        schema: SESSION_SCHEMA,
        workspaces: vec![workspace.clone()],
    };

    let text = toml::to_string_pretty(&file).map_err(|e| e.to_string())?;
    atomic_save::save(&session_path(data), text.as_bytes()).map_err(|e| e.to_string())
}

/// Прочитать снимок сессии.
///
/// Любая беда с файлом — отсутствие, порча, чужая версия формата — означает
/// «сессии нет», а не остановку запуска. Приложение обязано открыться.
pub fn read_session(data: &Path) -> Option<WorkspaceSnapshot> {
    let text = std::fs::read_to_string(session_path(data)).ok()?;
    let file: SessionFile = toml::from_str(&text).ok()?;

    if file.schema != SESSION_SCHEMA {
        return None;
    }

    file.workspaces.into_iter().next()
}

pub fn write_draft(data: &Path, id: BufferId, text: &str) -> Result<(), String> {
    let dir = drafts_dir(data);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    atomic_save::save(&draft_path(data, id), text.as_bytes()).map_err(|e| e.to_string())
}

pub fn read_draft(data: &Path, id: BufferId) -> Option<String> {
    std::fs::read_to_string(draft_path(data, id)).ok()
}

pub fn drop_draft(data: &Path, id: BufferId) {
    // Отсутствие файла — не ошибка: черновика могло и не быть.
    let _ = std::fs::remove_file(draft_path(data, id));
}

/// Удалить черновики, которым больше не соответствует ни один буфер.
///
/// Нужно после восстановления сессии: если приложение упало между записью
/// черновика и записью снимка, на диске может остаться файл, о котором никто
/// не знает. Копить их годами незачем.
pub fn prune_drafts(data: &Path, keep: &[BufferId]) {
    let Ok(entries) = std::fs::read_dir(drafts_dir(data)) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("draft") {
            continue;
        }

        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<BufferId>().ok());

        match id {
            Some(id) if keep.contains(&id) => {}
            // И осиротевшие, и файлы с непонятным именем — на выход.
            _ => {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zeronote-session-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn snapshot() -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            active: Some(2),
            next_id: 3,
            next_untitled: 2,
            next_root_id: 2,
            sidebar: true,
            sidebar_width: 280,
            sidebar_panel: "search".to_owned(),
            roots: vec![RootSnapshot {
                id: 1,
                path: PathBuf::from(r"C:\заметки"),
            }],
            buffers: vec![
                BufferSnapshot {
                    id: 1,
                    path: Some(PathBuf::from(r"C:\заметки\список дел.md")),
                    title: "список дел.md".to_owned(),
                    encoding: Encoding::Windows1251,
                    bom: false,
                    eol: Eol::CrLf,
                    eol_mixed: false,
                    modified: true,
                    large: false,
                    lossy: false,
                    encoding_confident: false,
                    disk_modified_ms: Some(1_700_000_000_000),
                    disk_size: Some(1024),
                    has_draft: true,
                    cursor: 42,
                    scroll_top: 120.5,
                    language: Some("markdown".to_owned()),
                },
                BufferSnapshot {
                    id: 2,
                    path: None,
                    title: "Без имени 1".to_owned(),
                    encoding: Encoding::Utf8,
                    bom: false,
                    eol: Eol::CrLf,
                    eol_mixed: false,
                    modified: true,
                    large: false,
                    lossy: false,
                    encoding_confident: true,
                    disk_modified_ms: None,
                    disk_size: None,
                    has_draft: true,
                    cursor: 0,
                    scroll_top: 0.0,
                    language: None,
                },
            ],
        }
    }

    /// Снимок обязан пережить запись и чтение без потерь: это и есть сессия.
    #[test]
    fn snapshot_survives_write_and_read() {
        let dir = temp_dir("roundtrip");

        write_session(&dir, &snapshot()).unwrap();
        let restored = read_session(&dir).expect("сессия должна прочитаться");

        assert_eq!(restored, snapshot());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Файл сессии от версии 0.1.0 обязан читаться: корни добавлены полем
    /// с умолчанием именно ради этого (Р-051). Подними мы версию формата —
    /// у каждого тестировщика при обновлении молча закрылись бы все вкладки.
    #[test]
    fn session_without_roots_still_opens() {
        let dir = temp_dir("old-format");
        std::fs::write(
            session_path(&dir),
            concat!(
                "schema = 1\n",
                "[[workspaces]]\n",
                "active = 1\n",
                "next-id = 2\n",
                "next-untitled = 1\n",
                "[[workspaces.buffers]]\n",
                "id = 1\n",
                "title = \"заметка.md\"\n",
                "encoding = \"utf8\"\n",
                "eol = \"cr-lf\"\n",
            ),
        )
        .unwrap();

        let restored = read_session(&dir).expect("старая сессия должна читаться");

        assert_eq!(restored.buffers.len(), 1);
        assert!(restored.roots.is_empty());
        assert!(!restored.sidebar);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Отсутствие файла сессии — обычный первый запуск, а не поломка.
    #[test]
    fn missing_session_is_not_an_error() {
        let dir = temp_dir("missing");
        assert_eq!(read_session(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Испорченный файл сессии не должен мешать приложению открыться.
    #[test]
    fn broken_session_is_ignored_not_fatal() {
        let dir = temp_dir("broken");
        std::fs::write(session_path(&dir), "это не toml = = =").unwrap();

        assert_eq!(read_session(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Сессия из будущей версии не применяется наполовину.
    #[test]
    fn future_schema_is_ignored() {
        let dir = temp_dir("future");
        std::fs::write(session_path(&dir), "schema = 99\n").unwrap();

        assert_eq!(read_session(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Черновик — обычный текст, и он обязан вернуться дословно,
    /// включая переносы строк и края.
    #[test]
    fn draft_survives_write_and_read() {
        let dir = temp_dir("draft");
        let text = "первая\nвторая\n\nчетвёртая без перевода в конце";

        write_draft(&dir, 7, text).unwrap();

        assert_eq!(read_draft(&dir, 7).as_deref(), Some(text));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dropped_draft_disappears() {
        let dir = temp_dir("drop");
        write_draft(&dir, 3, "текст").unwrap();

        drop_draft(&dir, 3);

        assert_eq!(read_draft(&dir, 3), None);
        // Повторное удаление не должно быть ошибкой.
        drop_draft(&dir, 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Черновики без буфера копиться не должны: их мог оставить сбой между
    /// записью черновика и записью снимка.
    #[test]
    fn orphan_drafts_are_pruned() {
        let dir = temp_dir("prune");
        write_draft(&dir, 1, "нужный").unwrap();
        write_draft(&dir, 2, "осиротевший").unwrap();
        std::fs::write(drafts_dir(&dir).join("мусор.draft"), "непонятное имя").unwrap();
        std::fs::write(drafts_dir(&dir).join("не-черновик.txt"), "чужой файл").unwrap();

        prune_drafts(&dir, &[1]);

        assert_eq!(read_draft(&dir, 1).as_deref(), Some("нужный"));
        assert_eq!(read_draft(&dir, 2), None);
        assert!(!drafts_dir(&dir).join("мусор.draft").exists());
        // Чужие файлы с другим расширением не трогаем.
        assert!(drafts_dir(&dir).join("не-черновик.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Пустой черновик — это тоже черновик: пользователь мог стереть всё
    /// содержимое буфера, и потерять этот факт нельзя.
    #[test]
    fn empty_draft_is_kept() {
        let dir = temp_dir("empty");
        write_draft(&dir, 5, "").unwrap();

        assert_eq!(read_draft(&dir, 5).as_deref(), Some(""));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
