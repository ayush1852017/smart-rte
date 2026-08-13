import type { SmartDocument, SmartNode } from "../types.js";

export type FormatId = "html" | "markdown" | "docx" | "pdf";
export type FormatFidelityLevel = "full" | "semantic" | "lossy" | "unsupported";

export interface ParseContext {
  readonly format: FormatId;
}
export interface SerializeContext {
  readonly format: FormatId;
}

/**
 * The per-feature, per-format contract Phase 9 SS2.2 formalizes. Each of the
 * five foundation features (list, marks, block, table, atom) declares one of
 * these per format it participates in, rather than a single serializer
 * containing scattered per-feature type checks.
 *
 * `parse`/`serialize` operate on a single feature's node(s) - they are the
 * semantic mapping rule for "what does this feature mean in this format",
 * not a whole-document driver. Whole-document assembly (correct ordering
 * and nesting across all five features together) is a separate concern,
 * owned by the format's top-level codec (see packages/core/src/foundation/
 * formats/docx/export.ts, pdf/format.ts, and list/formats.ts's
 * serializeCanonicalListHtml/serializeCanonicalListMarkdown for HTML/MD).
 * This mirrors an existing split already present before this contract was
 * formalized: packages/core/src/foundation/{list,marks,block,table,atom}/
 * formats.ts already contain canonical*To{Docx,Pdf}* functions with exactly
 * this per-feature, single-node shape, originally written for fixture-based
 * fidelity verification (see SS2.3) rather than production document assembly.
 */
export interface FeatureFormatCodec<TFeature extends string = string> {
  readonly feature: TFeature;
  readonly format: FormatId;
  readonly fidelity: FormatFidelityLevel;
  /** Human-readable justification for the fidelity level - required, not decorative (see fidelity.ts's test enforcement). */
  readonly note: string;
  parse?: (input: unknown, ctx: ParseContext) => SmartNode | SmartNode[] | null;
  serialize?: (node: SmartNode, ctx: SerializeContext) => unknown;
  /** Applied when this feature's fidelity for this format is `lossy` or `unsupported` and no better representation exists. */
  fallback?: (node: SmartNode) => SmartNode | null;
}

/** Whole-document entry points a format must provide, independent of any single feature. */
export interface DocumentFormatCodec {
  readonly format: FormatId;
  parseDocument?: (input: unknown, ctx: ParseContext) => SmartDocument;
  serializeDocument?: (document: SmartDocument, ctx: SerializeContext) => unknown;
}
