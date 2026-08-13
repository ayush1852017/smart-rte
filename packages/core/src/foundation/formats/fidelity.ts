import type { FormatFidelityLevel, FormatId } from "./codec.js";

export type FidelityFormat = FormatId;
export type FidelityLevel = FormatFidelityLevel;

export type FidelityFeature =
  | "inline-marks"
  | "colors-fonts-sizes"
  | "headings-alignment"
  | "blockquote-code"
  | "lists"
  | "checklists"
  | "tables"
  | "links"
  | "images-media"
  | "formulas"
  | "special-characters";

export interface FormatFidelityCapability {
  level: FidelityLevel;
  note: string;
}

export interface FeatureFidelityContract {
  feature: FidelityFeature;
  formats: Record<FidelityFormat, FormatFidelityCapability>;
}

const capability = (level: FidelityLevel, note: string): FormatFidelityCapability => ({
  level,
  note,
});

/**
 * Public, test-enforced compatibility contract for built-in document
 * formats (Phase 9 SS2.2's fidelity table deliverable).
 *
 * Verification status as of Phase 9 SS2.2 (2026-08-13): cells touching DOCX
 * export/import were re-checked directly against
 * packages/core/src/foundation/formats/docx/format.test.ts (the codec built
 * in SS2.1). Every other cell is carried forward from before this phase and
 * has NOT yet been independently re-verified against a round-trip fixture -
 * that enforcement is SS2.3's explicit job ("every fidelity claim requires a
 * round-trip fixture... has never been fully enforced"). Do not treat an
 * un-flagged cell here as fixture-verified until SS2.3 lands.
 */
export const builtInFormatFidelity: readonly FeatureFidelityContract[] = [
  {
    feature: "inline-marks",
    formats: {
      html: capability("full", "Canonical marks round-trip."),
      markdown: capability("semantic", "Bold, italic, strike, code, and links round-trip; underline is lossy."),
      docx: capability("semantic", "All twelve marks are written as Word run properties on export. On import, mammoth's default HTML conversion recognizes and round-trips bold/italic/code/strike/superscript/subscript/link; underline/textColor/backgroundColor/fontSize/fontFamily are not mapped back without an explicit mammoth style map - text content survives, that specific formatting does not (SS2.1: verified per-mark via a dedicated round-trip fixture, not inferred)."),
      pdf: capability("lossy", "Visual emphasis is inferred from extracted font metadata."),
    },
  },
  {
    feature: "colors-fonts-sizes",
    formats: {
      html: capability("full", "Inline style marks round-trip."),
      markdown: capability("unsupported", "Portable Markdown has no standard representation."),
      docx: capability("semantic", "Colors and sizes are supported; font-family fidelity depends on importer styles."),
      pdf: capability("lossy", "Font size/style are inferred; colors are extraction-dependent."),
    },
  },
  {
    feature: "headings-alignment",
    formats: {
      html: capability("full", "Levels, alignment, and indentation round-trip."),
      markdown: capability("lossy", "Heading levels round-trip; alignment and indentation do not."),
      docx: capability("semantic", "Heading styles (w:pStyle), alignment (w:jc), and indentation (w:ind) are emitted (SS2.1, re-verified)."),
      pdf: capability("lossy", "Levels and alignment are inferred geometrically."),
    },
  },
  {
    feature: "blockquote-code",
    formats: {
      html: capability("full", "Canonical block structure round-trips."),
      markdown: capability("semantic", "Portable blockquote and code syntax round-trip."),
      docx: capability("lossy", "Blockquote is represented as indentation (w:ind), not a native Word quote style; code uses a character-level code mark, not a code paragraph style."),
      pdf: capability("lossy", "Export is visual and import reconstruction is heuristic."),
    },
  },
  {
    feature: "lists",
    formats: {
      html: capability("full", "Nested list structure and styles round-trip."),
      markdown: capability("semantic", "Nested ordered and unordered structure round-trips; custom markers are lossy."),
      docx: capability("semantic", "Nested lists export with native Word numbering definitions (w:numId/w:ilvl) and level metadata; verified for decimal/lower-alpha/disc through 9 levels (SS2.1, re-verified)."),
      pdf: capability("lossy", "List structure is inferred from extracted markers."),
    },
  },
  {
    feature: "checklists",
    formats: {
      html: capability("full", "Checked state uses canonical data attributes."),
      markdown: capability("semantic", "GFM task-list state round-trips."),
      docx: capability("lossy", "Checklist semantics degrade to plain bulleted/numbered list content - checked state is not emitted (SS2.1, re-verified: docx/export.ts's list branch does not read list.attrs.checkable or list_item.attrs.checked)."),
      pdf: capability("lossy", "Checklist semantics are visual only."),
    },
  },
  {
    feature: "tables",
    formats: {
      html: capability("full", "Spans, headers, colors, borders, and dimensions round-trip."),
      markdown: capability("lossy", "GFM tables preserve text but not spans, dimensions, colors, or borders."),
      docx: capability("semantic", "Column spans (gridSpan), row spans (vMerge), header rows, cell background, and borders export via occupancyGridFor (SS2.1, re-verified); per-cell vertical alignment is not yet emitted."),
      pdf: capability("lossy", "Export is visual and import uses column-position heuristics."),
    },
  },
  {
    feature: "links",
    formats: {
      html: capability("full", "Safe href and target semantics round-trip."),
      markdown: capability("semantic", "Href and label round-trip; target metadata is lossy."),
      docx: capability("semantic", "Links export as native external Word hyperlink relationships (w:hyperlink); target=_blank is preserved as w:history (SS2.1, re-verified)."),
      pdf: capability("lossy", "Links are visual text in the current print/export path."),
    },
  },
  {
    feature: "images-media",
    formats: {
      html: capability("semantic", "Images, audio, and video round-trip; host-only metadata may be lossy."),
      markdown: capability("lossy", "Inline and block images round-trip as ![alt](src) (SS2.3: fixed a real silent-data-loss bug - markdownInlineText/markdownBlock's fallback for any atom node was an empty string, deleting images with no trace; images are now routed through atomToMarkdown/parsed back via a real image AST case). Audio and video degrade to a readable [video: url](url) link on export - the link and URL survive, but re-import produces a generic link, not a video/audio atom."),
      docx: capability("semantic", "Data-URL PNG/JPEG/GIF images embed as native Word media relationships; remote or unsupported sources fall back to a portable text marker recovered on import (SS2.1, re-verified). No canonical DOCX projection exists yet for video/audio (block_image only)."),
      pdf: capability("lossy", "Export is visual; semantic media import is unsupported."),
    },
  },
  {
    feature: "formulas",
    formats: {
      html: capability("full", "Formula source is stored canonically (data-smart-formula); displayText is presentation-only and is not preserved by canonical's own HTML round-trip, in any format."),
      markdown: capability("semantic", "Dollar-delimited formula source round-trips: $source$ for inline, $$\\nsource\\n$$ for block (SS2.3: fixed the same silent-data-loss bug as images-media/markdown - formulas were being deleted with no trace on export, and remark's core parser has no math extension so $...$ survived as inert literal text on import even after the export side was fixed; both are now handled via a dedicated post-parse regex split, not a library dependency)."),
      docx: capability("lossy", "Formula source is written inside an <m:oMath> zone as literal LaTeX text, not translated to real OMML (no partial-OMML build, an explicit standing scope decision) - Word will show the raw LaTeX string, not typeset math. A hidden portable-marker text run carries the source for lossless round-trip back through Smart RTE specifically, independent of whether Word renders it usefully (SS2.1: this replaces a stale note that described a since-retired export path, which no longer applies)."),
      pdf: capability("lossy", "Rendered output is visual; source cannot be reconstructed reliably."),
    },
  },
  {
    feature: "special-characters",
    formats: {
      html: capability("full", "Unicode text round-trips."),
      markdown: capability("full", "Unicode text round-trips."),
      docx: capability("full", "Unicode text is emitted as Word text (SS2.1, re-verified)."),
      pdf: capability("semantic", "Depends on font embedding and extractor Unicode maps."),
    },
  },
] as const;

export const getFormatFidelity = (
  feature: FidelityFeature,
  format: FidelityFormat,
): FormatFidelityCapability =>
  builtInFormatFidelity.find((entry) => entry.feature === feature)!.formats[format];
