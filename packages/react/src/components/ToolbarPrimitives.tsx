import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalSpaceAround, ALargeSmall, Baseline, Bold, CheckSquare,
  ChevronDown, Code, Columns3, Download, Eye, FileJson, History, Image as ImageIcon, IndentDecrease, IndentIncrease,
  Italic, Link2, ListChecks, ListOrdered, ListRestart, List as ListIcon, MessageSquare, MessageSquarePlus,
  MoreHorizontal, MoveDown, MoveLeft, MoveRight, MoveUp, Music, Omega, PanelTop, PenLine, Pilcrow, Quote, Redo2, Rows3,
  ScissorsLineDashed, SeparatorHorizontal, Square, Sigma, Strikethrough, Subscript, Superscript, Table2, Trash2, Type,
  Underline, Undo2, Unlink2, Upload, Video, Pencil, ZoomIn, ZoomOut,
} from "lucide-react";
import { getFixedPositioningOrigin, getPositioningBounds } from "./fixedPositioning.js";

/**
 * The toolbar's icon set (Phase: Direction B toolbar redesign, 2026-08-29).
 * Lucide, per the design proposal's §11 recommendation - MIT-licensed,
 * tree-shakeable (only these ~40 icons ship), a consistent stroke style
 * that reads at the toolbar's small render size. Two icons here
 * (mergeCells/splitCell) have no Lucide equivalent and are hand-drawn to
 * match Lucide's own stroke weight/corner radius - the "grid + directional
 * arrow" concept the owner confirmed from the proposal's two alternatives.
 */
const stroke = { width: 17, height: 17, strokeWidth: 1.9 } as const;

const MergeCellsIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="15" y1="4" x2="15" y2="20" />
    <path d="M6 12h5" />
    <polyline points="9 9 12 12 9 15" />
  </svg>
);

const SplitCellIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="9" y1="4" x2="9" y2="20" />
    <path d="M18 9v6" />
    <polyline points="20 10.5 18 12 20 13.5" />
    <polyline points="16 10.5 18 12 16 13.5" />
  </svg>
);

export const toolbarIcons = {
  bold: <Bold {...stroke} />,
  italic: <Italic {...stroke} />,
  underline: <Underline {...stroke} />,
  strikethrough: <Strikethrough {...stroke} />,
  code: <Code {...stroke} />,
  superscript: <Superscript {...stroke} />,
  subscript: <Subscript {...stroke} />,
  textColor: <Baseline {...stroke} />,
  backgroundColor: <PenLine {...stroke} />,
  fontSize: <ALargeSmall {...stroke} />,
  fontFamily: <Type {...stroke} />,
  paragraphStyle: <Pilcrow {...stroke} />,
  alignLeft: <AlignLeft {...stroke} />,
  alignCenter: <AlignCenter {...stroke} />,
  alignRight: <AlignRight {...stroke} />,
  alignJustify: <AlignJustify {...stroke} />,
  quote: <Quote {...stroke} />,
  moveUp: <MoveUp {...stroke} />,
  moveDown: <MoveDown {...stroke} />,
  moveLeft: <MoveLeft {...stroke} />,
  moveRight: <MoveRight {...stroke} />,
  indent: <IndentIncrease {...stroke} />,
  outdent: <IndentDecrease {...stroke} />,
  link: <Link2 {...stroke} />,
  unlink: <Unlink2 {...stroke} />,
  bulletedList: <ListIcon {...stroke} />,
  numberedList: <ListOrdered {...stroke} />,
  checklist: <ListChecks {...stroke} />,
  checkSquare: <CheckSquare {...stroke} />,
  restart: <ListRestart {...stroke} />,
  continueNumbering: <Rows3 {...stroke} />,
  table: <Table2 {...stroke} />,
  mergeCells: <MergeCellsIcon />,
  splitCell: <SplitCellIcon />,
  addRow: <Rows3 {...stroke} />,
  addColumn: <Columns3 {...stroke} />,
  headerRow: <PanelTop {...stroke} />,
  deleteTable: <Trash2 {...stroke} />,
  image: <ImageIcon {...stroke} />,
  video: <Video {...stroke} />,
  audio: <Music {...stroke} />,
  formula: <Sigma {...stroke} />,
  specialChar: <Omega {...stroke} />,
  cellBorder: <Square {...stroke} />,
  edit: <Pencil {...stroke} />,
  zoomIn: <ZoomIn {...stroke} />,
  zoomOut: <ZoomOut {...stroke} />,
  delete: <Trash2 {...stroke} />,
  import: <Upload {...stroke} />,
  saveCopy: <Download {...stroke} />,
  json: <FileJson {...stroke} />,
  history: <History {...stroke} />,
  addComment: <MessageSquarePlus {...stroke} />,
  comments: <MessageSquare {...stroke} />,
  suggest: <PenLine {...stroke} />,
  suggestions: <MessageSquare {...stroke} />,
  showEdits: <Eye {...stroke} />,
  undo: <Undo2 {...stroke} />,
  redo: <Redo2 {...stroke} />,
  more: <MoreHorizontal {...stroke} />,
  divider: <SeparatorHorizontal {...stroke} />,
  pageBreak: <ScissorsLineDashed {...stroke} />,
  lineHeight: <AlignVerticalSpaceAround {...stroke} />,
} as const;

export type ToolbarIconKey = keyof typeof toolbarIcons;

/** A single always-visible toolbar control: icon + plain-language label together, per the redesign's core principle. */
export function ToolbarButton({ icon, label, ariaLabel, pressed, disabled, title, onClick, iconOnly, widePromote }: {
  icon: ToolbarIconKey;
  label: string;
  ariaLabel?: string;
  /** "mixed" renders aria-pressed="mixed" - the selection is partially covered by this mark (see markCoverage in CanonicalAuthorityEditor.tsx). */
  pressed?: boolean | "mixed";
  disabled?: boolean;
  title?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Only for genuinely space-constrained spots (e.g. a 4-way align cluster) - the accessible name is preserved via ariaLabel/label regardless. */
  iconOnly?: boolean;
  /**
   * This is the wide-viewport standalone copy of a tool that also lives in a
   * dropdown (via the matching `widePromote` ToolbarMenuItem below) - hidden
   * by default, shown only past theme.ts's wide-promotion breakpoint. See
   * docs/bugs/toolbar-priority-collapse-fixed-threshold-no-wide-promotion.md.
   */
  widePromote?: boolean;
}) {
  return <button
    type="button"
    className="srte-tool-button"
    aria-label={ariaLabel ?? label}
    aria-pressed={pressed}
    title={title ?? ariaLabel ?? label}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
    {...(widePromote ? { "data-srte-wide-promote": "true" } : {})}
  >
    {toolbarIcons[icon]}
    {!iconOnly && <span>{label}</span>}
  </button>;
}

/** One row inside an open dropdown menu - closes the dropdown after acting, matching ContextMenu.tsx's own dismiss-on-action convention. */
export function ToolbarMenuItem({ icon, label, ariaLabel, pressed, disabled, title, onClick, widePromote }: {
  icon?: ToolbarIconKey;
  label: string;
  ariaLabel?: string;
  pressed?: boolean | "mixed";
  disabled?: boolean;
  title?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** This tool also has a standalone wide-viewport ToolbarButton copy - hide this dropdown/mobile-menu row once that copy is showing (see ToolbarButton's own doc comment). */
  widePromote?: boolean;
}) {
  return <button
    type="button"
    className="srte-menu-item"
    role="menuitem"
    aria-label={ariaLabel ?? label}
    aria-pressed={pressed}
    title={title}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={(event) => {
      onClick(event);
      event.currentTarget.closest("details")?.removeAttribute("open");
    }}
    {...(widePromote ? { "data-srte-wide-promote": "true" } : {})}
  >
    {icon ? toolbarIcons[icon] : null}
    <span>{label}</span>
    {pressed === true && <span className="srte-menu-check" aria-hidden="true">✓</span>}
    {pressed === "mixed" && <span className="srte-menu-check" aria-hidden="true">~</span>}
  </button>;
}

/**
 * Closes an open `<details>` when the user clicks anywhere outside it -
 * native `<details>` does *not* do this on its own (confirmed directly:
 * unlike a real modal, it only ever closes via its own `<summary>` or a
 * script setting `open = false`), so a dropdown left open and then clicked
 * past straight into the editor previously just stayed open. Same
 * pointerdown+mousedown, capture-phase, ref-read pattern as
 * ContextMenu.tsx/ColorPickerPopover.tsx's own outside-click dismiss -
 * mounted once for the element's lifetime regardless of open/closed state,
 * since `<details>` (unlike those components) isn't unmounted when closed.
 */
const useDismissDetailsOnOutsideClick = (ref: React.RefObject<HTMLDetailsElement | null>) => {
  useEffect(() => {
    const dismissIfOutside = (event: Event) => {
      const el = ref.current;
      if (el?.open && !el.contains(event.target as Node)) el.removeAttribute("open");
    };
    window.addEventListener("pointerdown", dismissIfOutside, true);
    window.addEventListener("mousedown", dismissIfOutside, true);
    return () => {
      window.removeEventListener("pointerdown", dismissIfOutside, true);
      window.removeEventListener("mousedown", dismissIfOutside, true);
    };
  }, [ref]);
};

/**
 * A labeled dropdown for a group's long-tail tools - wires up the
 * `.srte-toolbar-menu`/`.srte-menu` CSS `theme.ts` already defines but the
 * pre-redesign toolbar never used. `<details>/<summary>` gives free
 * keyboard support (Enter/Space to open, native focus handling) without a
 * new open/close state to manage; outside-click dismiss is handled by
 * useDismissDetailsOnOutsideClick above.
 *
 * The panel itself renders `position: fixed` with JS-measured coordinates
 * (docs/bugs/toolbar-dropdown-clipped-by-host-overflow-hidden.md), the same
 * pattern ColorPickerPopover/TableBorderPopover already use - a real host
 * can (and, reported live, does) wrap the editor in an `overflow: hidden`
 * container for its own layout reasons; a `position: absolute` panel
 * anchored inside that container gets visually clipped the moment it needs
 * to extend past the container's own bounds, which is exactly when a
 * narrow host is most likely to need the dropdown in the first place.
 * `position: fixed`'s containing block is normally the viewport, so this
 * escapes ANY ancestor's overflow clipping regardless of DOM depth - unless
 * an ancestor has its own transform/perspective/filter, which becomes the
 * containing block instead (see fixedPositioning.ts, and
 * docs/bugs/toolbar-menu-misplaced-inside-transformed-ancestor.md); the
 * placement math below accounts for that case too.
 */
export function ToolbarDropdown({ icon, label, priority, children }: {
  icon?: ToolbarIconKey;
  label: string;
  /** Mirrors theme.ts's `[data-srte-priority]` responsive rules - 2 collapses into the mobile "More" menu before 1 (never collapses), leaving priority 3 whole *groups* to collapse first. */
  priority?: 2;
  children: React.ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  useDismissDetailsOnOutsideClick(detailsRef);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const recompute = () => {
      if (!details.open) { setPlacement(null); return; }
      const margin = 8;
      const triggerRect = details.getBoundingClientRect();
      const menu = details.querySelector<HTMLElement>(":scope > .srte-menu");
      const menuWidth = menu?.offsetWidth ?? 210;
      const menuHeight = menu?.offsetHeight ?? 0;
      const bounds = getPositioningBounds(details);
      const left = Math.min(Math.max(bounds.left + margin, triggerRect.left), Math.max(bounds.left + margin, bounds.right - menuWidth - margin));
      const overflowsBottom = triggerRect.bottom + 6 + menuHeight > bounds.bottom - margin;
      const top = overflowsBottom ? Math.max(bounds.top + margin, triggerRect.top - menuHeight - 6) : triggerRect.bottom + 6;
      const origin = getFixedPositioningOrigin(details);
      setPlacement({ left: left - origin.left, top: top - origin.top });
    };
    recompute();
    details.addEventListener("toggle", recompute);
    return () => details.removeEventListener("toggle", recompute);
  }, []);

  return <details ref={detailsRef} className="srte-toolbar-menu" {...(priority ? { "data-srte-priority": priority } : {})}>
    {/* preventDefault here matches every ToolbarButton/ToolbarMenuItem -
        without it, opening the dropdown focuses the <summary> itself,
        stealing focus (and the live text selection) away from the editor
        before the user ever reaches the tool they opened it for. */}
    <summary className="srte-tool-button srte-menu-trigger" onMouseDown={(event) => event.preventDefault()}>
      {icon ? toolbarIcons[icon] : null}
      <span>{label}</span>
      <ChevronDown width={13} height={13} strokeWidth={2} aria-hidden="true" />
    </summary>
    <div
      className="srte-menu"
      role="menu"
      data-srte-menu-fixed="true"
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, visibility: placement ? "visible" : "hidden" }}
    >
      {children}
    </div>
  </details>;
}

/** A visually-separated cluster of controls, optionally collapsing as a whole unit on narrow viewports (theme.ts's `.srte-toolbar-group[data-srte-priority="3"]`). */
export function ToolbarGroup({ priority, children }: { priority?: 3; children: React.ReactNode }) {
  return <span className="srte-toolbar-group" {...(priority ? { "data-srte-priority": priority } : {})}>{children}</span>;
}

/**
 * The narrow-viewport overflow trigger - `.srte-mobile-more` is CSS-hidden
 * except under theme.ts's `max-width: 639px` rules, which also hide every
 * `[data-srte-priority="2"]`/`[data-srte-priority="3"]` element. Its own
 * menu statically lists every tool that lives inside one of those
 * collapsing dropdowns/groups, so nothing becomes unreachable once the
 * primary row starts shedding groups - this is plain CSS visibility
 * toggling of pre-rendered content, not JS media-query logic, matching how
 * the rest of this responsive system already works.
 *
 * The panel itself renders `position: fixed` with JS-measured coordinates,
 * the same fix and reasoning as `ToolbarDropdown` (docs/bugs/
 * toolbar-dropdown-clipped-by-host-overflow-hidden.md) - this component was
 * NOT covered by that fix at the time (incorrectly assumed to be
 * unaffected since it already had its own separate mobile CSS), but it has
 * the exact same `position: absolute` vulnerability to a host's own
 * `overflow: hidden` container, and since this is the ONLY toolbar
 * overflow affordance on narrow viewports (every ToolbarDropdown hides
 * entirely below the mobile breakpoint), a clipped host is more likely to
 * matter here, not less. Confirmed live: a real narrow host wrapping the
 * editor in `overflow: hidden` computed this panel at `left: -214px` -
 * mostly off-screen, functionally invisible despite being technically
 * present in the DOM.
 */
export function MobileMoreMenu({ children }: { children: React.ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  useDismissDetailsOnOutsideClick(detailsRef);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const recompute = () => {
      if (!details.open) { setPlacement(null); return; }
      const margin = 8;
      const triggerRect = details.getBoundingClientRect();
      const menu = details.querySelector<HTMLElement>(":scope > .srte-menu");
      const bounds = getPositioningBounds(details);
      const menuWidth = menu?.offsetWidth ?? Math.min(280, bounds.right - bounds.left - 16);
      const menuHeight = menu?.offsetHeight ?? 0;
      // Right-aligned to the trigger, matching this menu's original
      // CSS-only `right: 0` intent - clamped into the effective bounds
      // instead of being allowed to run off them or get clipped by an
      // ancestor.
      const preferredLeft = triggerRect.right - menuWidth;
      const left = Math.min(Math.max(bounds.left + margin, preferredLeft), Math.max(bounds.left + margin, bounds.right - menuWidth - margin));
      const overflowsBottom = triggerRect.bottom + 6 + menuHeight > bounds.bottom - margin;
      const top = overflowsBottom ? Math.max(bounds.top + margin, triggerRect.top - menuHeight - 6) : triggerRect.bottom + 6;
      const origin = getFixedPositioningOrigin(details);
      setPlacement({ left: left - origin.left, top: top - origin.top });
    };
    recompute();
    details.addEventListener("toggle", recompute);
    return () => details.removeEventListener("toggle", recompute);
  }, []);

  return <details ref={detailsRef} className="srte-toolbar-menu srte-mobile-more">
    <summary className="srte-tool-button srte-menu-trigger" aria-label="More tools" onMouseDown={(event) => event.preventDefault()}>
      {toolbarIcons.more}
    </summary>
    <div
      className="srte-menu"
      role="menu"
      data-srte-menu-fixed="true"
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, visibility: placement ? "visible" : "hidden" }}
    >
      {children}
    </div>
  </details>;
}
