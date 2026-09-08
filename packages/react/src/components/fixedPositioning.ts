/**
 * Several unrelated CSS mechanisms make an ancestor the containing block for
 * `position: fixed` descendants instead of the viewport, all covered here
 * since any of them can appear independently on a real host page:
 *
 * - `transform`, `perspective`, `filter`, `backdrop-filter` (non-`none`), or
 *   a `will-change` naming one of those (CSS Transforms' rendering model) -
 *   most commonly a Radix/shadcn `Dialog`'s centering transform
 *   (`translate-x-[-50%] translate-y-[-50%]`), confirmed live via a Sootr
 *   host rendering the editor inside such a dialog
 *   (docs/bugs/toolbar-menu-misplaced-inside-transformed-ancestor.md).
 * - `contain: layout | paint | strict | content` (CSS Containment) - a
 *   common perf/isolation optimization on large scrollable containers, e.g.
 *   a second, different Sootr dialog reported still misplacing every
 *   toolbar dropdown ("More list tools", "More to insert", "Save a copy",
 *   "More text styles") despite already running the transform-only fix
 *   above. `layout` alone (without `paint`) was missed in that first pass -
 *   only checked for `paint`/`strict`/`content` - and confirmed directly in
 *   real Chromium to establish the containing block on its own regardless:
 *   a `position: fixed` descendant of a bare `contain: layout` ancestor (no
 *   transform, no paint) resolves its `top`/`left` against that ancestor's
 *   box, not the viewport. A THIRD Sootr dialog using exactly this
 *   (`contain: layout`, no `paint`) reported the same misplacement symptom
 *   again - not a clipping/invisibility symptom (see `getPositioningBounds`
 *   below for that distinct failure mode), just landing in the wrong place
 *   with no error, since the previous check silently treated this ancestor
 *   as if it weren't a containing block at all and fell through to
 *   `{ left: 0, top: 0 }` (viewport-relative) origin math instead.
 *
 *   Deliberately NOT checking bare `container-type` (CSS Containers) -
 *   despite implying `contain: layout style` per spec, verified directly in
 *   real Chromium that `container-type: inline-size` alone does *not* make
 *   an ancestor a `position: fixed` containing block in practice (a
 *   position already correctly computed without any special-casing stayed
 *   correct; adding a check for it actively broke that same case). Only
 *   `contain` itself is checked, matching what's actually verified to
 *   matter, not everything that could theoretically imply it.
 *
 * When any of these apply, `left`/`top` set on a fixed-positioned menu/
 * popover are resolved against that ancestor's border box instead of the
 * viewport, silently producing coordinates that are internally consistent
 * but land far from the trigger with no error.
 *
 * `getBoundingClientRect()` always returns viewport-relative coordinates
 * regardless of any of the above, so every placement calculation in this
 * codebase computes coordinates in viewport space first, then subtracts
 * this origin - the real containing block's own viewport-relative top-left -
 * so the applied `left`/`top` land correctly under any containing block.
 */
export function findFixedPositioningContainer(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    if (
      (style.transform && style.transform !== "none") ||
      (style.perspective && style.perspective !== "none") ||
      (style.filter && style.filter !== "none") ||
      (style.backdropFilter && style.backdropFilter !== "none") ||
      (style.willChange && /transform|perspective|filter/.test(style.willChange)) ||
      (style.contain && /\b(layout|paint|strict|content)\b/.test(style.contain))
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function getFixedPositioningOrigin(el: HTMLElement): { left: number; top: number } {
  const container = findFixedPositioningContainer(el);
  if (!container) return { left: 0, top: 0 };
  const rect = container.getBoundingClientRect();
  return { left: rect.left, top: rect.top };
}

/**
 * Correcting the coordinate origin (above) is only half the fix - every
 * overlay in this codebase also clamps its own placement so a menu never
 * renders off-screen, and every one of those clamps was computed against
 * `window.innerWidth`/`innerHeight`, the *full browser viewport*. That's
 * wrong when the containing-block ancestor is one with `contain: paint`
 * (or `strict`/`content`): CSS guarantees nothing painted by a descendant -
 * including a `position: fixed` one whose containing block it is - can
 * ever be visible outside that ancestor's own border box, no matter what
 * `left`/`top` says. Reported live: a toolbar dropdown near the middle of
 * a `contain: paint` dialog rendered hugging the dialog's own right edge
 * (barely fit), and one further right ("More to insert") was positioned
 * entirely outside the dialog's box and so never painted at all - both
 * fully explained by clamping against the wide browser window instead of
 * the actual, much narrower, clipping ancestor.
 *
 * Deliberately NOT applied for a containing block established only by
 * `transform`/`perspective`/`filter`/`backdrop-filter`/`will-change`, or by
 * `contain: layout` with no `paint`/`strict`/`content` alongside it - none
 * of those clip overflow (`layout` containment only isolates layout
 * calculations, it does not imply paint containment - see the spec note
 * above `findFixedPositioningContainer`), so a menu is free to visually
 * extend past that ancestor's box exactly as it could before any of this
 * positioning logic existed. Verified directly: constraining
 * to such an ancestor's bounds regardless made a mobile "More tools" menu
 * genuinely too tall to fit inside a short transformed host overlap its
 * own trigger instead of just extending past the host's edge (harmless,
 * since nothing there clips it) - a real regression from being too
 * conservative, not a fix.
 */
export function getPositioningBounds(el: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const container = findFixedPositioningContainer(el);
  if (!container) return viewport;
  const containerStyle = window.getComputedStyle(container);
  if (!containerStyle.contain || !/\b(paint|strict|content)\b/.test(containerStyle.contain)) return viewport;
  const rect = container.getBoundingClientRect();
  return {
    left: Math.max(viewport.left, rect.left),
    top: Math.max(viewport.top, rect.top),
    right: Math.min(viewport.right, rect.right),
    bottom: Math.min(viewport.bottom, rect.bottom),
  };
}
