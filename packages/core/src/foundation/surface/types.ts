import type { FoundationEditor } from "../editor.js";
import type { ModelDomMapping, SmartDocument, SmartSelection } from "../types.js";
import type { ClipboardDiagnosticReport } from "../clipboard/diagnostics.js";

export interface CanonicalSubtreeRenderer {
  readonly mapping: ModelDomMapping;
  readonly composingNodeId: string | null;
  readonly domWriteCount: number;
  readonly composingDomWriteCount: number;
  render(document: SmartDocument, selection: SmartSelection): void;
  beginComposition(nodeId: string): void;
  endComposition(): void;
  resetWriteCounters(): void;
  destroy(): void;
}

export interface CanonicalInputPipeline {
  readonly editor: FoundationEditor;
  readonly renderer: CanonicalSubtreeRenderer;
  readonly unhandledInputTypes: readonly string[];
  handleBeforeInput(event: InputEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
  handleCompositionStart(event: CompositionEvent): void;
  handleCompositionUpdate(event: CompositionEvent): void;
  handleCompositionEnd(event: CompositionEvent): void;
  handlePaste(event: ClipboardEvent): void;
  handleCopy(event: ClipboardEvent): void;
  handleCut(event: ClipboardEvent): void;
  handleDrop(event: DragEvent): void;
  syncSelectionFromDom(): void;
  /**
   * Phase 12a §2.3 ambient track-changes mode: when enabled, ordinary
   * typing and same-owner Backspace/Delete become live "suggestion" marks
   * (see suggestions/inline.ts) instead of directly editing the document -
   * exactly what most people mean by "track changes"/"suggesting mode" in
   * Word/Google Docs, as opposed to the explicit per-action Suggest
   * deletion/Suggest insertion toolbar commands, which remain available
   * regardless of this mode. Scoped to insertion and same-owner deletion
   * only - cross-paragraph deletion and the cross-block Backspace/Delete
   * merge (deleteAcrossBlock) still edit directly even when enabled; see
   * docs/PHASE_ROADMAP_8B_12B.md's Phase 12a status note for why.
   */
  setTrackChanges(enabled: boolean, authorId?: string): void;
  destroy(): void;
}

export interface CanonicalInputPipelineOptions {
  onFiles?: (files: readonly File[], position: SmartSelection) => void;
  /** Privacy-safe clipboard telemetry; reports hashes and structure, never text. */
  onClipboardDiagnostic?: (report: ClipboardDiagnosticReport) => void;
}
