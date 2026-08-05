export type SrteTheme = 'light' | 'dark';

export const SRTE_DEFAULT_CSS = `
.srte-editor {
  --srte-background: var(--card, #ffffff);
  --srte-canvas: var(--background, #ffffff);
  --srte-foreground: var(--foreground, #0f172a);
  --srte-muted: var(--muted, #f1f5f9);
  --srte-muted-foreground: var(--muted-foreground, #64748b);
  --srte-ring: var(--ring, #0284c7);
  --srte-radius: var(--radius, 0.625rem);
  --srte-bg: var(--srte-canvas);
  --srte-text: var(--srte-foreground);
  --srte-text-muted: var(--srte-muted-foreground);
  --srte-border: var(--border, #e2e8f0);
  --srte-border-light: var(--srte-border);
  --srte-toolbar-bg: var(--srte-background);
  --srte-input-bg: var(--srte-background);
  --srte-input-text: var(--srte-foreground);
  --srte-input-border: var(--srte-border);
  --srte-modal-backdrop: rgba(0, 0, 0, 0.35);
  --srte-modal-backdrop-filter: blur(2px);
  --srte-modal-bg: #ffffff;
  --srte-modal-text: #000000;
  --srte-menu-bg: var(--srte-background);
  --srte-menu-text: var(--srte-foreground);
  --srte-menu-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  --srte-accent: #0284c7;
  --srte-accent-bg: rgba(2, 132, 199, 0.12);
  --srte-danger: #dc2626;
  --srte-primary: #2563eb;
  --srte-surface-subtle: #f3f4f6;
  --srte-on-primary: #ffffff;
  --srte-cancel-bg: #f3f4f6;
  --srte-code-bg: #f6f8fa;
  --srte-code-text: #24292f;
}
.srte-editor.srte-dark {
  --srte-background: var(--card, #1e293b);
  --srte-canvas: var(--background, #0f172a);
  --srte-foreground: var(--foreground, #f8fafc);
  --srte-muted: var(--muted, #334155);
  --srte-muted-foreground: var(--muted-foreground, #94a3b8);
  --srte-ring: var(--ring, #38bdf8);
  --srte-bg: var(--srte-canvas);
  --srte-text: var(--srte-foreground);
  --srte-text-muted: var(--srte-muted-foreground);
  --srte-border: var(--border, #334155);
  --srte-border-light: var(--srte-border);
  --srte-toolbar-bg: var(--srte-background);
  --srte-input-bg: var(--srte-background);
  --srte-input-text: var(--srte-foreground);
  --srte-input-border: var(--srte-border);
  --srte-modal-backdrop: rgba(0, 0, 0, 0.22);
  --srte-modal-backdrop-filter: blur(10px) saturate(0.9);
  --srte-modal-bg: #1e293b;
  --srte-modal-text: #e0e0e0;
  --srte-menu-bg: var(--srte-background);
  --srte-menu-text: var(--srte-foreground);
  --srte-menu-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  --srte-accent: #38bdf8;
  --srte-accent-bg: rgba(56, 189, 248, 0.16);
  --srte-danger: #ef4444;
  --srte-primary: #3b82f6;
  --srte-surface-subtle: #333333;
  --srte-on-primary: #ffffff;
  --srte-cancel-bg: #333333;
  --srte-code-bg: #111827;
  --srte-code-text: #e5e7eb;
}
.srte-editor {
  border-radius: var(--srte-radius);
  font-family: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  container: srte-editor / inline-size;
}
.srte-canonical-authority > .srte-editor[contenteditable] {
  width: 100%;
  padding: 16px 20px;
  box-sizing: border-box;
  border: 1px solid var(--srte-border);
  border-radius: 0 0 var(--srte-radius) var(--srte-radius);
  outline: none;
  background: var(--srte-canvas);
  color: var(--srte-foreground);
  caret-color: var(--srte-foreground);
  line-height: 1.6;
}
.srte-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-height: 48px;
  padding: 8px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--srte-border);
  background: var(--srte-background);
  color: var(--srte-foreground);
  position: sticky;
  top: 0;
  z-index: 10;
}
.srte-toolbar-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.srte-toolbar-group + .srte-toolbar-group::before {
  content: "";
  width: 1px;
  height: 20px;
  margin: 0 5px 0 3px;
  background: var(--srte-border);
}
.srte-tool-button,
.srte-toolbar select {
  height: 32px;
  min-width: 32px;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--srte-foreground);
  font: 500 13px/1 "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
}
.srte-tool-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0 7px;
  cursor: pointer;
}
.srte-toolbar select {
  max-width: 132px;
  padding: 0 26px 0 9px;
  border-color: var(--srte-border);
  background: var(--srte-input-bg);
  cursor: pointer;
}
.srte-tool-button:hover,
.srte-toolbar select:hover,
.srte-toolbar-menu[open] > .srte-menu-trigger {
  background: var(--srte-muted);
  border-color: var(--srte-border);
}
.srte-tool-button.srte-active,
.srte-tool-button[aria-pressed="true"] {
  color: var(--srte-primary);
  background: var(--srte-accent-bg);
  border-color: color-mix(in srgb, var(--srte-primary) 35%, transparent);
}
.srte-tool-button:focus-visible,
.srte-toolbar select:focus-visible,
.srte-menu-item:focus-visible {
  outline: 2px solid var(--srte-ring);
  outline-offset: 1px;
}
.srte-tool-button:disabled,
.srte-menu-item:disabled,
.srte-toolbar select:disabled {
  cursor: not-allowed;
  opacity: .4;
}
.srte-toolbar-menu {
  position: relative;
}
.srte-toolbar-menu > summary {
  list-style: none;
}
.srte-toolbar-menu > summary::-webkit-details-marker {
  display: none;
}
.srte-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 80;
  min-width: 210px;
  padding: 4px;
  overflow: hidden;
  border: 1px solid var(--srte-border);
  border-radius: 12px;
  background: var(--srte-menu-bg);
  color: var(--srte-menu-text);
  box-shadow: var(--srte-menu-shadow);
}
.srte-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: 500 13px/1 "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  text-align: left;
  white-space: nowrap;
}
.srte-menu-item:hover {
  background: var(--srte-muted);
}
.srte-menu-check {
  margin-left: auto;
  color: var(--srte-primary);
  font-weight: 700;
}
.srte-menu-separator {
  height: 1px;
  margin: 4px;
  background: var(--srte-border);
}
.srte-mobile-more { display: none; }
.srte-toolbar .srte-command-proxy { display: none; }
.srte-split-control {
  display: inline-flex;
}
.srte-split-control > .srte-tool-button:first-child {
  border-radius: 8px 0 0 8px;
}
.srte-split-control > select {
  width: 27px;
  padding: 0;
  border-radius: 0 8px 8px 0;
  border-left: 0;
  appearance: none;
  -webkit-appearance: none;
  color: transparent;
  background-color: var(--srte-muted);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
  cursor: pointer;
}
.srte-editor [contenteditable] ul[data-srte-checklist="true"] > li {
  display: grid;
  grid-template-columns: 1.1em minmax(0, 1fr);
  column-gap: .45em;
  align-items: start;
  padding-left: 0;
}
.srte-editor [contenteditable] ol[data-srte-list-preset="ordered-decimal-paren"][data-srte-list-depth="0"] > li::marker {
  content: counter(list-item, decimal) ")  ";
}
.srte-editor [contenteditable] ol[data-srte-list-preset="ordered-decimal-paren"][data-srte-list-depth="1"] > li::marker {
  content: counter(list-item, lower-alpha) ")  ";
}
.srte-editor [contenteditable] ol[data-srte-list-preset="ordered-decimal-paren"][data-srte-list-depth="2"] > li::marker,
.srte-editor [contenteditable] ol[data-srte-list-preset="ordered-decimal-paren"][data-srte-list-depth="3"] > li::marker {
  content: counter(list-item, lower-roman) ")  ";
}
.srte-editor [contenteditable] ol[data-srte-list-preset="ordered-outline"] > li::marker {
  content: counters(list-item, ".") ".  ";
}
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-diamond"][data-srte-list-depth="0"] > li::marker { content: "❖  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-diamond"][data-srte-list-depth="1"] > li::marker { content: "➢  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-diamond"][data-srte-list-depth="2"] > li::marker { content: "■  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-square"][data-srte-list-depth="0"] > li::marker { content: "□  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-square"][data-srte-list-depth="1"] > li::marker { content: "▣  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-square"][data-srte-list-depth="2"] > li::marker { content: "▪  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-arrow"][data-srte-list-depth="0"] > li::marker { content: "➜  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-arrow"][data-srte-list-depth="1"] > li::marker { content: "◆  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-arrow"][data-srte-list-depth="2"] > li::marker { content: "●  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-star"][data-srte-list-depth="0"] > li::marker { content: "★  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-star"][data-srte-list-depth="1"] > li::marker { content: "○  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-star"][data-srte-list-depth="2"] > li::marker { content: "■  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-arrow-circle"][data-srte-list-depth="0"] > li::marker { content: "➢  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-arrow-circle"][data-srte-list-depth="1"] > li::marker { content: "○  "; }
.srte-editor [contenteditable] ul[data-srte-list-preset="bullet-arrow-circle"][data-srte-list-depth="2"] > li::marker { content: "■  "; }
.srte-editor [contenteditable] ul[data-srte-checklist="true"] > li > [data-srte-check] {
  display: inline-flex;
  grid-column: 1;
  grid-row: 1;
  align-items: center;
  justify-content: center;
  width: 1.1em;
  height: 1.6em;
  margin: 0;
  line-height: 1.6;
  vertical-align: top;
  position: relative;
}
.srte-editor [contenteditable] ul[data-srte-checklist="true"] > li > [data-srte-check]::before {
  content: "";
  width: .9em;
  height: .9em;
  box-sizing: border-box;
  border: 1.5px solid var(--srte-muted-foreground);
  border-radius: 3px;
  background: var(--srte-canvas);
}
.srte-editor [contenteditable] ul[data-srte-checklist="true"] > li > [data-srte-check][data-checked="true"]::before {
  border-color: var(--srte-primary);
  background: var(--srte-primary);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--srte-on-primary) 25%, transparent);
}
.srte-editor [contenteditable] ul[data-srte-checklist="true"] > li > [data-srte-check][data-checked="true"]::after {
  content: "";
  position: absolute;
  width: .42em;
  height: .22em;
  border-left: 1.5px solid var(--srte-on-primary);
  border-bottom: 1.5px solid var(--srte-on-primary);
  transform: translateY(-.08em) rotate(-45deg);
}
.srte-editor [contenteditable] ul[data-srte-checklist="true"] > li > :is(p,h1,h2,h3,h4,h5,h6,blockquote,pre) {
  grid-column: 2;
  min-width: 0;
  margin-top: 0;
}
.srte-editor [contenteditable] ul[data-srte-checklist="true"] > li > :is(ul,ol) {
  grid-column: 2;
}
.srte-editor:focus-within {
  border-color: var(--srte-ring) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--srte-ring) 18%, transparent);
}
@media (max-width: 639px) {
  .srte-toolbar { gap: 3px; padding: 6px; }
  .srte-tool-button, .srte-toolbar select { height: 40px; min-width: 40px; }
  .srte-toolbar-group[data-srte-priority="3"] { display: none; }
  .srte-toolbar-menu[data-srte-priority="2"] { display: none; }
  .srte-mobile-more { display: block; }
  .srte-mobile-more .srte-menu {
    left: auto;
    right: 0;
    width: min(280px, calc(100vw - 16px));
    min-width: 0;
    max-height: min(70dvh, 480px);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .srte-menu-item { height: 40px; }
}
@container srte-editor (max-width: 639px) {
  .srte-toolbar { gap: 3px; padding: 6px; }
  .srte-tool-button, .srte-toolbar select { height: 40px; min-width: 40px; }
  .srte-toolbar-group[data-srte-priority="3"],
  .srte-toolbar-menu[data-srte-priority="2"] { display: none; }
  .srte-mobile-more { display: block; }
  .srte-mobile-more .srte-menu {
    left: auto;
    right: 0;
    width: min(280px, calc(100vw - 16px));
    min-width: 0;
    max-height: min(70dvh, 480px);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .srte-menu-item { height: 40px; }
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
.srte-editor [contenteditable] p[data-srte-caret-boundary="true"] {
  min-height: 1.6em;
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
.srte-editor [contenteditable] table {
  width: 100%;
  margin: 0.75em 0;
  border-collapse: collapse;
}
.srte-editor [contenteditable] th,
.srte-editor [contenteditable] td {
  padding: 8px;
  border: 1px solid var(--srte-border);
  vertical-align: top;
}
.srte-editor [contenteditable] th {
  background: var(--srte-surface-subtle);
  font-weight: 600;
  text-align: left;
}
.srte-editor [contenteditable] td > h1,
.srte-editor [contenteditable] td > h2,
.srte-editor [contenteditable] td > h3,
.srte-editor [contenteditable] th > h1,
.srte-editor [contenteditable] th > h2,
.srte-editor [contenteditable] th > h3 {
  margin: 0 0 0.4em;
  overflow-wrap: anywhere;
}
.srte-editor [contenteditable] pre {
  display: block;
  margin: 0.75em 0;
  padding: 12px 14px;
  overflow-x: auto;
  border: 1px solid var(--srte-border);
  border-radius: 6px;
  background: var(--srte-code-bg);
  color: var(--srte-code-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
  line-height: 1.55;
  white-space: pre-wrap;
}
.srte-editor [contenteditable] pre code {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}
.srte-editor [contenteditable] code:not(pre code) {
  padding: 0.1em 0.35em;
  border-radius: 3px;
  background: var(--srte-code-bg);
  color: var(--srte-code-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
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
