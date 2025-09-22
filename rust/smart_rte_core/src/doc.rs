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
    MCQBlock(MCQBlock),
    InfoBox(InfoBox),
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
    /// CSS color hex or named color for foreground text color
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// CSS color hex or named color for text highlight (background)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
    /// Optional explicit font size in pixels
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size_px: Option<u32>,
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
    /// Optional fixed row height in pixels
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_px: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableCell {
    pub text: String,
    pub colspan: u32,
    pub rowspan: u32,
    pub style: CellStyle,
    /// When true, this cell is a placeholder covered by a spanning cell.
    /// The renderer should skip drawing it.
    #[serde(default)]
    pub placeholder: bool,
    /// Optional inline spans for rich text inside the cell
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spans: Option<Vec<InlineSpan>>,
}

impl Default for TableCell {
    fn default() -> Self {
        Self {
            text: String::new(),
            colspan: 1,
            rowspan: 1,
            style: CellStyle::default(),
            placeholder: false,
            spans: None,
        }
    }
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

impl CellStyle {
    pub fn merge(&mut self, other: &CellStyle) {
        if other.background.is_some() { self.background = other.background.clone(); }
        if other.border.is_some() { self.border = other.border.clone(); }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MCQOption {
    pub text: String,
    #[serde(default)]
    pub correct: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MCQBlock {
    pub question: String,
    #[serde(default)]
    pub options: Vec<MCQOption>,
    #[serde(default)]
    pub multiple: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InfoBox {
    pub kind: String, // info, warning, success, danger (blue/yellow/green/red)
    pub text: String,
}
