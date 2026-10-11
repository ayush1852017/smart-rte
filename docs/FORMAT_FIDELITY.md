# Built-in format fidelity

Smart RTE treats HTML as its canonical interchange format. Markdown and DOCX
preserve portable semantics where their standards permit it. PDF is a
layout-oriented print/import boundary and is not presented as a semantic
round-trip format.

The executable contract lives in
`packages/react/src/formatFidelity.ts`. Each feature/format pair is classified:

- `full`: canonical structure and supported attributes round-trip.
- `semantic`: meaning round-trips, but representation or host metadata changes.
- `lossy`: useful import/export exists with documented information loss.
- `unsupported`: the adapter intentionally has no representation yet.

Changes to an adapter must update the executable matrix and its round-trip
fixtures together. A feature must not be advertised as `full` without a
canonical model round-trip test.

Current priorities:

1. Keep HTML at full fidelity for every canonical node and mark.
2. Preserve portable Markdown semantics, including GFM tables and task lists.
3. Preserve native DOCX numbering, hyperlinks, embeddable images, and OMML
   formula objects; expand image-source support and improve formula typography
   without sacrificing canonical source round-trips.
4. Keep PDF behavior explicitly heuristic and layout-oriented.

## Image captions and host image metadata (1.2.0)

Executable rows: `image-captions` and the HTML note on `images-media` in
`packages/core/src/foundation/formats/fidelity.ts`.

| Format | Captions | Host metadata (`imageMetadataAttributes`) |
|---|---|---|
| HTML | `full` - exported as `<figure data-smart-figure="true">(<a>)<img …><figcaption>…</figcaption></figure>`; any figure with one image and one figcaption imports as a captioned image. Legacy flattened `<img>` + sibling `<figcaption>` is repaired on import. Marks/links inside an imported figcaption are flattened to plain text. | Exported as plain escaped `data-*` attributes on the `<img>`; imported only for allowlisted names (none by default). |
| Markdown | `lossy` - an italic line under the image; not parsed back into a caption. | Dropped (no attribute syntax). |
| DOCX | `lossy` - a paragraph in Word's Caption style (plus direct italic 9pt formatting) after the image; import returns it as an ordinary paragraph. | Dropped. |
| PDF | `full` - prints the HTML export's `<figcaption>`. | Not visible (attributes only). |
| Plain-text clipboard | `alt - caption` (or just the caption for a decorative image). | Dropped. |

Documents without captions or metadata export byte-identically to 1.1.x in
every format above; `packages/core/src/foundation/atom/imageCaptions.test.ts`
checks this against golden output generated from the 1.1.x source.
