import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { insertDefaultTable, openToolbarDropdown, toolbarMenuItem } from "./toolbarHelpers.js";

const selectFirstText = async (page: Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
  const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode() as Text;
  const range = document.createRange();
  range.selectNodeContents(text);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
});

const placeCaret = async (page: Page, selector: string, last = false) => {
  await expect(page.locator(selector).first()).toBeAttached();
  await page.evaluate(({ selector, last }) => {
    const matches = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const target = last ? matches.at(-1) : matches[0];
    if (!target) throw new Error(`Cannot place caret: no element matches ${selector}`);
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, { selector, last });
};

const selectCellRange = async (page: Page, start: Locator, end: Locator) => {
  const startBox = await start.boundingBox();
  const endBox = await end.boundingBox();
  if (!startBox || !endBox) throw new Error("Canonical table cells must be visible before selecting them.");
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 4 });
  await page.mouse.up();
};

// Phase 11.5 §2.1: image insertion now opens MediaManager ("Media library")
// by default instead of the simple DefaultMediaPicker ("Choose image");
// video/audio are unaffected.
const chooseMedia = async (page: Page, kind: "image" | "video" | "audio", name: string, mimeType: string) => {
  const picker = page.getByRole("dialog", { name: kind === "image" ? "Media library" : `Choose ${kind}` });
  await picker.locator('input[type="file"]').setInputFiles({
    name,
    mimeType,
    buffer: Buffer.from(`${kind}-fixture`),
  });
  await expect(picker).toHaveCount(0);
};

test.describe("canonical toolbar routing", () => {
  test("routes checklist state through the canonical renderer projection", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await selectFirstText(page);
    await page.getByRole("button", { name: "Bulleted list" }).click();
    await page.getByRole("button", { name: "Numbered list" }).click();
    await page.getByRole("button", { name: "Checklist" }).click();
    await expect(surface.locator('ul[data-smart-checkable="true"]')).toHaveCount(1);
    await openToolbarDropdown(page, "More list tools");
    await toolbarMenuItem(page, "Check selected items").click();
    await expect(surface.locator('[role="checkbox"]')).toHaveAttribute("aria-checked", "true");
  });

  test("routes lists, links, tables, atoms, resize, import, and export through retained state", async ({ page }) => {
    page.on("dialog", (dialog) => {
      const message = dialog.message();
      const answer = message.includes("Formula") ? "E=mc^2"
        : message.includes("Alt text") ? "Example image" : "";
      void dialog.accept(answer);
    });
    await page.goto("/?canonicalAuthority=1&blocks=2");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');

    // Phase 11.5: the Link toolbar button now opens LinkEditorPopover
    // (previously built, tested in isolation, never wired) instead of
    // window.prompt.
    await selectFirstText(page);
    await page.getByRole("button", { name: "Insert or edit link" }).click();
    await page.locator("[data-srte-link-href-input]").fill("https://example.test");
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(surface.locator("a")).toHaveAttribute("href", "https://example.test");
    await expect(surface.locator("a")).toHaveCSS("text-decoration-line", "underline");
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] a');
    await page.getByRole("button", { name: "Insert or edit link" }).click();
    await page.locator("[data-srte-link-href-input]").fill("https://updated.example.test");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(surface.locator("a")).toHaveAttribute("href", "https://updated.example.test");

    await page.getByRole("button", { name: "Bulleted list" }).click();
    await expect(surface.locator("ul > li")).toHaveCount(1);
    await page.getByRole("button", { name: "Numbered list" }).click();
    await expect(surface.locator("ol > li")).toHaveCount(1);
    await page.getByRole("button", { name: "Checklist" }).click();
    await expect(surface.locator('ul[data-smart-checkable="true"]')).toHaveCount(1);
    await openToolbarDropdown(page, "More list tools");
    await toolbarMenuItem(page, "Check selected items").click();
    await expect(surface.locator('[role="checkbox"]')).toHaveAttribute("aria-checked", "true");

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p', true);
    await insertDefaultTable(page);
    await expect(surface.locator("table tr")).toHaveCount(2);
    await openToolbarDropdown(page, "Table tools");
    await expect(toolbarMenuItem(page, "Add row")).toBeEnabled();
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Add row").click();
    await expect(surface.locator("table tr")).toHaveCount(3);

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p', true);
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Insert formula").click();
    // "Insert formula" now opens the formula library popover (a browsable
    // set of library entries) instead of prompting directly - pick any
    // entry, then the existing insert-then-auto-edit flow (editSelectedAtom)
    // opens the same "Formula source" window.prompt this test already
    // answers with "E=mc^2" above, overwriting the library entry's own LaTeX.
    await page.locator('[data-srte-formula-entry="algebra-quadratic"]').click();
    await expect(surface.locator('[data-smart-type="formula"]')).toHaveAttribute("data-smart-formula", "E=mc^2");
    // Phase 9 SS2.4/SS3 gate 6: confirm real KaTeX HTML+MathML rendered in
    // an actual browser, not just that the source attribute is set - a
    // rendering failure that fell back to plain text would still pass the
    // attribute check above.
    await expect(surface.locator('[data-smart-type="formula"] .katex')).toBeVisible();
    await expect(surface.locator('[data-smart-type="formula"] math')).toHaveCount(1);

    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page, "image", "example.png", "image/png");
    const image = surface.locator('[data-smart-type="block_image"]');
    await expect(image).toHaveAttribute("src", /^https:\/\/media\.playground\.test\//);
    await expect(image).toBeVisible();
    await image.click();
    await openToolbarDropdown(page, "More to insert");
    await expect(toolbarMenuItem(page, "Enlarge selected media")).toBeEnabled();
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Enlarge selected media").click();
    await expect(image).toHaveAttribute("width", "180");
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Insert video").click();
    await chooseMedia(page, "video", "example.mp4", "video/mp4");
    const video = surface.locator('[data-smart-type="video"]');
    await expect(video).toHaveAttribute("src", /^https:\/\/media\.playground\.test\//);
    await expect(video).toBeVisible();
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Insert audio").click();
    await chooseMedia(page, "audio", "example.mp3", "audio/mpeg");
    const audio = surface.locator('[data-smart-type="audio"]');
    await expect(audio).toHaveAttribute("src", /^https:\/\/media\.playground\.test\//);
    await expect(audio).toBeVisible();

    const download = page.waitForEvent("download");
    await openToolbarDropdown(page, "Save a copy");
    await toolbarMenuItem(page, "Save as Smart RTE file").click();
    expect((await download).suggestedFilename()).toBe("smart-rte.json");

    await page.locator('input[type="file"]').setInputFiles({
      name: "replacement.html", mimeType: "text/html", buffer: Buffer.from("<h2>Imported canonical content</h2>"),
    });
    await expect(surface.locator("h2")).toContainText("Imported canonical content");
  });

  test("routes attributed marks, block transforms, list presets, and DOCX/PDF workflows", async ({ page }) => {
    page.on("dialog", (dialog) => {
      const message = dialog.message();
      // Text/Background colour previously went through window.prompt here;
      // Phase 11.5 wired ColorPickerPopover instead (handled explicitly
      // below), so only Font size/Font family still use a dialog.
      const answer = message.includes("Font size") ? "18"
        : message.includes("Font family") ? "Inter" : "";
      void dialog.accept(answer);
    });
    await page.goto("/?canonicalAuthority=1&blocks=3");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await selectFirstText(page);
    for (const label of ["Text colour", "Background colour"]) {
      await openToolbarDropdown(page, "More text styles");
      await toolbarMenuItem(page, label).click();
      await page.locator("[data-srte-color-hex-input]").fill("#336699");
      await page.keyboard.press("Escape");
    }
    for (const label of ["Font size", "Font family"]) {
      await openToolbarDropdown(page, "More text styles");
      await toolbarMenuItem(page, label).click();
    }
    for (const mark of ["textColor", "backgroundColor", "fontSize", "fontFamily"]) {
      await expect(surface.locator(`p:first-of-type [data-smart-mark="${mark}"]`)).toHaveCount(1);
    }

    await page.getByRole("button", { name: "Blockquote", exact: true }).click();
    await expect(surface.locator("blockquote")).toContainText("Canonical product editor");

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true);
    await openToolbarDropdown(page, "More paragraph tools");
    await toolbarMenuItem(page, "Move block up").click();
    await openToolbarDropdown(page, "More paragraph tools");
    await toolbarMenuItem(page, "Indent block").click();
    await expect(surface.locator('p[style*="margin-inline-start"]')).toHaveCount(1);

    await page.getByRole("button", { name: "Numbered list", exact: true }).click();
    await openToolbarDropdown(page, "More list tools");
    await page.getByRole("combobox", { name: "List preset" }).selectOption("ordered-upper-alpha");
    await expect(surface.locator('ol[data-smart-list-preset="ordered-upper-alpha"]')).toHaveCount(1);

    const docxDownload = page.waitForEvent("download");
    await openToolbarDropdown(page, "Save a copy");
    await toolbarMenuItem(page, "Save as Word document").click();
    expect((await docxDownload).suggestedFilename()).toBe("smart-rte.docx");

    const pdfPopup = page.waitForEvent("popup");
    await openToolbarDropdown(page, "Save a copy");
    await toolbarMenuItem(page, "Save as PDF").click();
    await (await pdfPopup).close();
  });

  /**
   * "Insert table" previously always created a fixed 2x2 - now opens a size
   * picker (CKEditor-style hover grid + a custom rows/columns numeric
   * fallback for anything past the grid's cap) and wires the chosen
   * dimensions straight into the existing insert-table command instead of
   * hardcoding 2x2 downstream.
   */
  test("insert table size picker: grid hover-click and custom numeric input both wire real dimensions through", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.getByRole("button", { name: "Insert table", exact: true }).click();
    const popover = page.locator('[data-srte-table-size-popover="true"]');
    await expect(popover).toBeVisible();
    await page.locator('[data-srte-table-size-cell="3x4"]').hover();
    await expect(page.locator('[data-srte-table-size-label="true"]')).toHaveText("3 × 4 table");
    await page.locator('[data-srte-table-size-cell="3x4"]').click();
    await expect(popover).not.toBeVisible();
    const gridTable = surface.locator("table").first();
    await expect(gridTable.locator("tr")).toHaveCount(3);
    await expect(gridTable.locator("tr").first().locator("td,th")).toHaveCount(4);

    // Escape and outside-click both cancel without inserting anything.
    await page.getByRole("button", { name: "Insert table", exact: true }).click();
    await expect(popover).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).not.toBeVisible();
    await expect(surface.locator("table")).toHaveCount(1);
    await page.getByRole("button", { name: "Insert table", exact: true }).click();
    await expect(popover).toBeVisible();
    await page.locator('[data-smart-authority="canonical"] [contenteditable="true"] > p').first().click();
    await expect(popover).not.toBeVisible();
    await expect(surface.locator("table")).toHaveCount(1);

    // The custom numeric inputs reach sizes past the grid's cap.
    await page.locator('[data-smart-authority="canonical"] [contenteditable="true"] > p').last().click();
    await page.getByRole("button", { name: "Insert table", exact: true }).click();
    await page.locator('input[aria-label="Rows"]').fill("9");
    await page.locator('input[aria-label="Columns"]').fill("10");
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(popover).not.toBeVisible();
    const customTable = surface.locator("table").nth(1);
    await expect(customTable.locator("tr")).toHaveCount(9);
    await expect(customTable.locator("tr").first().locator("td,th")).toHaveCount(10);
  });

  test("selects canonical cells individually and supports merge/split", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=2");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p');
    await insertDefaultTable(page);
    const table = surface.locator("table");
    await expect(table).toHaveCount(1);
    const first = table.locator("tr").first().locator("td,th").nth(0);
    const second = table.locator("tr").first().locator("td,th").nth(1);
    await selectCellRange(page, first, second);
    await expect(surface.locator('[data-smart-cell-selected="true"]')).toHaveCount(2);
    await openToolbarDropdown(page, "Table tools");
    await expect(toolbarMenuItem(page, "Merge cells")).toBeEnabled();
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Merge cells").click();
    await expect(table.locator("tr").first().locator("td,th")).toHaveCount(1);
    await expect(table.locator("tr").first().locator("td,th").first()).toHaveAttribute("colspan", "2");
    await expect.poll(() => page.evaluate(() => window.__smartProductCanonical?.editor.selection.type)).toBe("cell");
    // Empty source cells contain editable placeholder paragraphs. A merge
    // must retain one editable line, not stack one placeholder per source
    // cell (which multiplies the merged row height).
    await expect(table.locator("tr").first().locator("td,th").first().locator(":scope > p")).toHaveCount(1);
    await openToolbarDropdown(page, "Table tools");
    await expect(toolbarMenuItem(page, "Split cell")).toBeEnabled();
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Split cell").click();
    await expect(table.locator("tr").first().locator("td,th")).toHaveCount(2);
    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page, "image", "cell.png", "image/png");
    await expect(surface.locator('[data-smart-type="block_image"]')).toHaveAttribute("src", /^https:\/\/media\.playground\.test\//);
  });

  // "when I merge cells despite of horizantal and vertical their content
  // shouldn't get mixed. it should wrapped down in new line." - merging
  // cells with real, distinct one-line content previously concatenated
  // them onto a single shared line (e.g. "Apple"/"Banana" merged into the
  // unreadable run "AppleBanana") to keep the merged row's height from
  // growing - see docs/bugs/table-merge-concatenates-cell-content.md.
  test("merges cells with real content onto separate lines instead of mixing it together, both horizontally and vertically", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const cell = (id: string, text: string) => ({
        type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false },
        children: [{ type: "paragraph", id: `${id}-p`, children: text ? [{ type: "text", text }] : [] }],
      });
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "merge-content-doc", children: [
          // Two independent tables - a horizontal merge on the first, a
          // vertical merge on the second - so neither selection's
          // rectangle-snap has to widen to cover a cell outside what's
          // actually being asserted.
          { type: "table", id: "merge-content-h-table", attrs: { columnWidths: [150, 150] }, children: [
            { type: "table_row", id: "merge-content-h-r0", children: [cell("merge-content-h-a0", "Apple"), cell("merge-content-h-b0", "Banana")] },
          ] },
          { type: "table", id: "merge-content-v-table", attrs: { columnWidths: [150] }, children: [
            { type: "table_row", id: "merge-content-v-r0", children: [cell("merge-content-v-a0", "Apple")] },
            { type: "table_row", id: "merge-content-v-r1", children: [cell("merge-content-v-a1", "Banana")] },
          ] },
        ] },
      });
    });
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const tables = surface.locator("table");

    // Horizontal merge: two cells in the same row.
    const a0 = tables.nth(0).locator('[data-smart-id="merge-content-h-a0"]');
    const b0 = tables.nth(0).locator('[data-smart-id="merge-content-h-b0"]');
    await selectCellRange(page, a0, b0);
    await expect(surface.locator('[data-smart-cell-selected="true"]')).toHaveCount(2);
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Merge cells").click();
    const horizontalAnchor = tables.nth(0).locator('[data-smart-id="merge-content-h-a0"]');
    await expect(horizontalAnchor).toHaveAttribute("colspan", "2");
    // Each source cell's text survives as its own paragraph/line, not
    // concatenated into a single "AppleBanana" run.
    await expect(horizontalAnchor.locator(":scope > p")).toHaveCount(2);
    await expect(horizontalAnchor.locator(":scope > p").nth(0)).toHaveText("Apple");
    await expect(horizontalAnchor.locator(":scope > p").nth(1)).toHaveText("Banana");

    // Vertical merge: two cells in the same column, different rows.
    const v0 = tables.nth(1).locator('[data-smart-id="merge-content-v-a0"]');
    const v1 = tables.nth(1).locator('[data-smart-id="merge-content-v-a1"]');
    await selectCellRange(page, v0, v1);
    await expect(surface.locator('[data-smart-cell-selected="true"]')).toHaveCount(2);
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Merge cells").click();
    const verticalAnchor = tables.nth(1).locator('[data-smart-id="merge-content-v-a0"]');
    await expect(verticalAnchor).toHaveAttribute("rowspan", "2");
    await expect(verticalAnchor.locator(":scope > p")).toHaveCount(2);
    await expect(verticalAnchor.locator(":scope > p").nth(0)).toHaveText("Apple");
    await expect(verticalAnchor.locator(":scope > p").nth(1)).toHaveText("Banana");
  });

  test("keeps a caret and new text available after a table", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p');
    await insertDefaultTable(page);
    const after = surface.locator(":scope > p").last();
    await expect(after).toHaveCount(1);
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true);
    await page.keyboard.type(" after table");
    await expect(after).toContainText("after table");
  });

  test("creates a nested list inside a table cell", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p');
    await insertDefaultTable(page);
    const cellParagraph = surface.locator("table tr").first().locator("td,th").first().locator("p");
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] table tr:first-of-type td:first-child p');
    await page.getByRole("button", { name: "Bulleted list" }).click();
    await expect(cellParagraph.locator("xpath=ancestor::td").locator(":scope > ul > li")).toHaveCount(1);

    // A second item must be able to indent without escaping the isolating
    // cell. This is the cross-feature case that a single-item list does not
    // exercise.
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] table tr:first-of-type td:first-child p');
    await page.keyboard.type("first");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second");
    const secondParagraph = surface.locator("table tr").first().locator("td,th").first().locator("ul > li:nth-child(2) p");
    await expect(secondParagraph).toHaveCount(1);
    await placeCaret(page, '[data-smart-authority="canonical"] table tr:first-of-type td:first-child ul > li:nth-child(2) p');
    await openToolbarDropdown(page, "More list tools");
    await toolbarMenuItem(page, "Indent list item").click();
    await expect(surface.locator("table tr:first-of-type td:first-child ul > li > ul > li")).toHaveCount(1);
  });

  test("selects a vertical cell range and merges it", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p');
    await insertDefaultTable(page);
    const table = surface.locator("table");
    const first = table.locator("tr").nth(0).locator("td,th").nth(0);
    const below = table.locator("tr").nth(1).locator("td,th").nth(0);
    await selectCellRange(page, first, below);
    await expect(surface.locator('[data-smart-cell-selected="true"]')).toHaveCount(2);
    await openToolbarDropdown(page, "Table tools");
    await expect(toolbarMenuItem(page, "Merge cells")).toBeEnabled();
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Merge cells").click();
    await expect(table.locator("tr").first().locator("td,th").first()).toHaveAttribute("rowspan", "2");
  });

  // A vertical drag from row 1 col 1 to row 2 col 1 forms a native DOM Range
  // that, in row-major order, also passes through row 1 col 2 (the cell
  // between the drag's start and end). Confirmed via screenshot: the browser
  // kept rendering its own grey text-highlight across that untouched cell
  // even though only the 2 intended cells were part of the logical/model
  // selection - correct model, misleading native-selection render.
  test("suppresses the native text-selection highlight while a cell range is selected", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p');
    await insertDefaultTable(page);
    const table = surface.locator("table");
    const first = table.locator("tr").nth(0).locator("td,th").nth(0);
    const below = table.locator("tr").nth(1).locator("td,th").nth(0);
    const untouched = table.locator("tr").nth(0).locator("td,th").nth(1);
    await selectCellRange(page, first, below);
    await expect(surface.locator('[data-smart-cell-selected="true"]')).toHaveCount(2);
    await expect(untouched).not.toHaveAttribute("data-smart-cell-selected", "true");
    await expect(surface).toHaveAttribute("data-smart-cell-selection-active", "true");
    const selectionBackground = await surface.evaluate(
      (root) => getComputedStyle(root, "::selection").backgroundColor,
    );
    expect(["transparent", "rgba(0, 0, 0, 0)"]).toContain(selectionBackground);
    // Splitting back out of the cell selection (click elsewhere) must drop
    // the suppression again, not leave native selection permanently inert.
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true);
    await expect(surface).not.toHaveAttribute("data-smart-cell-selection-active", "true");
  });

  test("moves the caret to an editable line after a block atom", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p');
    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page, "image", "image.png", "image/png");
    const image = surface.locator('[data-smart-type="block_image"]');
    await expect(image).toHaveCount(1);
    await image.click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("below image");
    await expect(surface.locator(":scope > p").last()).toContainText("below image");
  });

  test("shows an empty-line caret, applies content styling, and keeps structural tools contextual", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=3");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p');
    await page.keyboard.press("Enter");

    const presentation = await surface.evaluate((root) => {
      const empty = root.querySelector<HTMLElement>('[data-srte-caret-boundary="true"]')!;
      const rootStyle = getComputedStyle(root);
      const emptyStyle = getComputedStyle(empty);
      return {
        paddingLeft: rootStyle.paddingLeft,
        caretColor: rootStyle.caretColor,
        color: rootStyle.color,
        emptyHeight: empty.getBoundingClientRect().height,
        emptyLineHeight: Number.parseFloat(emptyStyle.lineHeight),
      };
    });
    expect(presentation.paddingLeft).toBe("20px");
    expect(presentation.caretColor).toBe(presentation.color);
    expect(presentation.emptyHeight).toBeGreaterThanOrEqual(presentation.emptyLineHeight - 0.1);

    await openToolbarDropdown(page, "Table tools");

    await expect(toolbarMenuItem(page, "Add row")).toBeDisabled();
    await openToolbarDropdown(page, "More list tools");
    await expect(toolbarMenuItem(page, "Check selected items")).toBeDisabled();
  });

  test("keeps list selection stable through indent, outdent, movement, restart, and continue", async ({ page }) => {
    page.on("dialog", (dialog) => void dialog.accept("3"));
    await page.goto("/?canonicalAuthority=1&blocks=3");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const blocks = document.querySelectorAll<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"] > p');
      const range = document.createRange();
      range.selectNodeContents(blocks[0]);
      range.setEndAfter(blocks[1]);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "Bulleted list" }).click();
    await expect(surface.locator(":scope > ul > li")).toHaveCount(2);

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > ul > li:nth-child(2) p');
    await openToolbarDropdown(page, "More list tools");
    await expect(toolbarMenuItem(page, "Indent list item")).toBeEnabled();
    await openToolbarDropdown(page, "More list tools");
    await toolbarMenuItem(page, "Indent list item").click();
    await expect(surface.locator(":scope > ul > li > ul > li")).toHaveCount(1);
    await openToolbarDropdown(page, "More list tools");
    await toolbarMenuItem(page, "Outdent list item").click();
    await expect(surface.locator(":scope > ul > li")).toHaveCount(2);

    await openToolbarDropdown(page, "More list tools");

    await toolbarMenuItem(page, "Move item up").click();
    await expect(surface.locator(":scope > ul > li").first()).toContainText("block 1");
    await openToolbarDropdown(page, "More list tools");
    await toolbarMenuItem(page, "Move item down").click();
    await expect(surface.locator(":scope > ul > li").first()).toContainText("Canonical product editor");

    await page.getByRole("button", { name: "Numbered list" }).click();
    const ordered = surface.locator(":scope > ol");
    await expect(ordered).toHaveCount(1);
    await openToolbarDropdown(page, "More list tools");
    await toolbarMenuItem(page, "Restart numbering").click();
    await expect(ordered).toHaveAttribute("start", "3");
    await openToolbarDropdown(page, "More list tools");
    await toolbarMenuItem(page, "Continue numbering").click();
    await expect(ordered).not.toHaveAttribute("start");
  });

  /**
   * Regression: choosing a list preset (the "List preset" select in "More
   * list tools") clears the list's literal `.attrs.style` in favor of
   * `.attrs.preset` (docs/bugs/list-marker-competing-style-and-preset-
   * signals.md) - but the toggle buttons' "is this already active" check
   * compared `.attrs.style` directly against the literal string "disc"/
   * "decimal", so after picking *any* preset every toggle button read as
   * "not active" even though the list still visually was a bullet/ordered
   * list. Clicking the matching button then took the "apply a different
   * style" branch instead of "toggle off" - silently replacing the preset
   * with a bare disc/decimal instead of removing the list, so the user's
   * first click appeared to do nothing and a *second* click was needed to
   * actually get back to plain text.
   */
  test("toggling a list style off works in one click after a preset was applied, for both bullet and ordered presets", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await selectFirstText(page);
    await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await openToolbarDropdown(page, "More list tools");
    await page.getByRole("combobox", { name: "List preset" }).selectOption("bullet-diamond");
    await expect(page.getByRole("button", { name: "Bulleted list", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await expect(surface.locator("ul, ol")).toHaveCount(0);

    await page.getByRole("button", { name: "Numbered list", exact: true }).click();
    await openToolbarDropdown(page, "More list tools");
    await page.getByRole("combobox", { name: "List preset" }).selectOption("ordered-upper-alpha");
    await expect(page.getByRole("button", { name: "Numbered list", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Numbered list", exact: true }).click();
    await expect(surface.locator("ul, ol")).toHaveCount(0);
  });

  /**
   * A Direction B toolbar dropdown left open, then clicking straight into
   * the editor, previously left it open - the component's own doc comment
   * claimed native `<details>` "already closes on an outside click by
   * default in every evergreen browser," which is false (confirmed
   * directly: `<details>` only closes via its own `<summary>` or a script
   * setting `open = false` - there is no such native behavior). Reuses the
   * same outside-click dismiss pattern already proven for ContextMenu.tsx
   * and ColorPickerPopover.tsx.
   */
  test("an open toolbar dropdown closes when clicking into the editor", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const dropdown = page.locator("details.srte-toolbar-menu", { has: page.locator("summary", { hasText: "More text styles" }) });
    await dropdown.locator("summary").click();
    await expect(page.getByRole("menuitem", { name: "Code", exact: true })).toBeVisible();
    await page.locator('[data-smart-authority="canonical"] [contenteditable="true"]').click();
    await expect(dropdown).not.toHaveAttribute("open", "");
    await expect(page.getByRole("menuitem", { name: "Code", exact: true })).not.toBeVisible();
  });

  /**
   * Phase 11 Tier 3: axe-core coverage was concentrated entirely in
   * canonical-surface.spec.ts (the lower-level harness); the real product
   * surface (CanonicalAuthorityEditor, toolbar-routed) had zero axe scans.
   * This exercises the toolbar itself plus a mixed-feature document
   * (marks, list, table, heading) in one pass.
   */
  test("has no axe violations in the toolbar and a mixed-feature document", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "axe-doc", children: [
          { type: "heading", id: "axe-h", attrs: { level: 2 }, children: [{ type: "text", text: "Title" }] },
          { type: "paragraph", id: "axe-p", children: [{ type: "text", text: "bold and italic", marks: [] }, { type: "text", text: " word", marks: [{ type: "bold" }] }] },
          { type: "list", id: "axe-list", attrs: { style: "disc" }, children: [
            { type: "list_item", id: "axe-li", children: [{ type: "paragraph", id: "axe-li-p", children: [{ type: "text", text: "item" }] }] },
          ] },
          { type: "table", id: "axe-table", attrs: { columnWidths: [100] }, children: [
            { type: "table_row", id: "axe-row", children: [
              { type: "table_cell", id: "axe-cell", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "axe-cell-p", children: [{ type: "text", text: "cell" }] }] },
            ] },
          ] },
        ] },
      });
    });
    const surfaceLocator = page.locator('[data-smart-authority="canonical"]');
    await expect(surfaceLocator.locator('[contenteditable="true"]')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-smart-authority="canonical"]').analyze();
    expect(results.violations).toEqual([]);
  });
});

/**
 * Report: "several important tools are still hidden inside dropdowns" at a
 * genuinely spacious ~2264px desktop viewport (Superscript, Subscript, Text
 * colour, Background colour, Font size, Font family, Remove link, Insert
 * formula, Special characters). Investigation confirmed the priority-collapse
 * system had exactly ONE breakpoint (639px, mobile-vs-everything-else) with
 * every dropdown using the same priority={2} - nothing scaled with available
 * width past that, and the toolbar's own flex-wrap meant it never actually
 * ran out of room even at narrow desktop widths, so tools stayed
 * dropdown-only purely by static JSX grouping, regardless of real estate.
 * See docs/bugs/toolbar-priority-collapse-fixed-threshold-no-wide-promotion.md.
 *
 * Fix: the 9 named tools above got a standalone `data-srte-wide-promote`
 * ToolbarButton copy (theme.ts) that appears at >=1440px, with their
 * existing dropdown/mobile-menu copy hiding at that point so nothing is
 * offered twice. 1440px (not 1280px) specifically to clear Playwright's own
 * default 1280x720 test viewport, which nearly every other toolbar test in
 * this suite runs at without calling setViewportSize.
 */
test.describe("toolbar priority-collapse: wide-viewport promotion", () => {
  const promotedLabels = ["Superscript", "Subscript", "Text colour", "Background colour", "Font size", "Font family", "Remove link", "Insert formula", "Special characters"];

  test("mobile (375px): promoted tools are not directly visible, only reachable via the single mobile More menu", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/?canonicalAuthority=1&blocks=1");
    for (const label of promotedLabels) {
      await expect(page.getByRole("button", { name: label, exact: true })).not.toBeVisible();
    }
    // Still reachable - the pre-existing mobile collapse (639px breakpoint,
    // unchanged by this fix) funnels everything into one "More tools" menu.
    await expect(page.locator(".srte-mobile-more")).toBeVisible();
    await page.locator(".srte-mobile-more > summary").click();
    await expect(page.getByRole("menuitem", { name: "Superscript", exact: true })).toBeVisible();
  });

  test("tablet (800px): promoted tools stay in their existing dropdowns, matching today's unchanged compact layout", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/?canonicalAuthority=1&blocks=1");
    for (const label of promotedLabels) {
      await expect(page.getByRole("button", { name: label, exact: true })).not.toBeVisible();
    }
    await openToolbarDropdown(page, "More text styles");
    await expect(toolbarMenuItem(page, "Superscript")).toBeVisible();
    await expect(toolbarMenuItem(page, "Code")).toBeVisible();
  });

  test("typical laptop (1280px, Playwright's own default viewport): promoted tools are NOT promoted yet, confirming the 1440px threshold choice", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/?canonicalAuthority=1&blocks=1");
    for (const label of promotedLabels) {
      await expect(page.getByRole("button", { name: label, exact: true })).not.toBeVisible();
    }
    await openToolbarDropdown(page, "More to insert");
    await expect(toolbarMenuItem(page, "Insert formula")).toBeVisible();
    await expect(toolbarMenuItem(page, "Special characters")).toBeVisible();
  });

  test("wide desktop (2264px, the reported width): all 9 named tools become directly visible, and one still works end to end", async ({ page }) => {
    await page.setViewportSize({ width: 2264, height: 1200 });
    await page.goto("/?canonicalAuthority=1&blocks=1");
    for (const label of promotedLabels) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    // The dropdown copies hide once promoted - "More text styles" still
    // exists (Code didn't get promoted) but no longer lists Superscript.
    await openToolbarDropdown(page, "More text styles");
    await expect(toolbarMenuItem(page, "Code")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Superscript", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Functional, not just visible: the promoted button actually works.
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode() as Text;
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "Superscript", exact: true }).click();
    await expect(surface.locator('[data-smart-mark="superscript"]')).toHaveCount(1);
  });
});
