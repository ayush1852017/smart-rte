//! Simple undo/redo history for the document.

use crate::doc::Doc;

#[derive(Debug, Default, Clone)]
pub struct History {
    pub undo_stack: Vec<Doc>,
    pub redo_stack: Vec<Doc>,
}

impl History {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn clear(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
    }

    /// Record the current state before making a change.
    pub fn record_before_change(&mut self, current: &Doc) {
        self.undo_stack.push(current.clone());
        self.redo_stack.clear();
    }

    /// Undo into the provided doc. Returns true if a change occurred.
    pub fn undo(&mut self, doc: &mut Doc) -> bool {
        if let Some(prev) = self.undo_stack.pop() {
            let next = doc.clone();
            self.redo_stack.push(next);
            *doc = prev;
            true
        } else {
            false
        }
    }

    /// Redo into the provided doc. Returns true if a change occurred.
    pub fn redo(&mut self, doc: &mut Doc) -> bool {
        if let Some(next) = self.redo_stack.pop() {
            let prev = doc.clone();
            self.undo_stack.push(prev);
            *doc = next;
            true
        } else {
            false
        }
    }
}


