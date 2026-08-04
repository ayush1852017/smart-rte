# Phase 8a clipboard fixture capture

The Phase 8a P0 corpus must contain clipboard payloads captured from real applications. Synthesized “Word-like” HTML does not qualify.

## Capture procedure

1. Start the playground:

   ```sh
   pnpm --dir packages/react/playground dev
   ```

2. Open `http://localhost:5173/?clipboardCapture=1`.
3. In the source application, select the requested content and copy it.
4. On the capture page, select the source, record its platform/version and give the sample a short content description.
5. Focus the dashed capture target and paste.
6. Download the JSON payload. The page prevents the normal paste and records every string MIME representation without transforming it.
7. Put the file under `packages/core/src/foundation/clipboard/fixtures/captured/p0/`.

## Import options

The capture page can import an existing `.clipboard.json` produced on another
computer. This is the correct way to bring a genuine Windows or macOS clipboard
payload into this workspace.

It can also import a `.docx` file as a **reference fixture**. That path converts
the document through Mammoth and stamps the result with
`provenance.kind: "docx-reference"`. A DOCX package does not contain Word's
clipboard HTML, so these reference fixtures must not be placed in the captured
P0 corpus and cannot clear the Word Windows/macOS clipboard gate.

Do not capture client, company, or otherwise confidential content. Build disposable test documents.

## Blocking P0 matrix

- Native Smart RTE: representative content covering lists, marks, blocks, tables, and atoms.
- Word on Windows: headings, bold/italic, nested bullets, nested numbering, merged-cell table, image, and hyperlink.
- Word on macOS: the same cases; these must be separately captured.
- Google Docs: the same cases.
- Plain text: multiple paragraphs and tabs.

Separate files per case are preferred. In particular, keep nested bullets and nested numbering separate so failures can be localized.

The fixture JSON preserves `text/html`, `text/plain`, custom native MIME data, the declared MIME-type order, user agent, and file metadata. Clipboard files themselves are not embedded; record image/file cases separately if their binary payload is later needed.

## Honesty rule

Every committed fixture must declare its provenance in the Phase 8a report. Security fixtures and generated stress fixtures may be synthesized, but they cannot be used to claim real Word, Google Docs, or spreadsheet compatibility.
