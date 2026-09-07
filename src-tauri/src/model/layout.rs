//! Дерево областей редактора (Р-207).
//!
//! Область — упорядоченный список вкладок и активная из них. Разделение —
//! два потомка, направление и доля первого. Дерево двоичное: три области
//! рядом — это два вложенных разделения, и никакой «сетки» не нужно.
//!
//! **Раскладка живёт здесь, а не во фронтенде**, по тому же доводу, что
//! и вид вкладки (Р-180): порядок вкладок, активная вкладка и активная
//! область обязаны лежать в одном месте, откуда пишется сессия. Фронтенд
//! повторяет у себя только самое простое — «добавить в активную область»
//! и «убрать из области», — а всё, что меняет форму дерева, спрашивает
//! у ядра и берёт ответ целиком.
//!
//! Один буфер может лежать в нескольких областях сразу — это зеркала (Р-209).
//! Дерево про них знает ровно одно: номер буфера встречается в нескольких
//! списках. Что при этом делать с текстом, решает фронтенд.
//!
//! Про владение. Дерево хранит потомков в `Box`: рекурсивный тип без
//! указателя компилятор не принял бы — размер узла был бы бесконечным.
//! `Box` здесь единственный владелец, ни `Rc`, ни `Arc` не нужны: дерево
//! маленькое, живёт под одной блокировкой и никому не раздаётся по ссылке
//! надолго.

use super::buffer::BufferId;

/// Номер узла — области или разделения. Одна нумерация на всё дерево:
/// фронтенду проще, когда любой узел можно назвать одним числом.
pub type NodeId = u32;

/// Как стоят потомки разделения: рядом или друг над другом.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    /// Первый слева, второй справа.
    Row,
    /// Первый сверху, второй снизу.
    Column,
}

impl Direction {
    fn as_str(self) -> &'static str {
        match self {
            Direction::Row => "row",
            Direction::Column => "column",
        }
    }

    fn parse(text: &str) -> Option<Direction> {
        match text {
            "row" => Some(Direction::Row),
            "column" => Some(Direction::Column),
            _ => None,
        }
    }
}

/// Область: список вкладок и активная.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pane {
    pub id: NodeId,
    /// Порядок в списке — порядок вкладок на полосе.
    pub tabs: Vec<BufferId>,
    pub active: Option<BufferId>,
}

/// Разделение: два потомка и доля первого.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Split {
    pub id: NodeId,
    pub direction: Direction,
    /// Доля первого потомка, от `MIN_RATIO` до `MAX_RATIO`.
    pub ratio: f64,
    pub first: Box<Node>,
    pub second: Box<Node>,
}

/// Узел дерева. Для фронтенда сериализуется с полем `kind`: JSON такое
/// умеет, а TOML — нет, поэтому у сессии свой снимок без перечислений.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Node {
    Pane(Pane),
    Split(Split),
}

/// Крайние доли разделения. Область уже десятой части окна не читается,
/// а нулевая доля — это спрятанная область, которую нельзя найти.
const MIN_RATIO: f64 = 0.1;
const MAX_RATIO: f64 = 0.9;

/// Раскладка окна целиком.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    root: Node,
    active_pane: NodeId,
    /// Какой номер выдать следующему узлу. Номера не переиспользуются:
    /// фронтенд помнит узлы по номерам, и повторный номер перепутал бы их.
    next_id: NodeId,
}

impl Default for Layout {
    fn default() -> Layout {
        Layout::single(Vec::new(), None)
    }
}

impl Layout {
    /// Одна область со списком вкладок — с этого начинается всякое окно.
    pub fn single(tabs: Vec<BufferId>, active: Option<BufferId>) -> Layout {
        let active = active.filter(|id| tabs.contains(id)).or_else(|| tabs.last().copied());
        Layout {
            root: Node::Pane(Pane {
                id: 1,
                tabs,
                active,
            }),
            active_pane: 1,
            next_id: 2,
        }
    }

    pub fn root(&self) -> &Node {
        &self.root
    }

    /// Одна область без разделений. В такой сессии раскладка не пишется
    /// вовсе — см. `to_snapshot` и запись сессии.
    pub fn is_single(&self) -> bool {
        matches!(self.root, Node::Pane(_))
    }

    /// Области слева направо и сверху вниз — в порядке обхода дерева.
    /// Этот же порядок задаёт номера для `Ctrl+1…9` (Р-210).
    pub fn panes(&self) -> Vec<&Pane> {
        let mut out = Vec::new();
        collect_panes(&self.root, &mut out);
        out
    }

    pub fn pane(&self, id: NodeId) -> Option<&Pane> {
        self.panes().into_iter().find(|pane| pane.id == id)
    }

    fn pane_mut(&mut self, id: NodeId) -> Option<&mut Pane> {
        find_pane_mut(&mut self.root, id)
    }

    pub fn active_pane_id(&self) -> NodeId {
        self.active_pane
    }

    pub fn active_pane(&self) -> &Pane {
        self.pane(self.active_pane)
            .or_else(|| self.panes().into_iter().next())
            .expect("в дереве всегда есть хотя бы одна область")
    }

    /// Активная вкладка окна — активная вкладка активной области.
    pub fn active_tab(&self) -> Option<BufferId> {
        self.active_pane().active
    }

    pub fn set_active_pane(&mut self, id: NodeId) -> bool {
        if self.pane(id).is_none() {
            return false;
        }
        self.active_pane = id;
        true
    }

    /// В каких областях лежит буфер. Больше одной — это зеркала (Р-209).
    pub fn panes_with(&self, buffer: BufferId) -> Vec<NodeId> {
        self.panes()
            .into_iter()
            .filter(|pane| pane.tabs.contains(&buffer))
            .map(|pane| pane.id)
            .collect()
    }

    /// Открыть буфер в активной области: добавить, если его там нет,
    /// и сделать активным. Возвращает номер области.
    ///
    /// Именно так себя ведут все команды открытия — файл из дерева, новый
    /// буфер, параметры. «Открыть сбоку» — это сначала другая активная
    /// область, потом обычное открытие.
    pub fn open(&mut self, buffer: BufferId) -> NodeId {
        let pane = self.active_pane;
        self.open_in(pane, buffer, None);
        pane
    }

    /// Открыть буфер в названной области, по желанию — на заданное место.
    pub fn open_in(&mut self, pane: NodeId, buffer: BufferId, at: Option<usize>) -> bool {
        let Some(target) = self.pane_mut(pane) else {
            return false;
        };

        if !target.tabs.contains(&buffer) {
            let at = at.unwrap_or(target.tabs.len()).min(target.tabs.len());
            target.tabs.insert(at, buffer);
        }
        target.active = Some(buffer);
        self.active_pane = pane;
        true
    }

    /// Сделать вкладку активной в её области — и область активной тоже:
    /// вкладку выбирают щелчком, а щелчок и есть фокус (Р-210).
    pub fn set_active_tab(&mut self, pane: NodeId, buffer: BufferId) -> bool {
        let Some(target) = self.pane_mut(pane) else {
            return false;
        };
        if !target.tabs.contains(&buffer) {
            return false;
        }
        target.active = Some(buffer);
        self.active_pane = pane;
        true
    }

    /// Переставить вкладку внутри области. Позиции за пределами списка
    /// прижимаются к краю, чтобы перетаскивание не могло уронить приложение.
    pub fn reorder(&mut self, pane: NodeId, buffer: BufferId, to: usize) -> bool {
        let Some(target) = self.pane_mut(pane) else {
            return false;
        };
        let Some(from) = target.tabs.iter().position(|id| *id == buffer) else {
            return false;
        };

        let to = to.min(target.tabs.len().saturating_sub(1));
        if from == to {
            return false;
        }

        let moved = target.tabs.remove(from);
        target.tabs.insert(to, moved);
        true
    }

    /// Убрать вкладку из одной области.
    ///
    /// Активной становится соседка справа, иначе слева. Область, оставшаяся
    /// без вкладок, закрывается сама (Р-211) — кроме последней в окне.
    pub fn remove(&mut self, pane: NodeId, buffer: BufferId) -> bool {
        let Some(target) = self.pane_mut(pane) else {
            return false;
        };
        let Some(index) = target.tabs.iter().position(|id| *id == buffer) else {
            return false;
        };

        target.tabs.remove(index);
        if target.active == Some(buffer) {
            target.active = target
                .tabs
                .get(index)
                .or_else(|| target.tabs.get(index.wrapping_sub(1)))
                .copied();
        }

        self.collapse_empty();
        true
    }

    /// Буфер закрыт совсем: убрать его отовсюду.
    pub fn remove_everywhere(&mut self, buffer: BufferId) {
        for pane in self.panes_with(buffer) {
            self.remove(pane, buffer);
        }
    }

    /// Разделить область. Новая встаёт второй — справа или снизу — и
    /// становится активной. С буфером — получает его вкладку (так `Ctrl+\`
    /// даёт зеркало текущей вкладки, как в VS Code), без — пустой.
    ///
    /// Пустая новая область не закрывается на месте: закрывается область,
    /// из которой ушла последняя вкладка, а не та, куда ещё не пришла первая.
    pub fn split(
        &mut self,
        pane: NodeId,
        direction: Direction,
        buffer: Option<BufferId>,
    ) -> Option<NodeId> {
        if self.pane(pane).is_none() {
            return None;
        }

        let split_id = self.take_id();
        let pane_id = self.take_id();
        let fresh = Pane {
            id: pane_id,
            tabs: buffer.into_iter().collect(),
            active: buffer,
        };

        replace_pane(&mut self.root, pane, |old| {
            Node::Split(Split {
                id: split_id,
                direction,
                ratio: 0.5,
                first: Box::new(Node::Pane(old)),
                second: Box::new(Node::Pane(fresh)),
            })
        });

        self.active_pane = pane_id;
        Some(pane_id)
    }

    /// Закрыть область со всеми её вкладками. Последнюю область закрыть
    /// нельзя: у окна всегда есть куда открыть файл.
    pub fn close_pane(&mut self, pane: NodeId) -> bool {
        if self.is_single() {
            return false;
        }
        let Some(target) = self.pane_mut(pane) else {
            return false;
        };

        target.tabs.clear();
        target.active = None;
        self.collapse_empty();
        true
    }

    /// Перенести вкладку из одной области в другую.
    ///
    /// Если буфер уже есть в приёмнике, он там только активируется:
    /// два зеркала в одной области не имеют смысла. Опустевший источник
    /// закрывается, как при обычном удалении.
    pub fn move_tab(
        &mut self,
        buffer: BufferId,
        from: NodeId,
        to: NodeId,
        at: Option<usize>,
    ) -> bool {
        if from == to {
            return match at {
                Some(index) => self.reorder(from, buffer, index),
                None => false,
            };
        }
        if self.pane(to).is_none() || self.pane(from).map_or(true, |p| !p.tabs.contains(&buffer)) {
            return false;
        }

        // Сначала приёмник, потом источник: удаление может схлопнуть
        // разделение, а приёмник от этого не исчезнет — он другая область.
        self.open_in(to, buffer, at);
        self.remove(from, buffer);
        self.active_pane = to;
        true
    }

    /// Подвинуть границу разделения. Доля прижимается к пределам.
    pub fn set_ratio(&mut self, split: NodeId, ratio: f64) -> bool {
        let Some(target) = find_split_mut(&mut self.root, split) else {
            return false;
        };
        target.ratio = clamp_ratio(ratio);
        true
    }

    fn take_id(&mut self) -> NodeId {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Убрать пустые области, схлопнув их разделения. Единственная область
    /// окна остаётся, даже пустая.
    fn collapse_empty(&mut self) {
        loop {
            let Some(empty) = self
                .panes()
                .into_iter()
                .find(|pane| pane.tabs.is_empty())
                .map(|pane| pane.id)
            else {
                return;
            };
            if self.is_single() {
                return;
            }

            let sibling = remove_pane(&mut self.root, empty);
            if self.active_pane == empty {
                // Фокус уходит в соседа: если сосед — тоже разделение,
                // в первую его область по порядку обхода.
                self.active_pane = sibling.unwrap_or_else(|| self.panes()[0].id);
            }
        }
    }

    // --- Снимок для сессии ---

    pub fn to_snapshot(&self) -> LayoutSnapshot {
        LayoutSnapshot {
            active_pane: self.active_pane,
            next_id: self.next_id,
            root: snapshot_of(&self.root),
        }
    }

    /// Поднять раскладку из снимка, зная, какие буферы восстановились.
    ///
    /// Читаем терпимо: неизвестный буфер выбрасывается из списка, буфер,
    /// не попавший ни в одну область, добавляется в первую (иначе он был бы
    /// открыт и невидим), пустые области схлопываются. Испорченный снимок —
    /// узел без содержимого, повторный номер, незнакомое направление — даёт
    /// `None`, и вызывающий строит одну область со всеми вкладками.
    pub fn from_snapshot(snapshot: &LayoutSnapshot, known: &[BufferId]) -> Option<Layout> {
        let mut ids = Vec::new();
        let root = node_from_snapshot(&snapshot.root, known, &mut ids)?;

        // Повторный номер узла перепутал бы области во фронтенде.
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        sorted.dedup();
        if sorted.len() != ids.len() {
            return None;
        }

        let highest = ids.iter().copied().max().unwrap_or(0);
        let mut layout = Layout {
            root,
            active_pane: snapshot.active_pane,
            next_id: snapshot.next_id.max(highest + 1),
        };

        // Буферы, которых раскладка не знает, — в первую область.
        let listed: Vec<BufferId> = layout.panes().iter().flat_map(|p| p.tabs.clone()).collect();
        let first = layout.panes()[0].id;
        for &id in known {
            if !listed.contains(&id) {
                if let Some(pane) = layout.pane_mut(first) {
                    pane.tabs.push(id);
                    if pane.active.is_none() {
                        pane.active = Some(id);
                    }
                }
            }
        }

        layout.collapse_empty();
        if layout.pane(layout.active_pane).is_none() {
            layout.active_pane = layout.panes()[0].id;
        }
        Some(layout)
    }
}

/// Снимок раскладки в сессии.
///
/// Без перечислений: TOML не умеет помеченных вариантов, и узел записан
/// парой необязательных таблиц — `pane` либо `split`. Обе сразу или
/// ни одной — испорченный снимок. Поля-значения объявлены раньше
/// полей-таблиц, иначе TOML припишет значение последней таблице.
///
/// `deny_unknown_fields` здесь нарочно нет: поле, добавленное следующей
/// версией, не должно ронять всю сессию при откате.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct LayoutSnapshot {
    #[serde(default)]
    pub active_pane: NodeId,
    #[serde(default)]
    pub next_id: NodeId,
    #[serde(default)]
    pub root: NodeSnapshot,
}

#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct NodeSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane: Option<PaneSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split: Option<SplitSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PaneSnapshot {
    #[serde(default)]
    pub id: NodeId,
    #[serde(default)]
    pub tabs: Vec<BufferId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<BufferId>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct SplitSnapshot {
    #[serde(default)]
    pub id: NodeId,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub ratio: f64,
    pub first: Box<NodeSnapshot>,
    pub second: Box<NodeSnapshot>,
}

fn snapshot_of(node: &Node) -> NodeSnapshot {
    match node {
        Node::Pane(pane) => NodeSnapshot {
            pane: Some(PaneSnapshot {
                id: pane.id,
                tabs: pane.tabs.clone(),
                active: pane.active,
            }),
            split: None,
        },
        Node::Split(split) => NodeSnapshot {
            pane: None,
            split: Some(SplitSnapshot {
                id: split.id,
                direction: split.direction.as_str().to_owned(),
                ratio: split.ratio,
                first: Box::new(snapshot_of(&split.first)),
                second: Box::new(snapshot_of(&split.second)),
            }),
        },
    }
}

fn node_from_snapshot(
    node: &NodeSnapshot,
    known: &[BufferId],
    ids: &mut Vec<NodeId>,
) -> Option<Node> {
    match (&node.pane, &node.split) {
        (Some(pane), None) => {
            ids.push(pane.id);
            let mut tabs: Vec<BufferId> = Vec::new();
            for &id in &pane.tabs {
                // Неизвестный буфер — не восстановился; повтор — порча.
                if known.contains(&id) && !tabs.contains(&id) {
                    tabs.push(id);
                }
            }
            let active = pane
                .active
                .filter(|id| tabs.contains(id))
                .or_else(|| tabs.last().copied());
            Some(Node::Pane(Pane {
                id: pane.id,
                tabs,
                active,
            }))
        }
        (None, Some(split)) => {
            ids.push(split.id);
            Some(Node::Split(Split {
                id: split.id,
                direction: Direction::parse(&split.direction)?,
                ratio: clamp_ratio(split.ratio),
                first: Box::new(node_from_snapshot(&split.first, known, ids)?),
                second: Box::new(node_from_snapshot(&split.second, known, ids)?),
            }))
        }
        _ => None,
    }
}

fn clamp_ratio(ratio: f64) -> f64 {
    if ratio.is_nan() {
        return 0.5;
    }
    ratio.clamp(MIN_RATIO, MAX_RATIO)
}

// --- Обход дерева ---
//
// Рекурсивные функции снаружи `impl`: им нужен узел, а не раскладка целиком,
// и так их можно звать для поддеревьев.

fn collect_panes<'a>(node: &'a Node, out: &mut Vec<&'a Pane>) {
    match node {
        Node::Pane(pane) => out.push(pane),
        Node::Split(split) => {
            collect_panes(&split.first, out);
            collect_panes(&split.second, out);
        }
    }
}

fn find_pane_mut(node: &mut Node, id: NodeId) -> Option<&mut Pane> {
    match node {
        Node::Pane(pane) => (pane.id == id).then_some(pane),
        Node::Split(split) => {
            find_pane_mut(&mut split.first, id).or_else(|| find_pane_mut(&mut split.second, id))
        }
    }
}

fn find_split_mut(node: &mut Node, id: NodeId) -> Option<&mut Split> {
    match node {
        Node::Pane(_) => None,
        Node::Split(split) => {
            if split.id == id {
                return Some(split);
            }
            find_split_mut(&mut split.first, id).or_else(|| find_split_mut(&mut split.second, id))
        }
    }
}

/// Заменить область узлом, построенным из неё.
///
/// Узел вынимается из дерева через `std::mem::replace` с временной
/// заглушкой: взять область по значению из-за ссылки нельзя, а собрать
/// разделение из неё — нужно. Заглушка живёт ровно до конца этой функции.
fn replace_pane(node: &mut Node, id: NodeId, build: impl FnOnce(Pane) -> Node) {
    match node {
        Node::Pane(pane) if pane.id == id => {
            let placeholder = Node::Pane(Pane {
                id: 0,
                tabs: Vec::new(),
                active: None,
            });
            let Node::Pane(old) = std::mem::replace(node, placeholder) else {
                unreachable!("только что проверили, что это область");
            };
            *node = build(old);
        }
        Node::Pane(_) => {}
        Node::Split(split) => {
            if find_pane_mut(&mut split.first, id).is_some() {
                replace_pane(&mut split.first, id, build);
            } else {
                replace_pane(&mut split.second, id, build);
            }
        }
    }
}

/// Убрать область из дерева: её разделение схлопывается в соседа.
/// Возвращает первую область соседа — туда уходит фокус.
fn remove_pane(node: &mut Node, id: NodeId) -> Option<NodeId> {
    let Node::Split(split) = node else {
        return None;
    };

    let is_first = matches!(&*split.first, Node::Pane(pane) if pane.id == id);
    let is_second = matches!(&*split.second, Node::Pane(pane) if pane.id == id);

    if is_first || is_second {
        let placeholder = Node::Pane(Pane {
            id: 0,
            tabs: Vec::new(),
            active: None,
        });
        let sibling = if is_first {
            std::mem::replace(&mut *split.second, placeholder)
        } else {
            std::mem::replace(&mut *split.first, placeholder)
        };
        let mut first_pane = Vec::new();
        collect_panes(&sibling, &mut first_pane);
        let focus = first_pane.first().map(|pane| pane.id);
        *node = sibling;
        return focus;
    }

    remove_pane(&mut split.first, id).or_else(|| remove_pane(&mut split.second, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(layout: &Layout) -> Vec<NodeId> {
        layout.panes().iter().map(|pane| pane.id).collect()
    }

    #[test]
    fn single_layout_opens_and_reorders() {
        let mut layout = Layout::new_for_test(vec![1, 2]);
        assert_eq!(layout.active_tab(), Some(2));

        layout.open(3);
        assert_eq!(layout.active_pane().tabs, vec![1, 2, 3]);
        assert_eq!(layout.active_tab(), Some(3));

        // Повторное открытие не заводит вторую вкладку, а активирует.
        layout.open(1);
        assert_eq!(layout.active_pane().tabs, vec![1, 2, 3]);
        assert_eq!(layout.active_tab(), Some(1));

        assert!(layout.reorder(1, 3, 0));
        assert_eq!(layout.active_pane().tabs, vec![3, 1, 2]);
        // Позиция за краем прижимается к краю, а не роняет.
        assert!(layout.reorder(1, 3, 99));
        assert_eq!(layout.active_pane().tabs, vec![1, 2, 3]);
    }

    #[test]
    fn removing_active_tab_moves_to_right_neighbour_then_left() {
        let mut layout = Layout::new_for_test(vec![1, 2, 3]);
        layout.set_active_tab(1, 2);

        layout.remove(1, 2);
        assert_eq!(layout.active_tab(), Some(3), "соседка справа");

        layout.remove(1, 3);
        assert_eq!(layout.active_tab(), Some(1), "справа никого — слева");

        layout.remove(1, 1);
        assert_eq!(layout.active_tab(), None);
        // Последняя область не закрывается, даже пустая.
        assert_eq!(ids(&layout), vec![1]);
    }

    #[test]
    fn split_creates_second_pane_with_mirror() {
        let mut layout = Layout::new_for_test(vec![1, 2]);

        let fresh = layout.split(1, Direction::Row, Some(2)).expect("область есть");
        assert_eq!(ids(&layout), vec![1, fresh], "новая — справа, второй по порядку");
        assert_eq!(layout.active_pane_id(), fresh);
        assert_eq!(layout.panes_with(2), vec![1, fresh], "зеркало: буфер в обеих");
        assert_eq!(layout.pane(1).unwrap().tabs, vec![1, 2], "исходная не тронута");
        assert!(!layout.is_single());
    }

    #[test]
    fn split_without_buffer_leaves_empty_pane_open() {
        let mut layout = Layout::new_for_test(vec![1]);
        let fresh = layout.split(1, Direction::Column, None).unwrap();

        assert!(layout.pane(fresh).unwrap().tabs.is_empty());
        assert_eq!(ids(&layout).len(), 2, "пустая новая область остаётся: в неё ещё откроют");
    }

    /// Область, из которой ушла последняя вкладка, схлопывается,
    /// и фокус уходит в соседа (Р-211).
    #[test]
    fn emptied_pane_collapses_into_sibling() {
        let mut layout = Layout::new_for_test(vec![1]);
        let right = layout.split(1, Direction::Row, Some(1)).unwrap();
        layout.open(2);
        assert_eq!(layout.pane(right).unwrap().tabs, vec![1, 2]);

        layout.remove(right, 1);
        layout.remove(right, 2);

        assert_eq!(ids(&layout), vec![1]);
        assert!(layout.is_single());
        assert_eq!(layout.active_pane_id(), 1, "фокус ушёл в соседа");
        assert_eq!(layout.active_tab(), Some(1));
    }

    #[test]
    fn nested_collapse_keeps_the_rest_of_the_tree() {
        let mut layout = Layout::new_for_test(vec![1]);
        let right = layout.split(1, Direction::Row, Some(1)).unwrap();
        let bottom = layout.split(right, Direction::Column, Some(1)).unwrap();
        assert_eq!(ids(&layout), vec![1, right, bottom]);

        // Убираем среднюю: разделение «right/bottom» схлопывается в bottom.
        layout.remove(right, 1);
        assert_eq!(ids(&layout), vec![1, bottom]);
        // Активной была bottom — так и осталась.
        assert_eq!(layout.active_pane_id(), bottom);
    }

    #[test]
    fn close_pane_drops_all_its_tabs_but_never_the_last_pane() {
        let mut layout = Layout::new_for_test(vec![1, 2]);
        assert!(!layout.close_pane(1), "последнюю область закрыть нельзя");

        let right = layout.split(1, Direction::Row, Some(1)).unwrap();
        layout.open(2);
        assert!(layout.close_pane(right));
        assert_eq!(ids(&layout), vec![1]);
        assert_eq!(layout.pane(1).unwrap().tabs, vec![1, 2], "левая цела");
        assert_eq!(layout.active_pane_id(), 1);
    }

    #[test]
    fn move_tab_between_panes() {
        let mut layout = Layout::new_for_test(vec![1, 2, 3]);
        let right = layout.split(1, Direction::Row, None).unwrap();

        assert!(layout.move_tab(2, 1, right, None));
        assert_eq!(layout.pane(1).unwrap().tabs, vec![1, 3]);
        assert_eq!(layout.pane(right).unwrap().tabs, vec![2]);
        assert_eq!(layout.active_pane_id(), right);
        assert_eq!(layout.active_tab(), Some(2));

        // На заданное место.
        assert!(layout.move_tab(1, 1, right, Some(0)));
        assert_eq!(layout.pane(right).unwrap().tabs, vec![1, 2]);

        // Последняя вкладка уходит — источник схлопывается.
        assert!(layout.move_tab(3, 1, right, None));
        assert_eq!(ids(&layout), vec![right]);
        assert_eq!(layout.pane(right).unwrap().tabs, vec![1, 2, 3]);
    }

    #[test]
    fn move_into_pane_that_already_mirrors_it_only_activates() {
        let mut layout = Layout::new_for_test(vec![1, 2]);
        let right = layout.split(1, Direction::Row, Some(1)).unwrap();
        layout.open(2);
        layout.set_active_tab(right, 1);

        assert!(layout.move_tab(2, 1, right, None));
        assert_eq!(layout.pane(right).unwrap().tabs, vec![1, 2], "двух зеркал в одной области нет");
        assert_eq!(layout.pane(right).unwrap().active, Some(2));
        assert_eq!(layout.pane(1).unwrap().tabs, vec![1]);
    }

    #[test]
    fn move_within_same_pane_is_reorder() {
        let mut layout = Layout::new_for_test(vec![1, 2, 3]);
        assert!(layout.move_tab(3, 1, 1, Some(0)));
        assert_eq!(layout.pane(1).unwrap().tabs, vec![3, 1, 2]);
        assert!(!layout.move_tab(3, 1, 1, None), "без места двигать некуда");
    }

    #[test]
    fn remove_everywhere_clears_mirrors() {
        let mut layout = Layout::new_for_test(vec![1, 2]);
        let right = layout.split(1, Direction::Row, Some(1)).unwrap();
        layout.open(2);

        layout.remove_everywhere(1);
        assert!(layout.panes_with(1).is_empty());
        assert_eq!(layout.pane(1).unwrap().tabs, vec![2]);
        assert_eq!(layout.pane(right).unwrap().tabs, vec![2]);
    }

    #[test]
    fn ratio_is_clamped() {
        let mut layout = Layout::new_for_test(vec![1]);
        layout.split(1, Direction::Row, None);
        let split = match layout.root() {
            Node::Split(split) => split.id,
            Node::Pane(_) => panic!("после разделения корень — разделение"),
        };

        assert!(layout.set_ratio(split, 0.0));
        let Node::Split(s) = layout.root() else { unreachable!() };
        assert_eq!(s.ratio, MIN_RATIO);
        assert!(layout.set_ratio(split, 5.0));
        let Node::Split(s) = layout.root() else { unreachable!() };
        assert_eq!(s.ratio, MAX_RATIO);
        assert!(!layout.set_ratio(999, 0.5), "нет такого разделения");
    }

    #[test]
    fn node_ids_are_never_reused() {
        let mut layout = Layout::new_for_test(vec![1]);
        let right = layout.split(1, Direction::Row, Some(1)).unwrap();
        layout.close_pane(right);
        let again = layout.split(1, Direction::Row, Some(1)).unwrap();
        assert!(again > right, "закрытая область не отдаёт номер новой");
    }

    /// Снимок обязан пережить TOML: он вложен в файл сессии.
    #[test]
    fn snapshot_survives_toml() {
        let mut layout = Layout::new_for_test(vec![1, 2, 3]);
        let right = layout.split(1, Direction::Row, Some(2)).unwrap();
        // С вкладкой, а не пустая: пустую область восстановление схлопывает,
        // и это отдельный тест.
        layout.split(right, Direction::Column, Some(3));
        layout.set_ratio(2, 0.3);

        #[derive(serde::Serialize, serde::Deserialize)]
        struct Wrapper {
            layout: LayoutSnapshot,
        }

        let text = toml::to_string_pretty(&Wrapper {
            layout: layout.to_snapshot(),
        })
        .expect("снимок пишется");
        let back: Wrapper = toml::from_str(&text).expect("снимок читается");
        let restored = Layout::from_snapshot(&back.layout, &[1, 2, 3]).expect("снимок цел");

        assert_eq!(restored, layout);
    }

    #[test]
    fn snapshot_drops_unknown_buffers_and_adds_unlisted() {
        let mut layout = Layout::new_for_test(vec![1, 2]);
        layout.split(1, Direction::Row, Some(2));

        // Буфер 2 не восстановился, буфер 7 восстановился, но в раскладке
        // его нет.
        let restored = Layout::from_snapshot(&layout.to_snapshot(), &[1, 7]).unwrap();

        assert_eq!(ids(&restored), vec![1], "правая область осталась пустой и схлопнулась");
        assert_eq!(restored.pane(1).unwrap().tabs, vec![1, 7]);
        assert_eq!(restored.active_pane_id(), 1);
    }

    #[test]
    fn broken_snapshot_is_rejected_not_half_applied() {
        // Узел без содержимого.
        let empty = LayoutSnapshot::default();
        assert!(Layout::from_snapshot(&empty, &[1]).is_none());

        // Незнакомое направление.
        let mut layout = Layout::new_for_test(vec![1]);
        layout.split(1, Direction::Row, Some(1));
        let mut snapshot = layout.to_snapshot();
        snapshot.root.split.as_mut().unwrap().direction = "diagonal".to_owned();
        assert!(Layout::from_snapshot(&snapshot, &[1]).is_none());

        // Повторный номер узла.
        let mut snapshot = layout.to_snapshot();
        snapshot.root.split.as_mut().unwrap().second.pane.as_mut().unwrap().id = 1;
        assert!(Layout::from_snapshot(&snapshot, &[1]).is_none());
    }

    #[test]
    fn snapshot_of_single_pane_reads_back_as_single() {
        let layout = Layout::new_for_test(vec![3, 1]);
        let restored = Layout::from_snapshot(&layout.to_snapshot(), &[1, 3]).unwrap();
        assert!(restored.is_single());
        assert_eq!(restored.pane(1).unwrap().tabs, vec![3, 1], "порядок из снимка, не из списка");
    }

    impl Layout {
        /// Одна область с этими вкладками, активна последняя.
        fn new_for_test(tabs: Vec<BufferId>) -> Layout {
            Layout::single(tabs, None)
        }
    }
}
