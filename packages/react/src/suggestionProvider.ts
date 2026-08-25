import type { StructuralSuggestion } from "smartrte-core/foundation";

/**
 * Host-owned persistence boundary for *structural* suggestions only,
 * mirroring CommentProvider's shape. Inline suggestions (Phase 12a §2.3's
 * mark-based half - see suggestions/inline.ts) need no equivalent provider:
 * they are real marks on real document text, so they already ride along in
 * whatever the host persists for the document itself (PersistedEditorDocument)
 * - a separate side-channel for them would just be a second, redundant
 * source of truth. Structural suggestions (a proposed whole-node removal)
 * are NOT part of the document the way a comment thread isn't, so they need
 * their own out-of-band store, exactly like comments.
 */
export interface SuggestionProvider {
  list(): Promise<readonly StructuralSuggestion[]>;
  save(suggestion: StructuralSuggestion): Promise<void>;
  remove(suggestionId: string): Promise<void>;
}
