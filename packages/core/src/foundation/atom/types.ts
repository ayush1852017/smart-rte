import type { Attrs, SmartDocument, SmartOperation, SmartSchema } from "../types.js";
import type { PositionLookup, ResolvedScope } from "../scope/types.js";

export type AtomKind = "image" | "formula" | "video" | "audio";
export type AtomStatus = "pending" | "ready" | "error";

export interface AtomDeclaration {
  readonly type: string;
  readonly kind: AtomKind;
  readonly group: "inline" | "block";
  readonly validate: (attrs: Attrs) => boolean;
}

export interface AtomCommandContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export type AtomCommand<P> = (
  document: SmartDocument,
  scope: ResolvedScope,
  params: P,
  ctx: AtomCommandContext,
) => SmartOperation[];

export interface InsertAtomParams {
  readonly declaration: AtomDeclaration;
  readonly nodeId: string;
  readonly attrs: Attrs;
  /** Required for inline atoms. */
  readonly ownerId?: string;
  readonly offset?: number;
  /** Required for block atoms. */
  readonly parentId?: string;
  readonly index?: number;
}

export interface UpdateAtomParams { readonly attrs: Attrs }
export interface ResizeAtomParams { readonly width: number; readonly height: number; readonly minWidth?: number; readonly minHeight?: number; readonly preserveAspectRatio?: boolean }

export interface CompositionAtomToken {
  readonly kind: "atom";
  readonly nodeId: string;
  readonly atomType: string;
}

export interface CompositionTextToken {
  readonly kind: "text";
  readonly text: string;
  readonly marks: readonly import("../types.js").SmartMark[];
}

export type CompositionToken = CompositionAtomToken | CompositionTextToken;

