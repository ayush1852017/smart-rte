import type { PersistedEditorDocument } from "../types.js";

/**
 * A named, saved snapshot of the document a user can return to or compare
 * against - distinct from the undo/redo history stack (`history.ts`), which
 * is moment-to-moment edit state, not something a user browses or restores
 * from days later. Reuses the existing `PersistedEditorDocument` envelope
 * verbatim as its payload rather than a new document shape - a version
 * *is* a full document snapshot with a revision, which is exactly what
 * that envelope already represents.
 */
export interface DocumentVersion {
  readonly id: string;
  readonly label?: string;
  readonly createdAt: number;
  readonly authorId?: string;
  readonly envelope: PersistedEditorDocument;
}
