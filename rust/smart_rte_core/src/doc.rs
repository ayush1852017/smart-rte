//! Document tree structures and helpers.

use serde::{Deserialize, Serialize};
use crate::comments::CommentThread;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Doc {
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub threads: Vec<CommentThread>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Node {
    Paragraph { text: String, #[serde(skip_serializing_if = "Option::is_none")] spans: Option<Vec<InlineSpan>> },
    Heading { level: u8, text: String, #[serde(skip_serializing_if = "Option::is_none")] spans: Option<Vec<InlineSpan>> },
    Table(Table),
    Image { src: String, alt: String },
    Media { key: String, content_type: String },
    FormulaInline { tex: String },
    FormulaBlock { tex: String },
    CommentAnchor { thread_id: String },
}

impl Default for Node {
    fn default() -> Self {
        Node::Paragraph { text: String::new(), spans: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InlineStyle {
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub underline: bool,
    #[serde(default)]
    pub code: bool,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InlineSpan {
    pub text: String,
    #[serde(default)]
    pub style: InlineStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Table {
    pub rows: Vec<TableRow>,
    pub freeze_header: bool,
    pub freeze_first_col: bool,
    /// Optional per-column widths in pixels. If empty, use auto layout.
    #[serde(default)]
    pub column_widths: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TableRow {
    pub cells: Vec<TableCell>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TableCell {
    pub text: String,
    pub colspan: u32,
    pub rowspan: u32,
    pub style: CellStyle,
    /// When true, this cell is a placeholder covered by a spanning cell.
    /// The renderer should skip drawing it.
    #[serde(default)]
    pub placeholder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CellStyle {
    pub background: Option<String>,
    pub border: Option<BorderStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BorderStyle {
    pub color: String,
    pub width_px: u32,
}
