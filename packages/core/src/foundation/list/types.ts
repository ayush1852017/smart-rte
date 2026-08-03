import type { PositionLookup, ResolvedScope } from "../scope/types.js";
import type { SmartDocument, SmartOperation, SmartSchema } from "../types.js";

export interface CommandContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export type ListCommand<P> = (
  document: SmartDocument,
  scope: ResolvedScope,
  params: P,
  ctx: CommandContext,
) => SmartOperation[];

export interface CreateListParams {
  readonly listIds: readonly string[];
  readonly itemIds: readonly string[];
  readonly preset?: string;
  readonly style?: string;
  readonly start?: number;
  readonly checkable?: boolean;
}

export interface UnwrapListParams {
  /** New ID used only when unwrapping a middle run splits one list in two. */
  readonly splitListIds?: readonly string[];
}

export interface IndentListParams {
  /** One deterministic ID per selected list that needs a new nested list. */
  readonly nestedListIds?: readonly string[];
}

export interface OutdentListParams extends UnwrapListParams {}
export interface SetListPresetParams { readonly preset?: string }
export interface SetListStyleParams {
  readonly style?: string;
  /** Optional list-level checklist mode used by the list toolbar adapter. */
  readonly checkable?: boolean;
}
export interface SetListCheckedParams { readonly checked: boolean }
export interface MoveListItemsParams { readonly direction: "up" | "down" }
export interface RestartListNumberingParams { readonly start: number }
export interface ContinueListNumberingParams {}

export interface InsertListFragmentParams {
  readonly fragment: SmartDocument;
  readonly position: "before" | "after" | "start" | "end";
  /** Deterministic IDs used when plain fragment blocks must become items. */
  readonly itemIds?: readonly string[];
}
