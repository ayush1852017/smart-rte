import type { ResolvedScope } from "../scope/types.js";
import type { Attrs, SmartDocument, SmartOperation, SmartSchema } from "../types.js";
import type { PositionLookup } from "../scope/types.js";

export interface BlockCommandContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export type BlockCommand<P> = (
  document: SmartDocument,
  scope: ResolvedScope,
  params: P,
  ctx: BlockCommandContext,
) => SmartOperation[];

export interface SetBlockTypeParams { readonly type: "paragraph" | "heading" | "code_block"; readonly attrs?: Attrs }
export interface WrapBlocksParams { readonly type: "blockquote"; readonly attrs?: Attrs; readonly wrapperIds: readonly string[] }
export interface UnwrapBlocksParams { readonly type?: "blockquote" }
export interface SetBlockAttributesParams { readonly attrs: Attrs }
export interface MoveBlocksParams { readonly direction: "up" | "down" }
export interface IndentBlocksParams { readonly amount?: number }
export interface OutdentBlocksParams { readonly amount?: number }

export interface BlockToolDeclaration {
  readonly id: string;
  readonly kind: "setType" | "wrapToggle" | "setAttributes";
  readonly type?: "paragraph" | "heading" | "code_block" | "blockquote";
  readonly attrs?: Attrs;
  readonly nestable?: boolean;
  readonly validate?: (attrs: Attrs | undefined) => boolean;
}
