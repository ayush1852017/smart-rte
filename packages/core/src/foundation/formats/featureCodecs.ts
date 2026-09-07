import { atomFromHtmlElement, atomToDocx, atomToHtml, atomToMarkdown, atomToPdf } from "../atom/formats.js";
import { markRunDocxProperties } from "../marks/formats.js";
import { blockToDocxEntry } from "../block/formats.js";
import type { SmartElementNode } from "../types.js";
import type { FeatureFormatCodec } from "./codec.js";
import { builtInFormatFidelity, type FidelityFeature } from "./fidelity.js";

const asAtom = (node: unknown) => node as SmartElementNode;

/**
 * The (feature x format) FeatureFormatCodec declarations Phase 9 SS3 gate 3
 * requires (44 at that gate's close; "page-break" added later brings the
 * total to 48). feature/format/fidelity/note are mechanically derived from
 * builtInFormatFidelity (fidelity.ts) - that table is the single source of
 * truth for fidelity claims; this file must never restate a level or note
 * independently of it.
 *
 * parse/serialize are only attached where a genuine single-node function
 * already exists, never a fabricated per-node wrapper around whole-document
 * logic:
 * - atom/formats.ts's atomTo{Html,Markdown,Docx,Pdf} and atomFromHtmlElement
 *   operate on one SmartElementNode at a time, so images-media, formulas,
 *   and page-break get real wiring for all four formats.
 * - marks/formats.ts's docxProperties and block/formats.ts's blockToDocxEntry
 *   (Phase 11 Tier 2, per docs/PHASE_9_CODEC_REFACTOR_SCOPE.md's recommended
 *   marks-then-blocks order) were already genuinely single-node - or, for
 *   blocks, extracted from canonicalBlocksToDocx's per-node visit() body
 *   with canonicalBlocksToDocx refactored to call the extracted function
 *   rather than duplicate it - so inline-marks/colors-fonts-sizes (marks)
 *   and headings-alignment/blockquote-code (block) get real DOCX wiring
 *   here. No parse direction exists for either (no reverse
 *   properties-to-marks/DocxBlock-to-node mapping was ever built), so only
 *   `serialize` is attached, matching the general "wire what already exists"
 *   rule.
 *
 * HTML/Markdown/PDF for marks and blocks, and every format for lists/tables,
 * remain whole-document walkers (docx/export.ts, pdf/format.ts,
 * list/formats.ts's HTML/Markdown serializers, table's own
 * canonical*To{Docx,Pdf} functions) that resolve every feature together in
 * one pass (see codec.ts's own doc comment) - per the scope doc, HTML/
 * Markdown is deliberately not scheduled ("if at all"), so those cells still
 * carry fidelity metadata only. Closing the rest is tracked in
 * docs/PHASE_9_EXIT_GATES.md's gate 3 entry.
 */
export const builtInFeatureFormatCodecs: readonly FeatureFormatCodec<FidelityFeature>[] =
  builtInFormatFidelity.flatMap((contract) => (["html", "markdown", "docx", "pdf"] as const).map((format) => {
    const capability = contract.formats[format];
    const base: FeatureFormatCodec<FidelityFeature> = {
      feature: contract.feature,
      format,
      fidelity: capability.level,
      note: capability.note,
    };
    if (contract.feature === "images-media" || contract.feature === "formulas" || contract.feature === "page-break") {
      if (format === "html") {
        return {
          ...base,
          serialize: (node) => atomToHtml(asAtom(node)),
          parse: (input) => atomFromHtmlElement(input as Element),
        };
      }
      if (format === "markdown") return { ...base, serialize: (node) => atomToMarkdown(asAtom(node)) };
      if (format === "docx") return { ...base, serialize: (node) => atomToDocx(asAtom(node)) };
      return { ...base, serialize: (node) => atomToPdf(asAtom(node)) };
    }
    if (format === "docx" && (contract.feature === "inline-marks" || contract.feature === "colors-fonts-sizes")) {
      return { ...base, serialize: (node) => markRunDocxProperties(node) };
    }
    if (format === "docx" && (contract.feature === "headings-alignment" || contract.feature === "blockquote-code")) {
      return { ...base, serialize: (node) => blockToDocxEntry(asAtom(node)) };
    }
    return base;
  }));
