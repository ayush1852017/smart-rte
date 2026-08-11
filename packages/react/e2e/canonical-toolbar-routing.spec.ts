import { expect, test, type Locator, type Page } from "@playwright/test";

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

const chooseMedia = async (page: Page, kind: "image" | "video" | "audio", name: string, mimeType: string) => {
  const picker = page.getByRole("dialog", { name: `Choose ${kind}` });
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
    await page.getByRole("button", { name: "Check selected items" }).click();
    await expect(surface.locator('[role="checkbox"]')).toHaveAttribute("aria-checked", "true");
  });

  test("routes lists, links, tables, atoms, resize, import, and export through retained state", async ({ page }) => {
    let linkPrompt = 0;
    page.on("dialog", (dialog) => {
      const message = dialog.message();
      const answer = message.includes("Link") ? (linkPrompt++ === 0 ? "https://example.test" : "https://updated.example.test")
        : message.includes("Formula") ? "E=mc^2"
            : message.includes("Alt text") ? "Example image" : "";
      void dialog.accept(answer);
    });
    await page.goto("/?canonicalAuthority=1&blocks=2");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');

    await selectFirstText(page);
    await page.getByRole("button", { name: "Insert or edit link" }).click();
    await expect(surface.locator("a")).toHaveAttribute("href", "https://example.test");
    await expect(surface.locator("a")).toHaveCSS("text-decoration-line", "underline");
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] a');
    await page.getByRole("button", { name: "Insert or edit link" }).click();
    await expect(surface.locator("a")).toHaveAttribute("href", "https://updated.example.test");

    await page.getByRole("button", { name: "Bulleted list" }).click();
    await expect(surface.locator("ul > li")).toHaveCount(1);
    await page.getByRole("button", { name: "Numbered list" }).click();
    await expect(surface.locator("ol > li")).toHaveCount(1);
    await page.getByRole("button", { name: "Checklist" }).click();
    await expect(surface.locator('ul[data-smart-checkable="true"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Check selected items" }).click();
    await expect(surface.locator('[role="checkbox"]')).toHaveAttribute("aria-checked", "true");

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p', true);
    await page.getByRole("button", { name: "Insert table" }).click();
    await expect(surface.locator("table tr")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Add row" })).toBeEnabled();
    await page.getByRole("button", { name: "Add row" }).click();
    await expect(surface.locator("table tr")).toHaveCount(3);

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p', true);
    await page.getByRole("button", { name: "Insert formula" }).click();
    await expect(surface.locator('[data-smart-type="formula"]')).toHaveAttribute("data-smart-formula", "E=mc^2");

    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page, "image", "example.png", "image/png");
    const image = surface.locator('[data-smart-type="block_image"]');
    await expect(image).toHaveAttribute("src", /^https:\/\/media\.playground\.test\//);
    await expect(image).toBeVisible();
    await image.click();
    await expect(page.getByRole("button", { name: "Grow selected atom" })).toBeEnabled();
    await page.getByRole("button", { name: "Grow selected atom" }).click();
    await expect(image).toHaveAttribute("width", "180");
    await page.getByRole("button", { name: "Insert video" }).click();
    await chooseMedia(page, "video", "example.mp4", "video/mp4");
    const video = surface.locator('[data-smart-type="video"]');
    await expect(video).toHaveAttribute("src", /^https:\/\/media\.playground\.test\//);
    await expect(video).toBeVisible();
    await page.getByRole("button", { name: "Insert audio" }).click();
    await chooseMedia(page, "audio", "example.mp3", "audio/mpeg");
    const audio = surface.locator('[data-smart-type="audio"]');
    await expect(audio).toHaveAttribute("src", /^https:\/\/media\.playground\.test\//);
    await expect(audio).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export native document" }).click();
    expect((await download).suggestedFilename()).toBe("smart-rte.json");

    await page.locator('input[type="file"]').setInputFiles({
      name: "replacement.html", mimeType: "text/html", buffer: Buffer.from("<h2>Imported canonical content</h2>"),
    });
    await expect(surface.locator("h2")).toContainText("Imported canonical content");
  });

  test("routes attributed marks, block transforms, list presets, and DOCX/PDF workflows", async ({ page }) => {
    page.on("dialog", (dialog) => {
      const message = dialog.message();
      const answer = message.includes("Text colour") || message.includes("Background colour") ? "#336699"
        : message.includes("Font size") ? "18"
          : message.includes("Font family") ? "Inter" : "";
      void dialog.accept(answer);
    });
    await page.goto("/?canonicalAuthority=1&blocks=3");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await selectFirstText(page);
    for (const label of ["Text colour", "Background colour", "Font size", "Font family"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
    }
    for (const mark of ["textColor", "backgroundColor", "fontSize", "fontFamily"]) {
      await expect(surface.locator(`p:first-of-type [data-smart-mark="${mark}"]`)).toHaveCount(1);
    }

    await page.getByRole("button", { name: "Blockquote", exact: true }).click();
    await expect(surface.locator("blockquote")).toContainText("Canonical product editor");

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true);
    await page.getByRole("button", { name: "Move block up", exact: true }).click();
    await page.getByRole("button", { name: "Indent block", exact: true }).click();
    await expect(surface.locator('p[style*="margin-inline-start"]')).toHaveCount(1);

    await page.getByRole("button", { name: "Numbered list", exact: true }).click();
    await page.getByRole("combobox", { name: "List preset" }).selectOption("ordered-upper-alpha");
    await expect(surface.locator('ol[data-smart-list-preset="ordered-upper-alpha"]')).toHaveCount(1);

    const docxDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export DOCX", exact: true }).click();
    expect((await docxDownload).suggestedFilename()).toBe("smart-rte.docx");

    const pdfPopup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Export PDF", exact: true }).click();
    await (await pdfPopup).close();
  });

  test("selects canonical cells individually and supports merge/split", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=2");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p');
    await page.getByRole("button", { name: "Insert table" }).click();
    const table = surface.locator("table");
    await expect(table).toHaveCount(1);
    const first = table.locator("tr").first().locator("td,th").nth(0);
    const second = table.locator("tr").first().locator("td,th").nth(1);
    await selectCellRange(page, first, second);
    await expect(surface.locator('[data-smart-cell-selected="true"]')).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Merge cells" })).toBeEnabled();
    await page.getByRole("button", { name: "Merge cells" }).click();
    await expect(table.locator("tr").first().locator("td,th")).toHaveCount(1);
    await expect(table.locator("tr").first().locator("td,th").first()).toHaveAttribute("colspan", "2");
    await expect.poll(() => page.evaluate(() => window.__smartProductCanonical?.editor.selection.type)).toBe("cell");
    // Empty source cells contain editable placeholder paragraphs. A merge
    // must retain one editable line, not stack one placeholder per source
    // cell (which multiplies the merged row height).
    await expect(table.locator("tr").first().locator("td,th").first().locator(":scope > p")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Split cell" })).toBeEnabled();
    await page.getByRole("button", { name: "Split cell" }).click();
    await expect(table.locator("tr").first().locator("td,th")).toHaveCount(2);
    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page, "image", "cell.png", "image/png");
    await expect(surface.locator('[data-smart-type="block_image"]')).toHaveAttribute("src", /^https:\/\/media\.playground\.test\//);
  });

  test("keeps a caret and new text available after a table", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p');
    await page.getByRole("button", { name: "Insert table" }).click();
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
    await page.getByRole("button", { name: "Insert table" }).click();
    const cellParagraph = surface.locator("table tr").first().locator("td,th").first().locator("p");
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] table tr:first-child td:first-child p');
    await page.getByRole("button", { name: "Bulleted list" }).click();
    await expect(cellParagraph.locator("xpath=ancestor::td").locator(":scope > ul > li")).toHaveCount(1);

    // A second item must be able to indent without escaping the isolating
    // cell. This is the cross-feature case that a single-item list does not
    // exercise.
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] table tr:first-child td:first-child p');
    await page.keyboard.type("first");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second");
    const secondParagraph = surface.locator("table tr").first().locator("td,th").first().locator("ul > li:nth-child(2) p");
    await expect(secondParagraph).toHaveCount(1);
    await placeCaret(page, '[data-smart-authority="canonical"] table tr:first-child td:first-child ul > li:nth-child(2) p');
    await page.getByRole("button", { name: "Indent list item" }).click();
    await expect(surface.locator("table tr:first-child td:first-child ul > li > ul > li")).toHaveCount(1);
  });

  test("selects a vertical cell range and merges it", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p');
    await page.getByRole("button", { name: "Insert table" }).click();
    const table = surface.locator("table");
    const first = table.locator("tr").nth(0).locator("td,th").nth(0);
    const below = table.locator("tr").nth(1).locator("td,th").nth(0);
    await selectCellRange(page, first, below);
    await expect(surface.locator('[data-smart-cell-selected="true"]')).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Merge cells" })).toBeEnabled();
    await page.getByRole("button", { name: "Merge cells" }).click();
    await expect(table.locator("tr").first().locator("td,th").first()).toHaveAttribute("rowspan", "2");
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

    await expect(page.getByRole("button", { name: "Add row" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Check selected items" })).toBeDisabled();
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
    await expect(page.getByRole("button", { name: "Indent list item" })).toBeEnabled();
    await page.getByRole("button", { name: "Indent list item" }).click();
    await expect(surface.locator(":scope > ul > li > ul > li")).toHaveCount(1);
    await page.getByRole("button", { name: "Outdent list item" }).click();
    await expect(surface.locator(":scope > ul > li")).toHaveCount(2);

    await page.getByRole("button", { name: "Move item up" }).click();
    await expect(surface.locator(":scope > ul > li").first()).toContainText("block 1");
    await page.getByRole("button", { name: "Move item down" }).click();
    await expect(surface.locator(":scope > ul > li").first()).toContainText("Canonical product editor");

    await page.getByRole("button", { name: "Numbered list" }).click();
    const ordered = surface.locator(":scope > ol");
    await expect(ordered).toHaveCount(1);
    await page.getByRole("button", { name: "Restart numbering" }).click();
    await expect(ordered).toHaveAttribute("start", "3");
    await page.getByRole("button", { name: "Continue numbering" }).click();
    await expect(ordered).not.toHaveAttribute("start");
  });
});
