/**
 * A CSS `transform`, `perspective`, `filter`, `backdrop-filter`, or a
 * `will-change` naming one of those, on an ancestor makes that ancestor the
 * containing block for `position: fixed` descendants instead of the
 * viewport (CSS Transforms spec's rendering model) - most commonly a
 * Radix/shadcn `Dialog`'s centering transform (`translate-x-[-50%]
 * translate-y-[-50%]`), which any host may legitimately wrap this editor
 * in. When that happens, `left`/`top` set on a fixed-positioned menu/popover
 * are resolved against that ancestor's border box (as rendered,
 * post-transform) instead of the viewport, silently producing coordinates
 * that are internally consistent but land far from the trigger with no
 * error - confirmed live via a Sootr host rendering the editor inside such
 * a dialog.
 *
 * `getBoundingClientRect()` always returns viewport-relative coordinates
 * regardless of transforms, so every placement calculation in this codebase
 * computes coordinates in viewport space first, then subtracts this
 * origin - the real containing block's own viewport-relative top-left - so
 * the applied `left`/`top` land correctly under either containing block.
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
      (style.willChange && /transform|perspective|filter/.test(style.willChange))
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
