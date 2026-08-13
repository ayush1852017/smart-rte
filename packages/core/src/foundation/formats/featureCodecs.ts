import { atomFromHtmlElement, atomToDocx, atomToHtml, atomToMarkdown, atomToPdf } from "../atom/formats.js";
import type { SmartElementNode } from "../types.js";
import type { FeatureFormatCodec } from "./codec.js";
import { builtInFormatFidelity, type FidelityFeature } from "./fidelity.js";

const asAtom = (node: unknown) => node as SmartElementNode;

/**
 * The 44 (feature x format) FeatureFormatCodec declarations Phase 9 SS3
 * gate 3 requires. feature/format/fidelity/note are mechanically derived
 * from builtInFormatFidelity (fidelity.ts) - that table is the single
 * source of truth for fidelity claims; this file must never restate a
 * level or note independently of it.
 *
 * parse/serialize are only attached where a genuine single-node function
 * already exists: atom/formats.ts's atomTo{Html,Markdown,Docx,Pdf} and
 * atomFromHtmlElement operate on one SmartElementNode at a time, so
 * images-media and formulas (8 of the 44 cells) get real wiring here.
 *
 * The other 36 cells' actual implementations - docx/export.ts, pdf/format.ts,
 * list/formats.ts's HTML/Markdown serializers, and the marks/table/block
 * canonical*To{Docx,Pdf} functions - are whole-document walkers that resolve
 * every feature together in one pass (see codec.ts's own doc comment). None
 * of them decompose into a single-node function matching this interface
 * without a real refactor of that production code, which is out of scope
 * here; those 36 entries carry fidelity metadata only (parse/serialize left
 * undefined) rather than a fabricated per-node wrapper around whole-document
 * logic. Closing that gap for real is tracked in
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
    if (contract.feature !== "images-media" && contract.feature !== "formulas") return base;
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
  }));
