import type { Attrs, SmartMark, SmartNode } from "../types.js";

/**
 * A word-granularity diff segment within one inline-content owner's flattened
 * text. Word, not character: character-level diffing fragments on every
 * keystroke-sized edit and is visually noisy for review UI; word-level is
 * what every comparable tool (Word, Google Docs) renders track-changes at.
 * A run whose text matches on both sides but whose marks don't is reported
 * as `markChange`, not a delete+insert of identical text.
 */
export type TextDiffSegment =
  | { readonly op: "equal"; readonly text: string; readonly marks: readonly SmartMark[] }
  | { readonly op: "insert"; readonly text: string; readonly marks: readonly SmartMark[] }
  | { readonly op: "delete"; readonly text: string; readonly marks: readonly SmartMark[] }
  | { readonly op: "markChange"; readonly text: string; readonly before: readonly SmartMark[]; readonly after: readonly SmartMark[] };

/** A node id present in `after` but not `before`. Only topmost added roots are reported - a node whose parent id is itself newly-added is part of that parent's own subtree, not a separate entry. */
export interface AddedNodeChange {
  readonly kind: "added";
  readonly nodeId: string;
  readonly node: SmartNode;
  readonly parentId: string | null;
  readonly path: number[];
}

/** A node id present in `before` but not `after`. Only topmost removed roots are reported, mirroring `AddedNodeChange`. */
export interface RemovedNodeChange {
  readonly kind: "removed";
  readonly nodeId: string;
  readonly node: SmartNode;
  readonly parentId: string | null;
  readonly path: number[];
}

/**
 * A node id present in both trees with at least one difference. Carries
 * whichever of `move`/`typeChange`/`attrsChange`/`contentChange` actually
 * differ on one entry per id, rather than separate flat entries per change
 * kind - a renderer needs one lookup per node id, not a correlation step.
 */
export interface ChangedNodeChange {
  readonly kind: "changed";
  readonly nodeId: string;
  readonly move?: {
    readonly fromParentId: string | null;
    readonly toParentId: string | null;
    readonly fromPath: number[];
    readonly toPath: number[];
  };
  readonly typeChange?: { readonly before: string; readonly after: string };
  readonly attrsChange?: { readonly before: Attrs; readonly after: Attrs; readonly changedKeys: readonly string[] };
  readonly contentChange?: readonly TextDiffSegment[];
}

export interface DocumentDiff {
  readonly added: readonly AddedNodeChange[];
  readonly removed: readonly RemovedNodeChange[];
  readonly changed: readonly ChangedNodeChange[];
}
