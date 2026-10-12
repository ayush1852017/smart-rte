import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  blockDropTargets,
  createNodeId,
  isMovableBlockMedia,
  isTextNode,
  planBlockMove,
  type BlockDropTarget,
  type SmartElementNode,
  type SmartNode,
  type SmartSelection,
} from "smartrte-core/foundation";
import type { CanonicalEditorRuntime } from "../canonicalEditorRuntime.js";
import { getFixedPositioningOrigin } from "./fixedPositioning.js";

/**
 * Drag-and-drop for block media (1.3.0): images, video, audio, block
 * formulas, dividers and page breaks. Built on Pointer Events (mouse, pen,
 * touch) with its own thumbnail preview, never on native HTML5 drag-and-drop
 * - see docs/bugs/block-media-cannot-be-dragged.md for why native drag
 * duplicates or silently fails here. Text drag-and-drop is untouched (it
 * stays on surface/input.ts's native path).
 *
 * Core does the decision-making (`blockDropTargets` lists the legal slots,
 * `planBlockMove` turns one into a single `moveNode`); this component only
 * maps the pointer or keyboard to one of those slots and draws the UI: the
 * grab handle, the shrunken preview, the dimmed original, the drop line.
 */

export interface MediaDragControllerProps {
  runtime: CanonicalEditorRuntime;
  /** The editing surface (contenteditable root). */
  root: HTMLElement | null;
  /** False in read-only mode: no handle, no dragging. */
  enabled: boolean;
  /** When set, the handle is shown disabled with this as its tooltip and nothing drags (e.g. track changes is on). */
  disabledReason?: string;
  /** The selected node, if any - its handle stays visible (and Tab-reachable) while it's selected. */
  selectedNodeId: string | null;
  onDraggingChange?: (dragging: boolean, nodeId: string) => void;
  /** After a committed move; the node is selected by then. */
  onMoved?: (nodeId: string) => void;
  /** Layout seam for tests (jsdom has no layout). Defaults to getBoundingClientRect. */
  measure?: (element: Element) => Rect;
}

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }

/** Movement (px) past which a press on the media itself becomes a drag rather than a click. */
export const DIRECT_DRAG_THRESHOLD = 6;
/** Touch: hold this long without moving before a press on the media starts a drag, so ordinary scrolling never does. */
export const TOUCH_LONG_PRESS_MS = 450;
const AUTO_SCROLL_EDGE = 40;
const AUTO_SCROLL_MAX_SPEED = 18;
const PREVIEW_MAX_WIDTH = 120;
const PREVIEW_MAX_HEIGHT = 80;
const PREVIEW_OFFSET = 12;
const HANDLE_SIZE = 24;

const MEDIA_SELECTOR = '[data-smart-atomic][draggable="false"]';
const CAPTION_SELECTOR = '[data-smart-projection="image-caption"]';

const kindLabel = (type: string): string => ({
  block_image: "image", video: "video", audio: "audio", block_formula: "formula", divider: "divider", page_break: "page break",
} as Record<string, string>)[type] || "media";

const truncate = (value: string, max = 40) => value.length > max ? `${value.slice(0, max - 1)}…` : value;

const nodeName = (node: SmartElementNode): string => {
  const attrs = node.attrs || {};
  const name = [attrs.caption, attrs.alt, attrs.latex, attrs.title].find((value) => typeof value === "string" && value.trim());
  return typeof name === "string" ? truncate(name.trim()) : "";
};

const describeNode = (node: SmartElementNode): string => {
  const name = nodeName(node);
  return name ? `${kindLabel(node.type)} '${name}'` : kindLabel(node.type);
};

const MEDIA_TYPES = new Set(["block_image", "video", "audio", "block_formula", "divider", "page_break"]);

/** Short plain text naming a block, for screen-reader drop positions. */
const blockTextOf = (node: SmartNode | null | undefined): string => {
  if (!node) return "";
  if (isTextNode(node)) return node.text;
  if (MEDIA_TYPES.has(node.type)) return describeNode(node);
  return (node.children || []).map(blockTextOf).join(" ").replace(/\s+/g, " ").trim();
};

const findNode = (root: SmartNode, id: string): SmartElementNode | null => {
  if (isTextNode(root)) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
};

const defaultMeasure = (element: Element): Rect => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
};

const union = (a: Rect, b: Rect | null): Rect => {
  if (!b) return a;
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.right, b.right);
  const bottom = Math.max(a.bottom, b.bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
};

const contains = (rect: Rect, x: number, y: number) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

/** Lexicographic order of slot paths, prefix first: exactly visual (document) order. */
const comparePaths = (left: readonly number[], right: readonly number[]): number => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
};

interface GeoTarget {
  target: BlockDropTarget | null; // null = the node's own slot (a no-op)
  lineY: number;
  left: number;
  right: number;
  container: Rect;
  depth: number;
  path: number[];
}

interface Session {
  nodeId: string;
  mode: "pointer" | "keyboard";
  pointerId?: number;
  targets: GeoTarget[];
  own: GeoTarget;
  sourceRect: Rect;
  rootRect: Rect;
  current: GeoTarget | null;
  x: number;
  y: number;
  previousSelection: SmartSelection;
  sourceElements: HTMLElement[];
  label: string;
}

interface Pending {
  pointerId: number;
  pointerType: string;
  nodeId: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** The model selection before the press, restored if the drag is cancelled. */
  previousSelection: SmartSelection;
}

interface Preview { x: number; y: number; src?: string; aspect?: number; label: string; caption?: string }

const visuallyHidden: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
};

export function MediaDragController({ runtime, root, enabled, disabledReason, selectedNodeId, onDraggingChange, onMoved, measure = defaultMeasure }: MediaDragControllerProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [handleRect, setHandleRect] = useState<{ left: number; top: number } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [indicator, setIndicator] = useState<{ line: { left: number; top: number; width: number } | null; container: Rect | null; blocked: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onDraggingChange, onMoved, measure });
  callbacks.current = { onDraggingChange, onMoved, measure };
  const active = enabled && !disabledReason;

  const schema = runtime.editor.schema;
  const elementFor = useCallback((id: string) => runtime.surface.renderer?.mapping.nodeToDom(id) as HTMLElement | undefined, [runtime]);
  const mediaNode = useCallback((id: string | null) => {
    if (!id) return null;
    const node = findNode(runtime.editor.document, id);
    return node && isMovableBlockMedia(node, schema) ? node : null;
  }, [runtime, schema]);

  /** The media element plus its caption projection, if any - what's dimmed and measured as "the original". */
  const sourceElementsFor = useCallback((id: string): HTMLElement[] => {
    const element = elementFor(id);
    if (!element) return [];
    const next = element.nextElementSibling;
    return next instanceof HTMLElement && next.matches(CAPTION_SELECTOR) && next.getAttribute("data-smart-caption-for") === id ? [element, next] : [element];
  }, [elementFor]);

  const outerRect = useCallback((id: string): Rect | null => {
    const [element, caption] = sourceElementsFor(id);
    if (!element) return null;
    return union(callbacks.current.measure(element), caption ? callbacks.current.measure(caption) : null);
  }, [sourceElementsFor]);

  // ---- Geometry: computed at drag start, refreshed on scroll/resize/remote change, never per pointer move.
  const buildGeometry = useCallback((nodeId: string): Pick<Session, "targets" | "own" | "sourceRect" | "rootRect"> | null => {
    if (!root) return null;
    const document = runtime.editor.document;
    const measureEl = callbacks.current.measure;
    const rootRect = measureEl(root);
    const sourceRect = outerRect(nodeId);
    if (!sourceRect) return null;
    const containerRect = (parentId: string) => {
      const element = parentId === document.id ? root : elementFor(parentId);
      return element ? measureEl(element) : null;
    };
    const geo = (target: BlockDropTarget): GeoTarget | null => {
      const container = containerRect(target.parentId);
      if (!container) return null;
      const above = target.afterNodeId ? outerRect(target.afterNodeId) : null;
      const belowElement = target.beforeNodeId ? elementFor(target.beforeNodeId) : null;
      const below = belowElement ? measureEl(belowElement) : null;
      const lineY = above && below ? (above.bottom + below.top) / 2 : below ? below.top : above ? above.bottom : container.top + 4;
      return { target, lineY, left: container.left + 4, right: container.right - 4, container, depth: target.depth, path: [...target.parentPath, target.index] };
    };
    const targets = blockDropTargets(document, schema, nodeId).map(geo).filter((value): value is GeoTarget => Boolean(value));
    // The node's own slot: a no-op the keyboard can return to, and the pointer's "drop here = cancel" zone.
    const own = (() => {
      const find = (node: SmartNode, path: number[]): number[] | null => {
        if (isTextNode(node)) return null;
        const children = node.children || [];
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index];
          if (!isTextNode(child) && child.id === nodeId) return [...path, index];
          const found = find(child, [...path, index]);
          if (found) return found;
        }
        return null;
      };
      const path = find(document, []) || [];
      return { target: null, lineY: sourceRect.top, left: sourceRect.left, right: sourceRect.right, container: sourceRect, depth: Math.max(0, path.length - 1), path: [...path.slice(0, -1), (path.at(-1) ?? 0) + 0.5] };
    })();
    return { targets, own, sourceRect, rootRect };
  }, [root, runtime, schema, elementFor, outerRect]);

  /** Nearest legal slot to the pointer, preferring the deepest container under it; `own` over the original; null outside the editor. */
  const pick = useCallback((session: Session, x: number, y: number): GeoTarget | null => {
    if (!contains(session.rootRect, x, y)) return null;
    if (y >= session.sourceRect.top && y <= session.sourceRect.bottom) return session.own;
    let depth = 0;
    for (const candidate of session.targets) if (candidate.depth > depth && contains(candidate.container, x, y)) depth = candidate.depth;
    const pool = session.targets.filter((candidate) => candidate.depth === depth && (depth === 0 || contains(candidate.container, x, y)));
    let best: GeoTarget | null = null;
    for (const candidate of pool) if (!best || Math.abs(candidate.lineY - y) < Math.abs(best.lineY - y)) best = candidate;
    return best;
  }, []);

  const describeTarget = useCallback((target: GeoTarget | null): string => {
    if (!target || !target.target) return "Drop position: current position.";
    const document = runtime.editor.document;
    const { afterNodeId, beforeNodeId, parentId } = target.target;
    const parent = parentId === document.id ? null : findNode(document, parentId);
    const where = parent ? ({ table_cell: " in table cell", list_item: " in list item", blockquote: " in quote" } as Record<string, string>)[parent.type] || "" : "";
    const after = afterNodeId ? truncate(blockTextOf(findNode(document, afterNodeId))) : "";
    const before = beforeNodeId ? truncate(blockTextOf(findNode(document, beforeNodeId))) : "";
    if (after) return `Drop position: after '${after}'${where}.`;
    if (before) return `Drop position: before '${before}'${where}.`;
    return `Drop position: start${where}.`;
  }, [runtime]);

  const showTarget = useCallback((session: Session) => {
    const target = session.current;
    if (!target) {
      setIndicator({ line: null, container: null, blocked: session.mode === "pointer" });
      return;
    }
    if (!target.target) {
      setIndicator({ line: null, container: null, blocked: false });
      return;
    }
    setIndicator({
      line: { left: target.left, top: target.lineY - 1, width: Math.max(0, target.right - target.left) },
      container: target.depth > 0 ? target.container : null,
      blocked: false,
    });
  }, []);

  const frame = (callback: () => void): number => {
    const view = root?.ownerDocument.defaultView;
    return view?.requestAnimationFrame ? view.requestAnimationFrame(callback) : Number(setTimeout(callback, 16));
  };
  const stopAutoScroll = () => {
    const view = root?.ownerDocument.defaultView;
    if (autoScrollRef.current !== null) {
      if (view?.cancelAnimationFrame) view.cancelAnimationFrame(autoScrollRef.current); else clearTimeout(autoScrollRef.current);
    }
    autoScrollRef.current = null;
  };

  const endSession = useCallback((outcome: "moved" | "cancelled") => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    stopAutoScroll();
    session.sourceElements.forEach((element) => element.removeAttribute("data-srte-drag-source"));
    root?.removeAttribute("data-srte-media-dragging");
    setPreview(null);
    setIndicator(null);
    setDragNodeId(null);
    callbacks.current.onDraggingChange?.(false, session.nodeId);
    if (outcome === "cancelled") {
      setAnnouncement("Move cancelled.");
      // The pointer may have dragged a native text selection across the
      // editor before the threshold; put back what was selected.
      try { runtime.editor.setSelection(session.previousSelection, { source: "api" }); } catch { /* the document changed under it */ }
      if (session.mode === "keyboard") handleRef.current?.focus();
    } else setAnnouncement("Moved.");
  }, [root, runtime]);

  const drop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    // Re-resolve by node ids at drop time: a remote edit may have arrived mid-drag.
    if (session.mode === "pointer") {
      const fresh = buildGeometry(session.nodeId);
      if (!fresh) { endSession("cancelled"); return; }
      Object.assign(session, fresh);
      session.current = pick(session, session.x, session.y);
    }
    const target = session.current?.target;
    const operations = target ? planBlockMove(runtime.editor.document, schema, session.nodeId, target, { idFactory: createNodeId }) : null;
    if (!operations) { endSession("cancelled"); return; }
    const nodeId = session.nodeId;
    endSession("moved");
    runtime.executeOperations(operations, { selectNodeId: nodeId });
    callbacks.current.onMoved?.(nodeId);
  }, [buildGeometry, endSession, pick, runtime, schema]);

  const startSession = useCallback((nodeId: string, mode: Session["mode"], x: number, y: number, pointerId?: number, previousSelection?: SmartSelection) => {
    if (sessionRef.current || !root) return false;
    const node = mediaNode(nodeId);
    const geometry = node ? buildGeometry(nodeId) : null;
    if (!node || !geometry) return false;
    const sourceElements = sourceElementsFor(nodeId);
    const session: Session = {
      nodeId, mode, pointerId, ...geometry, current: null, x, y,
      previousSelection: previousSelection ?? runtime.editor.selection,
      sourceElements,
      label: describeNode(node),
    };
    sessionRef.current = session;
    sourceElements.forEach((element) => element.setAttribute("data-srte-drag-source", "true"));
    root.setAttribute("data-srte-media-dragging", "true");
    setDragNodeId(nodeId);
    callbacks.current.onDraggingChange?.(true, nodeId);
    if (mode === "pointer") {
      // Drop any native selection the press started; none can extend while
      // dragging (user-select is off for the surface via the attribute above).
      root.ownerDocument.getSelection()?.removeAllRanges();
      const src = node.type === "block_image" && typeof node.attrs?.src === "string" ? node.attrs.src : undefined;
      const width = Number(node.attrs?.width) || geometry.sourceRect.width || PREVIEW_MAX_WIDTH;
      const height = Number(node.attrs?.height) || geometry.sourceRect.height || PREVIEW_MAX_HEIGHT;
      const latex = typeof node.attrs?.latex === "string" ? truncate(node.attrs.latex, 24) : "";
      const label = node.type === "block_formula" && latex ? `Formula: ${latex}` : kindLabel(node.type).replace(/^./, (letter) => letter.toUpperCase());
      setPreview({ x, y, src, aspect: width / height, label, caption: typeof node.attrs?.caption === "string" ? truncate(node.attrs.caption, 60) : undefined });
      session.current = pick(session, x, y);
      showTarget(session);
    } else {
      session.current = session.own;
      showTarget(session);
      setAnnouncement(`Picked up ${session.label}. Use up and down arrows to choose where to drop, Enter to drop, Escape to cancel.`);
    }
    return true;
  }, [root, mediaNode, buildGeometry, sourceElementsFor, runtime, pick, showTarget]);

  // ---- Auto-scroll near the scroll container's (or the page's) top/bottom edge.
  const scrollContainer = useCallback((): HTMLElement | null => {
    for (let element: HTMLElement | null = root; element; element = element.parentElement) {
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      if (style && /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return element;
    }
    return null;
  }, [root]);

  const autoScroll = useCallback(() => {
    stopAutoScroll();
    const step = () => {
      const session = sessionRef.current;
      if (!session || session.mode !== "pointer" || !root) { autoScrollRef.current = null; return; }
      const view = root.ownerDocument.defaultView!;
      const speed = (distance: number) => Math.ceil(AUTO_SCROLL_MAX_SPEED * (1 - Math.max(0, distance) / AUTO_SCROLL_EDGE));
      let scrolled = false;
      const container = scrollContainer();
      if (container) {
        const rect = callbacks.current.measure(container);
        const top = Math.max(rect.top, 0);
        const bottom = Math.min(rect.bottom, view.innerHeight);
        if (session.y < top + AUTO_SCROLL_EDGE && container.scrollTop > 0) { container.scrollTop -= speed(session.y - top); scrolled = true; }
        else if (session.y > bottom - AUTO_SCROLL_EDGE && container.scrollTop + container.clientHeight < container.scrollHeight) { container.scrollTop += speed(bottom - session.y); scrolled = true; }
      }
      if (!scrolled) {
        const page = root.ownerDocument.scrollingElement;
        if (page && session.y < AUTO_SCROLL_EDGE && page.scrollTop > 0) { view.scrollBy(0, -speed(session.y)); scrolled = true; }
        else if (page && session.y > view.innerHeight - AUTO_SCROLL_EDGE && page.scrollTop + view.innerHeight < page.scrollHeight) { view.scrollBy(0, speed(view.innerHeight - session.y)); scrolled = true; }
      }
      if (scrolled) {
        const fresh = buildGeometry(session.nodeId);
        if (fresh) Object.assign(session, fresh);
        session.current = pick(session, session.x, session.y);
        showTarget(session);
        autoScrollRef.current = frame(step);
      } else autoScrollRef.current = null;
    };
    autoScrollRef.current = frame(step);
  }, [root, scrollContainer, buildGeometry, pick, showTarget]);

  // ---- Pointer: direct drag on the media, and the global move/up/cancel/key handling while pending or dragging.
  useEffect(() => {
    if (!root || !active) return;
    const view = root.ownerDocument.defaultView!;
    const clearPending = () => {
      const pending = pendingRef.current;
      if (pending?.timer) clearTimeout(pending.timer);
      pendingRef.current = null;
    };
    const mediaIdAt = (target: EventTarget | null): string | null => {
      const element = target instanceof Element ? target.closest<HTMLElement>(MEDIA_SELECTOR) : null;
      if (!element || !root.contains(element)) return null;
      const id = runtime.surface.renderer?.mapping.domToNode(element)?.nodeId ?? null;
      return id && mediaNode(id) ? id : null;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (sessionRef.current || pendingRef.current || event.button !== 0 || event.isPrimary === false) return;
      const nodeId = mediaIdAt(event.target);
      if (!nodeId) return;
      const previousSelection = runtime.editor.selection;
      const pending: Pending = { pointerId: event.pointerId, pointerType: event.pointerType || "mouse", nodeId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, timer: null, previousSelection };
      if (pending.pointerType === "touch") {
        pending.timer = setTimeout(() => {
          if (pendingRef.current !== pending) return;
          pendingRef.current = null;
          startSession(nodeId, "pointer", pending.x, pending.y, pending.pointerId, previousSelection);
        }, TOUCH_LONG_PRESS_MS);
      }
      pendingRef.current = pending;
    };
    const onPointerMove = (event: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending && event.pointerId === pending.pointerId) {
        pending.x = event.clientX;
        pending.y = event.clientY;
        const moved = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) > DIRECT_DRAG_THRESHOLD;
        if (!moved) return;
        if (pending.pointerType === "touch") { clearPending(); return; } // moving before the long press = a scroll
        clearPending();
        startSession(pending.nodeId, "pointer", event.clientX, event.clientY, pending.pointerId, pending.previousSelection);
        return;
      }
      const session = sessionRef.current;
      if (!session || session.mode !== "pointer" || event.pointerId !== session.pointerId) return;
      event.preventDefault();
      session.x = event.clientX;
      session.y = event.clientY;
      setPreview((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
      session.current = pick(session, event.clientX, event.clientY);
      showTarget(session);
      autoScroll();
    };
    const suppressNextClick = () => {
      const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault(); };
      view.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => view.removeEventListener("click", swallow, { capture: true }), 0);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pendingRef.current?.pointerId === event.pointerId) { clearPending(); return; }
      const session = sessionRef.current;
      if (!session || session.mode !== "pointer" || event.pointerId !== session.pointerId) return;
      session.x = event.clientX;
      session.y = event.clientY;
      suppressNextClick();
      drop();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (pendingRef.current?.pointerId === event.pointerId) { clearPending(); return; }
      const session = sessionRef.current;
      if (session?.mode === "pointer" && event.pointerId === session.pointerId) endSession("cancelled");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const session = sessionRef.current;
      if (!session || session.mode !== "pointer") return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); endSession("cancelled"); }
      // Undo during a drag cancels the drag first; the undo itself still runs.
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") endSession("cancelled");
    };
    const onTouchMove = (event: TouchEvent) => { if (sessionRef.current?.mode === "pointer") event.preventDefault(); };
    const onSelectStart = (event: Event) => { if (sessionRef.current) event.preventDefault(); };
    root.addEventListener("pointerdown", onPointerDown);
    view.addEventListener("pointermove", onPointerMove, { passive: false });
    view.addEventListener("pointerup", onPointerUp);
    view.addEventListener("pointercancel", onPointerCancel);
    view.addEventListener("keydown", onKeyDown, true);
    view.addEventListener("touchmove", onTouchMove, { passive: false });
    root.ownerDocument.addEventListener("selectstart", onSelectStart);
    return () => {
      clearPending();
      root.removeEventListener("pointerdown", onPointerDown);
      view.removeEventListener("pointermove", onPointerMove);
      view.removeEventListener("pointerup", onPointerUp);
      view.removeEventListener("pointercancel", onPointerCancel);
      view.removeEventListener("keydown", onKeyDown, true);
      view.removeEventListener("touchmove", onTouchMove);
      root.ownerDocument.removeEventListener("selectstart", onSelectStart);
    };
  }, [root, active, runtime, mediaNode, startSession, pick, showTarget, autoScroll, drop, endSession]);

  // Leaving read-only/enabled state, or unmounting, mid-drag cancels it.
  useEffect(() => { if (!active && sessionRef.current) endSession("cancelled"); }, [active, endSession]);
  useEffect(() => () => { if (sessionRef.current) endSession("cancelled"); }, [endSession]);

  // ---- Remote/other edits mid-drag: re-resolve by ids; cancel if the node is gone.
  useEffect(() => runtime.editor.subscribe((transaction) => {
    const session = sessionRef.current;
    if (!session || !transaction.operations.length) return;
    if (!mediaNode(session.nodeId)) { endSession("cancelled"); return; }
    const fresh = buildGeometry(session.nodeId);
    if (!fresh) { endSession("cancelled"); return; }
    Object.assign(session, fresh);
    session.current = session.mode === "pointer" ? pick(session, session.x, session.y) : session.own;
    session.sourceElements.forEach((element) => element.removeAttribute("data-srte-drag-source"));
    session.sourceElements = sourceElementsFor(session.nodeId);
    session.sourceElements.forEach((element) => element.setAttribute("data-srte-drag-source", "true"));
    showTarget(session);
  }), [runtime, mediaNode, buildGeometry, pick, showTarget, endSession, sourceElementsFor]);

  // Scroll/resize during a drag moves everything under the pointer: refresh the cached rects.
  useEffect(() => {
    if (!dragNodeId || !root) return;
    const view = root.ownerDocument.defaultView!;
    const refresh = () => {
      const session = sessionRef.current;
      if (!session) return;
      const fresh = buildGeometry(session.nodeId);
      if (fresh) Object.assign(session, fresh);
      if (session.mode === "pointer") session.current = pick(session, session.x, session.y);
      else if (session.current) session.current = [session.own, ...session.targets].find((candidate) => comparePaths(candidate.path, session.current!.path) === 0) ?? session.own;
      showTarget(session);
    };
    view.addEventListener("scroll", refresh, true);
    view.addEventListener("resize", refresh);
    return () => { view.removeEventListener("scroll", refresh, true); view.removeEventListener("resize", refresh); };
  }, [dragNodeId, root, buildGeometry, pick, showTarget]);

  // ---- Hover tracking for the grab handle.
  useEffect(() => {
    if (!root || !enabled) return;
    const onMove = (event: PointerEvent) => {
      if (sessionRef.current || event.pointerType === "touch") return;
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>(`${MEDIA_SELECTOR}, ${CAPTION_SELECTOR}`) : null;
      let id: string | null = null;
      if (element?.matches(CAPTION_SELECTOR)) id = element.getAttribute("data-smart-caption-for");
      else if (element) id = runtime.surface.renderer?.mapping.domToNode(element)?.nodeId ?? null;
      if (id && mediaNode(id)) {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
        setHoverId(id);
      } else if (!hideTimerRef.current) {
        hideTimerRef.current = setTimeout(() => { hideTimerRef.current = null; setHoverId(null); }, 300);
      }
    };
    const onLeave = () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => { hideTimerRef.current = null; setHoverId(null); }, 300);
    };
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    };
  }, [root, enabled, runtime, mediaNode]);

  const handleNodeId = enabled ? (dragNodeId ?? hoverId ?? (mediaNode(selectedNodeId) ? selectedNodeId : null)) : null;
  const handleNode = mediaNode(handleNodeId);

  // Position the handle beside the media's top edge, outside its box.
  useLayoutEffect(() => {
    if (!handleNodeId || !root) { setHandleRect(null); return; }
    const place = () => {
      const element = elementFor(handleNodeId);
      if (!element || !element.isConnected) { setHandleRect(null); return; }
      const rect = callbacks.current.measure(element);
      const rootRect = callbacks.current.measure(root);
      // Never over the media itself (it would block clicks on it): left of
      // it if there's room in the surface, else right of it (a left-aligned
      // image sits against the edge), else just above its top-left corner.
      const gap = 4;
      let left = rect.left - HANDLE_SIZE - gap;
      let top = rect.top;
      if (left < rootRect.left) {
        left = rect.right + gap;
        if (left + HANDLE_SIZE > rootRect.right) {
          left = Math.max(rootRect.left, rect.left);
          top = rect.top - HANDLE_SIZE - gap;
        }
      }
      setHandleRect((current) => current && current.left === left && current.top === top ? current : { left, top });
    };
    place();
    const view = root.ownerDocument.defaultView!;
    view.addEventListener("scroll", place, true);
    view.addEventListener("resize", place);
    const unsubscribe = runtime.editor.subscribe(() => place());
    return () => { view.removeEventListener("scroll", place, true); view.removeEventListener("resize", place); unsubscribe(); };
  }, [handleNodeId, root, elementFor, runtime]);

  // ---- Keyboard move from the focused handle.
  const onHandleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!handleNodeId || !active) return;
    const session = sessionRef.current;
    if (!session) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        startSession(handleNodeId, "keyboard", 0, 0);
      }
      return;
    }
    if (session.mode !== "keyboard") return;
    if (event.key === "Escape") { event.preventDefault(); endSession("cancelled"); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (session.current?.target) drop(); else endSession("cancelled"); return; }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const ordered = [session.own, ...session.targets].sort((left, right) => comparePaths(left.path, right.path));
      const index = Math.max(0, ordered.indexOf(session.current ?? session.own));
      const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
      session.current = next;
      showTarget(session);
      setAnnouncement(describeTarget(next));
      if (next.target) {
        const anchor = next.target.beforeNodeId ? elementFor(next.target.beforeNodeId) : next.target.afterNodeId ? elementFor(next.target.afterNodeId) : null;
        anchor?.scrollIntoView?.({ block: "nearest" });
      }
    }
  };

  const onHandlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!handleNodeId || !active || event.button !== 0 || sessionRef.current) return;
    event.preventDefault();
    startSession(handleNodeId, "pointer", event.clientX, event.clientY, event.pointerId);
  };

  const kind = handleNode ? kindLabel(handleNode.type) : "media";
  // Every rect above is viewport space; a transformed/contained host (e.g. a
  // dialog) becomes these fixed elements' containing block, so shift by its
  // origin like every other overlay here (fixedPositioning.ts). The surface
  // and these elements share a parent, so the surface's origin is theirs.
  const showsAnything = Boolean((handleNode && handleRect) || preview || indicator);
  const origin = showsAnything && root ? getFixedPositioningOrigin(root) : { left: 0, top: 0 };
  return <>
    {handleNode && handleRect && <button
      ref={handleRef}
      type="button"
      data-smart-ui="media-drag-handle"
      data-srte-media-drag-handle="true"
      aria-label={`Drag to move ${kind}`}
      aria-disabled={!active || undefined}
      title={disabledReason || `Drag to move ${kind}. Or press Space, then the arrow keys.`}
      className="srte-media-drag-handle"
      style={{ position: "fixed", left: handleRect.left - origin.left, top: handleRect.top - origin.top, width: HANDLE_SIZE, height: HANDLE_SIZE }}
      onPointerDown={onHandlePointerDown}
      onPointerEnter={() => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }}
      onPointerLeave={() => { if (!sessionRef.current) { hideTimerRef.current = setTimeout(() => { hideTimerRef.current = null; setHoverId(null); }, 300); } }}
      onKeyDown={onHandleKeyDown}
      onBlur={() => { if (sessionRef.current?.mode === "keyboard") endSession("cancelled"); }}
    >
      <svg aria-hidden="true" width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
        <circle cx="3" cy="3" r="1.5" /><circle cx="9" cy="3" r="1.5" />
        <circle cx="3" cy="8" r="1.5" /><circle cx="9" cy="8" r="1.5" />
        <circle cx="3" cy="13" r="1.5" /><circle cx="9" cy="13" r="1.5" />
      </svg>
    </button>}
    {preview && <div className="srte-media-drag-preview" data-srte-media-drag-preview="true" aria-hidden="true"
      style={{ position: "fixed", left: preview.x + PREVIEW_OFFSET - origin.left, top: preview.y + PREVIEW_OFFSET - origin.top }}>
      {preview.src
        ? <img src={preview.src} alt="" draggable={false} style={previewImageSize(preview.aspect)} />
        : <span className="srte-media-drag-chip">{preview.label}</span>}
      {preview.caption && <span className="srte-media-drag-caption">{preview.caption}</span>}
    </div>}
    {indicator?.container && <div className="srte-media-drop-container" data-srte-media-drop-container="true" aria-hidden="true"
      style={{ position: "fixed", left: indicator.container.left - origin.left, top: indicator.container.top - origin.top, width: indicator.container.width, height: indicator.container.height }} />}
    {indicator?.line && <div className="srte-media-drop-line" data-srte-media-drop-line="true" aria-hidden="true"
      style={{ position: "fixed", left: indicator.line.left - origin.left, top: indicator.line.top - origin.top, width: indicator.line.width }} />}
    {indicator?.blocked && <style>{".srte-editor [data-srte-media-dragging], .srte-editor [data-srte-media-dragging] * { cursor: not-allowed !important; } body { cursor: not-allowed !important; }"}</style>}
    {enabled && <div role="status" aria-live="polite" data-srte-media-drag-status="true" style={visuallyHidden}>{announcement}</div>}
  </>;
}

const previewImageSize = (aspect = 1.5): React.CSSProperties => {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.5;
  const width = Math.min(PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT * ratio);
  return { width: Math.round(width), height: Math.round(width / ratio), objectFit: "contain", display: "block" };
};
