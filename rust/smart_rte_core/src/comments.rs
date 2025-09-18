//! Comment thread model anchored to text ranges or table cells.

use serde::{Deserialize, Serialize};
use crate::selection::SelectionRange;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommentThread {
    pub id: String,
    pub resolved: bool,
    pub messages: Vec<CommentMessage>,
    pub anchor: Option<SelectionRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentMessage {
    pub author: String,
    pub text: String,
    pub ts_ms: i64,
}

impl CommentThread {
    pub fn new(id: String, anchor: Option<SelectionRange>) -> Self {
        Self { id, resolved: false, messages: Vec::new(), anchor }
    }

    pub fn add_message(&mut self, author: String, text: String, ts_ms: i64) {
        self.messages.push(CommentMessage { author, text, ts_ms });
    }

    pub fn set_resolved(&mut self, resolved: bool) { self.resolved = resolved; }
}


