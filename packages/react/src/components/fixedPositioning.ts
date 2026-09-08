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
 * - `contain: paint | strict | content` (CSS Containment) - a common
 *   perf/isolation optimization on large scrollable containers, e.g. a
 *   second, different Sootr dialog reported still misplacing every toolbar
 *   dropdown ("More list tools", "More to insert", "Save a copy", "More
 *   text styles") despite already running the transform-only fix above.
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
      (style.contain && /\b(paint|strict|content)\b/.test(style.contain))
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
