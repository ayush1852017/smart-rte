//! HTML/Markdown/JSON import/export.

use crate::doc::{Doc, Node, Table, TableCell, InlineSpan, InlineStyle};
use serde_json::{json, Value};

pub fn to_html(doc: &Doc) -> String {
    let mut out = String::new();
    out.push_str("<div class=\"doc\">\n");
    for n in &doc.nodes {
        match n {
            Node::Paragraph { text, spans } => {
                out.push_str("  <p>");
                if let Some(sp) = spans {
                    out.push_str(&render_spans_html(sp));
                } else {
                    out.push_str(&html_escape::encode_text(text));
                }
                out.push_str("</p>\n");
            }
            Node::Heading { level, text, spans } => {
                let lvl = (*level).clamp(1, 6);
                out.push_str(&format!("  <h{lvl}>", lvl = lvl));
                if let Some(sp) = spans {
                    out.push_str(&render_spans_html(sp));
                } else {
                    out.push_str(&html_escape::encode_text(text));
                }
                out.push_str(&format!("</h{lvl}>\n", lvl = lvl));
            }
            Node::Table(t) => {
                out.push_str("  <table data-smart>\n");
                for row in &t.rows {
                    out.push_str("    <tr>\n");
                    for cell in &row.cells {
                        if cell.placeholder { continue; }
                        let mut attrs = String::new();
                        if cell.colspan > 1 { attrs.push_str(&format!(" colspan=\"{}\"", cell.colspan)); }
                        if cell.rowspan > 1 { attrs.push_str(&format!(" rowspan=\"{}\"", cell.rowspan)); }
                        if let Some(bg) = &cell.style.background {
                            attrs.push_str(&format!(" style=\"background:{}\"", html_escape::encode_double_quoted_attribute(bg)));
                        }
                        out.push_str(&format!(
                            "      <td{}>{}</td>\n",
                            attrs,
                            html_escape::encode_text(&cell.text)
                        ));
                    }
                    out.push_str("    </tr>\n");
                }
                out.push_str("  </table>\n");
            }
            Node::Image { src, alt } => {
                out.push_str(&format!(
                    "  <img src=\"{}\" alt=\"{}\"/>\n",
                    html_escape::encode_double_quoted_attribute(src),
                    html_escape::encode_double_quoted_attribute(alt)
                ));
            }
            Node::Media { key, content_type } => {
                out.push_str(&format!(
                    "  <div data-media key=\"{}\" type=\"{}\"></div>\n",
                    html_escape::encode_double_quoted_attribute(key),
                    html_escape::encode_double_quoted_attribute(content_type)
                ));
            }
            Node::FormulaInline { tex } => {
                out.push_str(&format!("  <span class=\"formula-inline\">{}</span>\n", html_escape::encode_text(tex)));
            }
            Node::FormulaBlock { tex } => {
                out.push_str(&format!("  <div class=\"formula-block\">{}</div>\n", html_escape::encode_text(tex)));
            }
            Node::CommentAnchor { thread_id } => {
                out.push_str(&format!(
                    "  <sup data-comment=\"{}\"></sup>\n",
                    html_escape::encode_double_quoted_attribute(thread_id)
                ));
            }
        }
    }
    out.push_str("</div>");
    out
}

fn render_spans_html(spans: &Vec<InlineSpan>) -> String {
    let mut s = String::new();
    for span in spans {
        let mut inner = html_escape::encode_text(&span.text).to_string();
        if span.style.code {
            inner = format!("<code>{}</code>", inner);
        }
        if span.style.underline {
            inner = format!("<u>{}</u>", inner);
        }
        if span.style.italic {
            inner = format!("<em>{}</em>", inner);
        }
        if span.style.bold {
            inner = format!("<strong>{}</strong>", inner);
        }
        if let Some(href) = &span.style.link {
            inner = format!(
                "<a href=\"{}\">{}</a>",
                html_escape::encode_double_quoted_attribute(href),
                inner
            );
        }
        s.push_str(&inner);
    }
    s
}

pub fn to_markdown(doc: &Doc) -> String {
    let mut out = String::new();
    for (idx, n) in doc.nodes.iter().enumerate() {
        match n {
            Node::Paragraph { text, spans } => {
                let line = if let Some(sp) = spans { render_spans_md(sp) } else { text.clone() };
                out.push_str(&line);
                out.push_str("\n\n");
            }
            Node::Heading { level, text, spans } => {
                let lvl = (*level).clamp(1, 6) as usize;
                let hashes = "#".repeat(lvl);
                let line = if let Some(sp) = spans { render_spans_md(sp) } else { text.clone() };
                out.push_str(&format!("{} {}\n\n", hashes, line));
            }
            Node::Table(t) => {
                if has_span_cells(t) {
                    // Fallback to HTML if complex spans present
                    out.push_str(&to_html(&Doc { nodes: vec![n.clone()] }));
                    out.push_str("\n\n");
                } else {
                    out.push_str(&table_to_gfm(t));
                    out.push_str("\n\n");
                }
            }
            Node::Image { src, alt } => {
                out.push_str(&format!("![{}]({})\n\n", alt, src));
            }
            Node::Media { key, content_type } => {
                // No standard MD; emit HTML placeholder
                out.push_str(&format!("<div data-media key=\"{}\" type=\"{}\"></div>\n\n", key, content_type));
            }
            Node::FormulaInline { tex } => {
                out.push_str(&format!("${}$\n\n", tex));
            }
            Node::FormulaBlock { tex } => {
                out.push_str("$$\n");
                out.push_str(tex);
                out.push_str("\n$$\n\n");
            }
            Node::CommentAnchor { .. } => {
                // Skip in MD output for now
            }
        }
        if idx == doc.nodes.len() - 1 {
            // Trim trailing blank lines by breaking if necessary; handled after loop if needed
        }
    }
    // Normalize: remove extra trailing newlines
    while out.ends_with('\n') { out.pop(); }
    out.push('\n');
    out
}

fn has_span_cells(t: &Table) -> bool {
    for r in &t.rows {
        for c in &r.cells {
            if c.colspan > 1 || c.rowspan > 1 { return true; }
        }
    }
    false
}

fn table_to_gfm(t: &Table) -> String {
    let mut out = String::new();
    if t.rows.is_empty() { return out; }
    // Header row
    let header = &t.rows[0];
    out.push_str(&gfm_row(header));
    out.push_str(&gfm_separator_row(header));
    // Body rows
    for r in t.rows.iter().skip(1) {
        out.push_str(&gfm_row(r));
    }
    out
}

fn gfm_row(row: &crate::doc::TableRow) -> String {
    let mut line = String::new();
    line.push('|');
    for (i, cell) in row.cells.iter().enumerate() {
        if cell.placeholder { continue; }
        if i > 0 { /* separators handled by leading '|' */ }
        let txt = cell.text.trim();
        line.push(' ');
        line.push_str(&escape_md_cell_text(txt));
        line.push(' ');
        line.push('|');
    }
    line.push('\n');
    line
}

fn gfm_separator_row(row: &crate::doc::TableRow) -> String {
    let mut line = String::new();
    line.push('|');
    for _cell in &row.cells {
        line.push(' ');
        line.push_str("---");
        line.push(' ');
        line.push('|');
    }
    line.push('\n');
    line
}

fn escape_md_cell_text(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        match ch {
            '|' => out.push_str("\\|"),
            '\\' => out.push_str("\\\\"),
            _ => out.push(ch),
        }
    }
    out
}

fn render_spans_md(spans: &Vec<InlineSpan>) -> String {
    let mut out = String::new();
    for span in spans {
        let mut txt = span.text.clone();
        // Escape MD special chars that may break formatting
        txt = txt.replace('*', "\\*").replace('_', "\\_");
        let mut wrapped = txt;
        if span.style.code {
            wrapped = format!("`{}`", wrapped);
        }
        if span.style.bold {
            wrapped = format!("**{}**", wrapped);
        }
        if span.style.italic {
            wrapped = format!("_{}_", wrapped);
        }
        if span.style.underline {
            // No native MD underline; use HTML
            wrapped = format!("<u>{}</u>", wrapped);
        }
        if let Some(href) = &span.style.link {
            wrapped = format!("[{}]({})", wrapped, href);
        }
        out.push_str(&wrapped);
    }
    out
}

pub fn from_json(json: &str) -> serde_json::Result<Doc> {
    serde_json::from_str(json)
}

pub fn to_quill_delta(doc: &Doc) -> Value {
    // Delta: array of ops with insert and attributes
    let mut ops: Vec<Value> = Vec::new();
    for n in &doc.nodes {
        match n {
            Node::Paragraph { text, spans } => {
                push_spans_as_delta(&mut ops, spans.as_ref().map(|v| v.as_slice()), text);
                ops.push(json!({"insert":"\n"}));
            }
            Node::Heading { level, text, spans } => {
                push_spans_as_delta(&mut ops, spans.as_ref().map(|v| v.as_slice()), text);
                ops.push(json!({"insert":"\n", "attributes": {"header": (*level as u32).min(6)}}));
            }
            Node::Image { src, alt: _ } => {
                ops.push(json!({"insert": {"image": src}}));
                ops.push(json!({"insert":"\n"}));
            }
            Node::FormulaInline { tex } => {
                ops.push(json!({"insert": {"formula": tex}}));
            }
            Node::FormulaBlock { tex } => {
                ops.push(json!({"insert": {"formula": tex}}));
                ops.push(json!({"insert":"\n"}));
            }
            Node::Table(_) | Node::Media { .. } | Node::CommentAnchor { .. } => {
                // Out of scope for base delta; skip or handle via custom blot in frontends
            }
        }
    }
    json!({"ops": ops})
}

pub fn from_quill_delta(delta: &Value) -> Doc {
    let mut nodes: Vec<Node> = Vec::new();
    let mut current_spans: Vec<InlineSpan> = Vec::new();
    let mut current_text: String = String::new();
    let mut current_header: Option<u8> = None;

    let ops = delta.get("ops").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for op in ops {
        if let Some(insert) = op.get("insert") {
            if let Some(obj) = insert.as_object() {
                if let Some(image) = obj.get("image").and_then(|v| v.as_str()) {
                    if !current_text.is_empty() || !current_spans.is_empty() {
                        flush_para_or_heading(&mut nodes, &mut current_text, &mut current_spans, &mut current_header);
                    }
                    nodes.push(Node::Image { src: image.to_string(), alt: String::new() });
                } else if let Some(formula) = obj.get("formula").and_then(|v| v.as_str()) {
                    if !current_text.is_empty() || !current_spans.is_empty() {
                        flush_para_or_heading(&mut nodes, &mut current_text, &mut current_spans, &mut current_header);
                    }
                    nodes.push(Node::FormulaInline { tex: formula.to_string() });
                }
            } else if let Some(s) = insert.as_str() {
                // Attributes for text
                let attrs = op.get("attributes");
                if s == "\n" {
                    // Line break flushes paragraph or heading
                    if let Some(header) = attrs.and_then(|a| a.get("header")).and_then(|v| v.as_u64()) {
                        current_header = Some((header as u8).clamp(1, 6));
                    }
                    flush_para_or_heading(&mut nodes, &mut current_text, &mut current_spans, &mut current_header);
                } else {
                    let style = InlineStyle {
                        bold: attrs.and_then(|a| a.get("bold")).and_then(|v| v.as_bool()).unwrap_or(false),
                        italic: attrs.and_then(|a| a.get("italic")).and_then(|v| v.as_bool()).unwrap_or(false),
                        underline: attrs.and_then(|a| a.get("underline")).and_then(|v| v.as_bool()).unwrap_or(false),
                        code: attrs.and_then(|a| a.get("code")).and_then(|v| v.as_bool()).unwrap_or(false),
                        link: attrs.and_then(|a| a.get("link")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    };
                    current_spans.push(InlineSpan { text: s.to_string(), style });
                    current_text.push_str(s);
                }
            }
        }
    }
    // Flush remaining content
    if !current_text.is_empty() || !current_spans.is_empty() {
        flush_para_or_heading(&mut nodes, &mut current_text, &mut current_spans, &mut current_header);
    }

    Doc { nodes }
}

fn push_spans_as_delta(ops: &mut Vec<Value>, spans: Option<&[InlineSpan]>, fallback_text: &str) {
    if let Some(sp) = spans {
        for span in sp {
            let mut attributes = serde_json::Map::new();
            if span.style.bold { attributes.insert("bold".into(), json!(true)); }
            if span.style.italic { attributes.insert("italic".into(), json!(true)); }
            if span.style.underline { attributes.insert("underline".into(), json!(true)); }
            if span.style.code { attributes.insert("code".into(), json!(true)); }
            if let Some(link) = &span.style.link { attributes.insert("link".into(), json!(link)); }
            if attributes.is_empty() {
                ops.push(json!({"insert": span.text}));
            } else {
                ops.push(json!({"insert": span.text, "attributes": attributes}));
            }
        }
    } else if !fallback_text.is_empty() {
        ops.push(json!({"insert": fallback_text}));
    }
}

fn flush_para_or_heading(nodes: &mut Vec<Node>, current_text: &mut String, current_spans: &mut Vec<InlineSpan>, current_header: &mut Option<u8>) {
    let spans = if current_spans.is_empty() { None } else { Some(current_spans.clone()) };
    let text = std::mem::take(current_text);
    if let Some(h) = current_header.take() {
        nodes.push(Node::Heading { level: h, text, spans });
    } else {
        nodes.push(Node::Paragraph { text, spans });
    }
    current_spans.clear();
}
