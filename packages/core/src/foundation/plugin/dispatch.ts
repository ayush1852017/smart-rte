import type { SmartOperation } from "../types.js";
import type { KeyboardShortcutContribution } from "./types.js";

export interface KeyLike {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

const matchesEvent = (event: KeyLike, shortcut: KeyboardShortcutContribution): boolean =>
  event.key.toLowerCase() === shortcut.key.toLowerCase() &&
  (shortcut.primary ? Boolean(event.metaKey || event.ctrlKey) : !event.metaKey && !event.ctrlKey) &&
  Boolean(event.altKey) === Boolean(shortcut.alt) &&
  Boolean(event.shiftKey) === Boolean(shortcut.shift);

/**
 * Tries every key-matching shortcut contribution in priority order (ties
 * broken by registration order, which is what PluginRegistry.keyboardShortcuts
 * already provides), invoking `tryShortcut` for each and returning the
 * first that actually produces operations.
 *
 * This is a fallback chain, not a static "one scope-kind owns this key"
 * lookup, because ScopeKind alone cannot distinguish every case a real
 * shortcut cares about (e.g. "inside a code block" and "inside a plain
 * paragraph" are both "block-range" - see scope/resolveScope.ts). It
 * reproduces surface/input.ts's actual current Tab precedence (code-block
 * wins if applicable, then list unless inTable, then table/native
 * fallthrough if nothing applies) by asking each candidate, in order,
 * "does this genuinely apply here" via `tryShortcut` - which resolves the
 * scope the contribution declares and runs its command - rather than by
 * pre-filtering on a single precomputed scope-kind label. `scopeKinds` on
 * a contribution remains meaningful as declared metadata for callers
 * (which `resolveScope({want})` to attempt) and for doc generation, it's
 * just no longer what this function filters by directly.
 */
export const resolveShortcut = (
  shortcuts: readonly KeyboardShortcutContribution[],
  event: KeyLike,
  tryShortcut: (shortcut: KeyboardShortcutContribution) => readonly SmartOperation[] | null,
): { shortcut: KeyboardShortcutContribution; operations: readonly SmartOperation[] } | null => {
  for (const shortcut of shortcuts) {
    if (!matchesEvent(event, shortcut)) continue;
    const operations = tryShortcut(shortcut);
    if (operations?.length) return { shortcut, operations };
  }
  return null;
};
