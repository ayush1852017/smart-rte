import type { FoundationEditor } from "../editor.js";
import type { ModelDomMapping, SmartDocument, SmartSelection } from "../types.js";

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
  destroy(): void;
}

export interface CanonicalInputPipelineOptions {
  onFiles?: (files: readonly File[], position: SmartSelection) => void;
}
