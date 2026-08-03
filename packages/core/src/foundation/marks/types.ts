import type { ResolvedScope } from "../scope/types.js";
import type { Attrs, SmartDocument, SmartOperation, SmartSchema } from "../types.js";
import type { PositionLookup } from "../scope/types.js";

export interface MarkCommandContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export type MarkCommand<P> = (
  document: SmartDocument,
  scope: ResolvedScope,
  params: P,
  ctx: MarkCommandContext,
) => SmartOperation[];

export interface MarkApplyParams { readonly markType: string; readonly attrs?: Attrs }
export interface MarkRemoveParams { readonly markType: string }
export interface MarkToggleParams extends MarkApplyParams {
  /** Supplied from Phase 2 describe(); commands do not recompute coverage. */
  readonly coverage: "all" | "partial" | "none";
}
export interface MarkSetAttrsParams extends MarkApplyParams {}
export interface MarkClearAllParams {}
export interface LinkEditParams { readonly href: string; readonly target?: string }

export interface InlineToolDeclaration {
  readonly id: string;
  readonly markType: string;
  readonly inclusive: boolean;
  readonly excludes?: readonly string[];
  readonly validate?: (attrs: Attrs | undefined) => boolean;
}

export interface MarkApplicationReport {
  readonly ownerCount: number;
  readonly ownerIdsSkipped: readonly string[];
  readonly atomOwnersSkipped: readonly string[];
  readonly partial: boolean;
}
