# Smart RTE UI Design Specification

Status: Implemented for the Smart RTE React toolbar (2026-07-14)  
Product context: Sootr  
Scope: Text-editor chrome, toolbar, menus, popovers, responsive behavior, and interaction states

## 1. Goal

Smart RTE should feel native to Sootr: calm, compact, clear, and professional. The toolbar must expose common editing actions immediately while grouping less frequent actions into predictable menus.

This document is the implementation contract for the editor UI. It does not change document semantics or serialized HTML.

## 2. Design principles

1. **Content remains primary.** Editor controls should support writing without visually competing with the document.
2. **Frequent actions stay visible.** Undo, formatting, lists, links, alignment, and block tools remain one click away on desktop.
3. **Related actions share a control.** Alignment belongs in one Align menu; movement and indentation belong in one Move menu.
4. **Icons must be recognizable.** Use one consistent outlined icon family and accompany ambiguous icons with menu labels and tooltips.
5. **State must be obvious.** Active, mixed, disabled, hover, and keyboard-focus states must be visually distinct.
6. **Menus should be contextual.** Commands remain stable in location but are enabled only when valid for the current selection.
7. **Responsive behavior must be deterministic.** Controls move into a More menu by priority, not by arbitrary wrapping or clipping.
8. **Application tokens drive appearance.** Smart RTE must inherit Sootr colors, typography, radius, and dark mode through CSS custom properties.

## 3. Sootr visual language

### Typography

- UI font: `IBM Plex Sans`, with the application sans-serif fallback.
- Toolbar and menu text: 13px, 500 weight.
- Secondary text and status text: 12px, 400–500 weight.
- Editor body defaults remain document-configurable; the surrounding UI must not override document typography.

### Color tokens

Smart RTE should expose package-level tokens that default to Sootr's application tokens:

| Smart RTE token | Sootr source | Light fallback | Dark fallback |
| --- | --- | --- | --- |
| `--srte-background` | `--card` | `#ffffff` | `#1e293b` |
| `--srte-canvas` | `--background` | `#ffffff` | `#0f172a` |
| `--srte-foreground` | `--foreground` | `#0f172a` | `#f8fafc` |
| `--srte-muted` | `--muted` | `#f1f5f9` | `#334155` |
| `--srte-muted-foreground` | `--muted-foreground` | `#64748b` | `#94a3b8` |
| `--srte-accent` | `--accent` | `#f1f5f9` | `#334155` |
| `--srte-border` | `--border` | `#e2e8f0` | `#334155` |
| `--srte-primary` | `--primary` | `#0284c7` | `#38bdf8` |
| `--srte-focus-ring` | `--ring` | `#0284c7` | `#38bdf8` |
| `--srte-danger` | `--destructive` | application token | application token |

The package must provide standalone fallbacks, but Sootr should map these variables to its own tokens at the editor boundary.

### Shape and elevation

- Editor shell radius: 10px.
- Buttons and fields: 8px.
- Menus and popovers: 12px.
- Border: 1px solid `--srte-border`.
- Popovers: Sootr's large shadow or equivalent restrained multi-layer shadow.
- Focus ring: 2px `--srte-focus-ring`, with sufficient offset from the control border.

## 4. Toolbar information architecture

### Recommended desktop order

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ↶ ↷ │ Paragraph ▾  Size ▾ │ B I U S  Color ▾  Link │ ☑ •▾ 1▾ │ Quote Code │
│     │                      │                         │          │            │
│ Align ▾  Move ▾ │ Insert ▾ │ Import ▾ Export ▾                         More ⋯│
└──────────────────────────────────────────────────────────────────────────────┘
```

The toolbar may occupy one or two rows based on available width. Groups must stay intact where possible. A separator appears only between visible groups.

### Groups and priority

| Priority | Group | Controls | Desktop behavior |
| --- | --- | --- | --- |
| 1 | History | Undo, Redo | Always visible |
| 1 | Structure | Paragraph/heading select, font size | Always visible |
| 1 | Inline | Bold, italic, underline, strike, color, link | Always visible |
| 1 | Lists | Checklist, bullet list, numbered list | Always visible |
| 2 | Blocks | Blockquote, code block | Visible when space allows |
| 1 | Align | Alignment dropdown | Always visible |
| 2 | Move | Movement and indentation dropdown | Visible when space allows |
| 2 | Insert | Table, image, media, formula | Visible when space allows |
| 3 | Document | Import and Export dropdowns | Move to More first |
| 3 | More | Lower-priority or overflowed commands | Always visible when it contains items |

Font family, clear formatting, superscript, and subscript may appear in More by default unless product analytics show frequent use.

## 5. Core controls

### Icon buttons

- Visual size: 32 × 32px desktop; 40 × 40px on touch layouts.
- Icon size: 16px desktop; 18px touch.
- Radius: 8px.
- Default: transparent background, foreground icon.
- Hover: `--srte-accent` background.
- Active: a lightly tinted primary background with a primary-colored icon.
- Keyboard focus: visible 2px focus ring.
- Disabled: 40% opacity, no hover fill, `aria-disabled="true"` or native `disabled`.
- Every icon-only control requires a tooltip and an accessible name.

### Icon language

- Use one Lucide-compatible outlined icon style: 16px grid, rounded caps/joins, approximately 1.75px stroke.
- Do not mix emoji, filled icons, Unicode symbols, and unrelated icon libraries.
- Use a chain-link icon for Link. Link removal stays inside the Edit link popover; do not add a separate unlink icon beside Link.
- Bold, italic, underline, and strike may use typographic glyph icons only when their dimensions and stroke weight match the icon set.
- Smart RTE should own an icon registry or accept an icon adapter so applications can replace icons without rewriting controls.

### Select controls

- Height: 32px desktop; 40px touch.
- Paragraph/heading width: 112–136px.
- Font-size width: 72–88px.
- Selected value should be readable; do not show only a generic icon for structural formatting.
- Mixed selection shows `Mixed` rather than an incorrect single value.

### Split list controls

Bullet and numbered list controls are split buttons:

- Main region applies or toggles the currently selected list style.
- Chevron opens the style menu.
- The icon reflects the active style when the cursor is in a list.
- Checklist remains a direct action unless alternate checklist styles are introduced.
- List menus display an icon/sample and a text label; examples include Disc, Circle, Square, Decimal, Lower alpha, Upper alpha, Lower Roman, and Upper Roman.

## 6. Align dropdown

Alignment should be a single dropdown, positioned after block/list controls and before Move.

Menu order:

1. Align left
2. Align center
3. Align right
4. Justify

Behavior:

- The toolbar icon reflects the active alignment.
- A mixed selection uses the neutral Align left icon with a mixed-state indicator in the menu trigger.
- The active menu item shows a checkmark.
- Alignment applies to all selected blocks, including paragraphs in table cells and supported blocks inside code-block containers.
- Disabled contexts retain the menu item but explain the limitation in the tooltip or supporting text.
- Keyboard shortcuts, when supported, appear right-aligned in menu items.

## 7. Move dropdown

Move consolidates structural movement and indentation. Do not show a permanent `Move:` label in the toolbar.

Menu order:

1. Move block up
2. Move block down
3. Separator
4. Decrease indent
5. Increase indent

Behavior:

- Move up/down operates on the selected block range as one unit and preserves its internal formatting.
- In a list, decrease/increase indent maps to outdent/indent and preserves list style and numbering continuity.
- In a table, movement commands must not move content outside its cell. Commands that cannot preserve table structure are disabled.
- At the first/last valid position, Move up/down is disabled.
- Indentation commands are disabled when the current structure does not support them.
- The trigger uses a recognizable four-direction or vertical-movement icon plus chevron. Menu labels provide the precise action.

## 8. Insert, Import, and Export

### Insert menu

Recommended order:

1. Link
2. Table
3. Image
4. Media
5. Formula
6. Horizontal rule, if supported

Link may also remain a direct toolbar action because it is frequent. If so, it should not be duplicated in Insert.

### Import menu

Show only formats supported by the current build:

1. Microsoft Word (`.docx`)
2. HTML (`.html`, `.htm`)
3. Markdown (`.md`)
4. Plain text (`.txt`)

Selecting a format opens the file picker with the correct accepted types. If import may replace existing content, confirm replacement when the editor is non-empty. Show progress, success, and actionable failure feedback.

### Export menu

1. PDF
2. Microsoft Word (`.docx`)
3. HTML
4. Markdown
5. Plain text, if supported

Each item includes a file-type icon, format name, and optional short description. Unsupported formats must not appear as enabled actions.

## 9. Menus and popovers

- Minimum width: 200px; list-style palettes may use a compact grid where samples are clearer than text alone.
- Outer padding: 4px.
- Menu item height: 36px desktop; 40px touch.
- Menu item horizontal padding: 8px.
- Icon-to-label gap: 8px.
- Menu radius: 12px.
- Use `--srte-background`, `--srte-foreground`, and `--srte-border`.
- Open below the trigger by default and flip when viewport space is insufficient.
- Never render outside the viewport; use collision padding of at least 8px.
- Escape closes and returns focus to the trigger. Arrow keys move between items. Enter/Space activates.

### Link popover

The Edit link experience should contain:

- URL field with clear label.
- Optional display-text field when supported safely by the current selection.
- Open in new tab checkbox.
- Primary Apply/Update action.
- Secondary Cancel action.
- Remove link action inside the popover, visually separated and using the destructive token only for hover/confirmation emphasis.

The popover should not depend on selection remaining visually highlighted; save and restore the editor selection internally.

## 10. Editor shell and canvas

### Shell

- `1px` border, 10px radius, `--srte-background` surface.
- Toolbar uses the card surface and a bottom border.
- Canvas uses `--srte-canvas`.
- When editor focus is within the shell, strengthen the border to the primary token and show a subtle outer ring.
- Disabled/read-only state uses muted chrome without reducing document readability below accessible contrast.

### Canvas

- Desktop padding: 16–20px.
- Mobile padding: 12–16px.
- Minimum editor height is a product setting, not hard-coded in toolbar CSS.
- Placeholder uses `--srte-muted-foreground` and never competes with actual content.
- Selection color should derive from the primary color at low opacity.

### Footer/status bar

Use a muted surface separated by a top border. It may contain word/character count and document status. Keep it 12px and avoid placing primary actions there.

## 11. Responsive behavior

### Wide desktop: 1024px and above

- Prefer a single row where possible.
- Preserve all priority 1 and 2 groups.
- Import/Export may move into More when the host container is narrow despite viewport width.

### Tablet and compact desktop: 640–1023px

- Allow a deliberate second toolbar row.
- Move Document, Insert, then Move into More in that order when space is constrained.
- Do not split a control group across rows.

### Mobile: below 640px

- Use 40px interaction targets.
- Keep History, Structure, Inline essentials, Lists, and More visible.
- Put block tools, Align, Move, Insert, Import, and Export in More unless the product provides a mobile toolbar drawer.
- Menus may become bottom sheets when their contents exceed comfortable popover space.
- The editor page must not gain horizontal scrolling because of the toolbar.

Use a `ResizeObserver` on the editor container. Do not base overflow behavior only on the browser viewport.

## 12. Interaction states

All controls must support these states consistently:

| State | Required behavior |
| --- | --- |
| Default | Clear icon/label with no unnecessary fill |
| Hover | Accent background and tooltip after a short delay |
| Active | Primary-tinted background, primary icon, `aria-pressed` where appropriate |
| Mixed | Explicit mixed indicator; never report an arbitrary active value |
| Focus | Visible keyboard focus ring independent of hover |
| Disabled | Reduced emphasis, no activation, reason available for unfamiliar constraints |
| Busy | Disable duplicate action, show progress in the relevant menu/control |
| Error | Inline actionable message; do not rely on color alone |

Toolbar state must update immediately after selection changes, keyboard commands, undo/redo, programmatic content updates, and commands executed from menus.

## 13. Accessibility

- Toolbar root uses `role="toolbar"` and an accessible label such as `Text formatting`.
- Use roving tabindex for toolbar keyboard navigation.
- Buttons expose `aria-label`, `aria-pressed`, `aria-expanded`, and `aria-controls` as applicable.
- Menu triggers and menu content follow the ARIA menu-button pattern.
- Tooltips supplement accessible names; they do not replace them.
- Maintain at least WCAG AA contrast in light and dark themes.
- Never convey active state by color alone; use fill, checkmark, or pressed state.
- Support 200% zoom without clipped controls or inaccessible actions.
- Preserve focus when applying formatting and restore editor focus after command execution.

## 14. Component architecture

Recommended UI primitives:

```text
EditorShell
├── EditorToolbar
│   ├── ToolbarGroup
│   ├── IconButton
│   ├── SelectControl
│   ├── SplitButton
│   ├── MenuButton
│   ├── ColorControl
│   └── OverflowMenu
├── EditorSurface
├── ContextPopoverLayer
└── EditorStatusBar
```

Implementation rules:

- Keep command logic separate from presentation. Controls consume command-state objects such as `enabled`, `active`, `mixed`, and `execute`.
- Define toolbar groups in configuration with stable IDs and overflow priorities.
- Use semantic class names or `data-srte-*` attributes. Sootr must not target controls through `:first-child`, generated DOM order, or broad `!important` overrides.
- Centralize menu positioning, dismissal, focus restoration, and collision handling.
- Centralize icons in an icon registry.
- Use CSS custom properties for theme integration; avoid application-specific colors inside package components.
- Portal menus into an editor-owned overlay root with a documented z-index token.
- Document-content styles and editor-UI styles must remain separate so preview rendering is unaffected by toolbar styling.

Suggested command-state interface:

```ts
interface ToolbarCommandState {
  id: string;
  label: string;
  enabled: boolean;
  active?: boolean;
  mixed?: boolean;
  shortcut?: string;
  execute(): void;
}
```

## 15. Theme integration contract

Sootr should be able to theme the editor with a small boundary mapping:

```css
.sootr-editor {
  --srte-background: var(--card);
  --srte-canvas: var(--background);
  --srte-foreground: var(--foreground);
  --srte-muted: var(--muted);
  --srte-muted-foreground: var(--muted-foreground);
  --srte-accent: var(--accent);
  --srte-border: var(--border);
  --srte-primary: var(--primary);
  --srte-focus-ring: var(--ring);
  --srte-radius: var(--radius);
  font-family: "IBM Plex Sans", sans-serif;
}
```

No Sootr-specific selector should need knowledge of Smart RTE's internal element order.

## 16. Acceptance criteria

### Visual

- Toolbar uses Sootr typography, tokens, border, radius, and dark theme.
- All non-typographic toolbar actions use a consistent icon family.
- Group boundaries are understandable without excessive separators.
- Open menus align with their triggers, stay inside the viewport, and match Sootr popovers.
- Active formatting can be identified at a glance.

### Behavioral

- Align menu applies Left, Center, Right, and Justify to every selected valid block.
- Move menu preserves selections, block formatting, list structure, and table boundaries.
- List split buttons apply the last chosen style and dropdowns expose all supported styles.
- Link editing preserves selection and Remove link exists only in the link popover.
- Import/Export menus list only working formats and report progress/errors.
- Toolbar state stays synchronized across mouse, keyboard, undo/redo, and programmatic updates.

### Responsive and accessible

- No toolbar-caused horizontal page scrolling from 320px upward.
- Every command remains reachable at 200% zoom and on mobile.
- Keyboard users can reach, operate, and dismiss every toolbar control and return to the editor.
- Light and dark modes meet WCAG AA contrast.
- Screen readers announce control name, expanded/pressed state, and disabled state correctly.

## 17. Implementation sequence

1. Introduce semantic toolbar primitives and the `--srte-*` token layer without changing commands.
2. Adopt the consistent icon registry and normalize button/select/menu dimensions.
3. Reorganize toolbar groups; implement Align and Move dropdowns.
4. Consolidate Insert, Import, Export, and More menus.
5. Replace link editing UI with the specified popover.
6. Implement container-aware overflow and mobile behavior.
7. Remove brittle Sootr DOM-order overrides and map application theme tokens at the boundary.
8. Add visual regression coverage for light/dark, desktop/tablet/mobile, active/mixed/disabled states, menus, tables, lists, links, and code blocks.
9. Add keyboard and screen-reader interaction tests before release.

## 18. Out of scope

- Changing the editor's document model.
- Changing the HTML contract solely for visual styling.
- Reworking Sootr's preview renderer.
- Adding formats whose import/export implementation is not production-ready.

Those concerns may be addressed separately, but this UI work must preserve their existing behavior.
