export type FidelityFormat = "html" | "markdown" | "docx" | "pdf";
export type FidelityLevel = "full" | "semantic" | "lossy" | "unsupported";

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

/** Public, test-enforced compatibility contract for built-in document formats. */
export const builtInFormatFidelity: readonly FeatureFidelityContract[] = [
  {
    feature: "inline-marks",
    formats: {
      html: capability("full", "Canonical marks round-trip."),
      markdown: capability("semantic", "Bold, italic, strike, code, and links round-trip; underline is lossy."),
      docx: capability("semantic", "Supported Word run properties round-trip through the canonical importer."),
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
      docx: capability("semantic", "Heading styles, alignment, and indentation are emitted."),
      pdf: capability("lossy", "Levels and alignment are inferred geometrically."),
    },
  },
  {
    feature: "blockquote-code",
    formats: {
      html: capability("full", "Canonical block structure round-trips."),
      markdown: capability("semantic", "Portable blockquote and code syntax round-trip."),
      docx: capability("lossy", "Structure is represented with paragraph styling."),
      pdf: capability("lossy", "Export is visual and import reconstruction is heuristic."),
    },
  },
  {
    feature: "lists",
    formats: {
      html: capability("full", "Nested list structure and styles round-trip."),
      markdown: capability("semantic", "Nested ordered and unordered structure round-trips; custom markers are lossy."),
      docx: capability("semantic", "Nested lists export with native Word numbering definitions and level metadata."),
      pdf: capability("lossy", "List structure is inferred from extracted markers."),
    },
  },
  {
    feature: "checklists",
    formats: {
      html: capability("full", "Checked state uses canonical data attributes."),
      markdown: capability("semantic", "GFM task-list state round-trips."),
      docx: capability("lossy", "Checklist semantics currently degrade to visible list content."),
      pdf: capability("lossy", "Checklist semantics are visual only."),
    },
  },
  {
    feature: "tables",
    formats: {
      html: capability("full", "Spans, headers, colors, borders, and dimensions round-trip."),
      markdown: capability("lossy", "GFM tables preserve text but not spans, dimensions, colors, or borders."),
      docx: capability("semantic", "Table structure and column spans export; advanced layout remains partial."),
      pdf: capability("lossy", "Export is visual and import uses column-position heuristics."),
    },
  },
  {
    feature: "links",
    formats: {
      html: capability("full", "Safe href and target semantics round-trip."),
      markdown: capability("semantic", "Href and label round-trip; target metadata is lossy."),
      docx: capability("semantic", "Links export as native external Word hyperlink relationships; target behavior is advisory."),
      pdf: capability("lossy", "Links are visual text in the current print/export path."),
    },
  },
  {
    feature: "images-media",
    formats: {
      html: capability("semantic", "Images, audio, and video round-trip; host-only metadata may be lossy."),
      markdown: capability("lossy", "Inline images round-trip; audio and video are unsupported."),
      docx: capability("semantic", "Data-URL PNG, JPEG, and GIF images embed natively; remote and unsupported sources retain portable markers."),
      pdf: capability("lossy", "Export is visual; semantic media import is unsupported."),
    },
  },
  {
    feature: "formulas",
    formats: {
      html: capability("full", "Formula source is stored canonically."),
      markdown: capability("semantic", "Dollar-delimited formula source round-trips."),
      docx: capability("semantic", "Formulas emit native OMML linear math and retain a hidden portable source marker for canonical round-trip."),
      pdf: capability("lossy", "Rendered output is visual; source cannot be reconstructed reliably."),
    },
  },
  {
    feature: "special-characters",
    formats: {
      html: capability("full", "Unicode text round-trips."),
      markdown: capability("full", "Unicode text round-trips."),
      docx: capability("full", "Unicode text is emitted as Word text."),
      pdf: capability("semantic", "Depends on font embedding and extractor Unicode maps."),
    },
  },
] as const;

export const getFormatFidelity = (
  feature: FidelityFeature,
  format: FidelityFormat,
): FormatFidelityCapability =>
  builtInFormatFidelity.find((entry) => entry.feature === feature)!.formats[format];
