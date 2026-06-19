export type SrteTheme = 'light' | 'dark';

export const SRTE_DEFAULT_CSS = `
.srte-editor {
  --srte-bg: #ffffff;
  --srte-text: #111111;
  --srte-text-muted: #4b5563;
  --srte-border: #dddddd;
  --srte-border-light: #eeeeee;
  --srte-toolbar-bg: #ffffff;
  --srte-input-bg: #ffffff;
  --srte-input-text: #111111;
  --srte-input-border: #e5e7eb;
  --srte-modal-backdrop: rgba(0, 0, 0, 0.35);
  --srte-modal-backdrop-filter: blur(2px);
  --srte-modal-bg: #ffffff;
  --srte-modal-text: #000000;
  --srte-menu-bg: #ffffff;
  --srte-menu-text: #111111;
  --srte-menu-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  --srte-accent: #1e90ff;
  --srte-accent-bg: rgba(30, 144, 255, 0.15);
  --srte-danger: #dc2626;
  --srte-primary: #2563eb;
  --srte-surface-subtle: #f3f4f6;
  --srte-on-primary: #ffffff;
  --srte-cancel-bg: #f3f4f6;
}
.srte-editor.srte-dark {
  --srte-bg: #1e1e1e;
  --srte-text: #e0e0e0;
  --srte-text-muted: #9ca3af;
  --srte-border: #3a3a3a;
  --srte-border-light: #2e2e2e;
  --srte-toolbar-bg: #252525;
  --srte-input-bg: #2a2a2a;
  --srte-input-text: #e0e0e0;
  --srte-input-border: #444444;
  --srte-modal-backdrop: rgba(0, 0, 0, 0.22);
  --srte-modal-backdrop-filter: blur(10px) saturate(0.9);
  --srte-modal-bg: #1e293b;
  --srte-modal-text: #e0e0e0;
  --srte-menu-bg: #1e293b;
  --srte-menu-text: #e0e0e0;
  --srte-menu-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  --srte-accent: #3b9eff;
  --srte-accent-bg: rgba(59, 158, 255, 0.2);
  --srte-danger: #ef4444;
  --srte-primary: #3b82f6;
  --srte-surface-subtle: #333333;
  --srte-on-primary: #ffffff;
  --srte-cancel-bg: #333333;
}
.srte-editor [contenteditable] blockquote {
  border-left: 4px solid var(--srte-accent);
  margin: 0.75em 0;
  padding: 0.5em 1em;
  background: var(--srte-surface-subtle);
  color: var(--srte-text);
}
.srte-editor [contenteditable] p,
.srte-editor [contenteditable] h1,
.srte-editor [contenteditable] h2,
.srte-editor [contenteditable] h3 {
  color: inherit;
}
.srte-editor [contenteditable] p {
  display: block;
  margin: 0 0 0.75em;
  font-size: 1em;
  font-weight: 400;
  line-height: 1.6;
}
.srte-editor [contenteditable] h1,
.srte-editor [contenteditable] h2,
.srte-editor [contenteditable] h3 {
  display: block;
  margin: 0.75em 0 0.4em;
  font-weight: 700;
  line-height: 1.25;
}
.srte-editor [contenteditable] h1 {
  font-size: 2em;
}
.srte-editor [contenteditable] h2 {
  font-size: 1.5em;
}
.srte-editor [contenteditable] h3 {
  font-size: 1.25em;
}
.srte-editor [contenteditable] > :first-child {
  margin-top: 0;
}
.srte-editor [contenteditable] ul {
  list-style-type: disc;
  list-style-position: outside;
  margin: 0.75em 0;
  padding-left: 1.75em;
}
.srte-editor [contenteditable] ol {
  list-style-type: decimal;
  list-style-position: outside;
  margin: 0.75em 0;
  padding-left: 1.75em;
}
.srte-editor [contenteditable] li {
  display: list-item;
  margin: 0.25em 0;
  padding-left: 0.25em;
}
.srte-editor [contenteditable] li::marker {
  color: currentColor;
}
.srte-editor [contenteditable] a,
.srte-editor [contenteditable] a:visited {
  color: var(--srte-primary) !important;
  text-decoration: underline !important;
  text-decoration-thickness: 1px !important;
  text-underline-offset: 2px !important;
  cursor: pointer;
}
.srte-editor [contenteditable] a:hover {
  color: var(--srte-accent) !important;
}
.srte-editor [contenteditable] a:focus-visible {
  outline: 2px solid var(--srte-accent);
  outline-offset: 2px;
}
.srte-editor.srte-dark [contenteditable] [style*="color"]:not(td):not(th):not(.srte-preserve-colors):not(.srte-preserve-colors *),
.srte-editor.srte-dark [contenteditable] [style*="background"]:not(td):not(th):not(.srte-preserve-colors):not(.srte-preserve-colors *) {
  color: var(--srte-text) !important;
  background: transparent !important;
  background-color: transparent !important;
}
.srte-editor [contenteditable] sub,
.srte-editor [contenteditable] sup {
  line-height: 0;
}
`;

const SRTE_STYLE_ID = 'srte-theme-defaults';

export function ensureStyleSheet(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(SRTE_STYLE_ID);
  if (existing) {
    if (existing.textContent !== SRTE_DEFAULT_CSS) {
      existing.textContent = SRTE_DEFAULT_CSS;
    }
    return;
  }
  const style = document.createElement('style');
  style.id = SRTE_STYLE_ID;
  style.textContent = SRTE_DEFAULT_CSS;
  document.head.appendChild(style);
}
