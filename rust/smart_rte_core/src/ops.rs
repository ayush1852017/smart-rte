//! Commands/operations for editing.

use crate::doc::{CellStyle, Node, Table, TableCell, TableRow};
use crate::history::History;

#[derive(Debug, Default)]
pub struct OpsContext {
    pub history: History,
}

impl OpsContext {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Basic table operations applied to a vector of nodes.
pub fn insert_table(nodes: &mut Vec<Node>, rows: u32, cols: u32, ctx: &mut OpsContext) {
    let before = nodes.clone();
    let mut table = Table::default();
    table.rows = (0..rows)
        .map(|_| TableRow {
            cells: (0..cols)
                .map(|_| TableCell { text: String::new(), colspan: 1, rowspan: 1, style: CellStyle::default(), placeholder: false })
                .collect(),
        })
        .collect();
    nodes.push(Node::Table(table));
    let after = nodes.clone();
    ctx.history.record_before_change(&crate::doc::Doc { nodes: before });
    // We only store before; current doc can be undone via history.undo
    // 'after' is the live state in the caller.
    let _ = after; // silence unused warning for now
}
