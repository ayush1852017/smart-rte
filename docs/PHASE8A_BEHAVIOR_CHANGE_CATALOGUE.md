# Phase 8a clipboard behavior-change catalogue

Comparator equivalence is normalized canonical structure with IDs stripped. Clipboard operation streams are not compared. Logs contain fixture IDs, structural hashes, classification, and a text-conservation boolean; they contain no document text or HTML.

All eight captured fixtures differ structurally from the retained legacy engine and are approved as `expected-normalization`. No fixture loses canonical text according to the comparator's ≥90% distinct-word conservation check.

| Captured fixture | Intentional correction |
|---|---|
| Word macOS | Office metadata, conditional/VML fallbacks, and marker-only spans are removed; real `mso-list` paragraphs are grouped into canonical lists without retaining literal bullet glyphs. |
| Google Docs | The `docs-internal-guid` wrapper is removed; declared list levels become actual nested lists instead of unrelated sibling lists. |
| Google Sheets | The source wrapper is removed, unsafe stylesheet content is discarded, and the table is parsed and passed through canonical geometry repair. |
| Excel | Office metadata and stylesheet blocks are discarded; cell text and table geometry are retained. Formula and display-number semantics are intentionally not imported. |
| Markdown source | Structural Markdown is parsed as GFM instead of being treated as a preformatted browser HTML copy. |
| Native Smart RTE (current product) | The current product supplies only legacy HTML and still carries Office markers from earlier imports. Those wrappers are normalized. Future native MIME uses the separately property-tested lossless path. |
| Plain text | Legacy HTML-only paste produced no canonical content when `text/html` was absent. Canonical paste creates paragraphs and preserves tabs. |
| Generic web capture | The browser supplied only `text/plain`; canonical paste preserves it instead of producing an empty legacy HTML result. |

## Evidence limitation

Word on Windows has not been captured. The replacement macOS capture now exercises `mso-list:l0 level1 lfo1`, conditional Office comments, `<o:p>`, and VML fallbacks, but it cannot establish that Windows emits the same variants. The supplied Windows file is a Mammoth-converted DOCX reference, not a clipboard capture. Windows Word remains a Phase 8a gate failure until native clipboard payload is added or the owner explicitly accepts that source as residual risk.
