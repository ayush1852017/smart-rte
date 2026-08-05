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

const placeCaret = async (page: Page, selector: string, last = false) => page.evaluate(({ selector, last }) => {
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

const selectCellRange = async (page: Page, start: Locator, end: Locator) => {
  const startBox = await start.boundingBox();
  const endBox = await end.boundingBox();
  if (!startBox || !endBox) throw new Error("Canonical table cells must be visible before selecting them.");
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 4 });
  await page.mouse.up();
};

test.describe("canonical toolbar routing", () => {
  test("routes lists, links, tables, atoms, resize, import, and export through retained state", async ({ page }) => {
    let linkPrompt = 0;
    page.on("dialog", (dialog) => {
      const message = dialog.message();
      const answer = message.includes("Link") ? (linkPrompt++ === 0 ? "https://example.test" : "https://updated.example.test")
        : message.includes("Formula") ? "E=mc^2"
            : message.includes("Image URL") ? "https://example.test/image.png"
              : message.includes("video URL") ? "https://example.test/video.mp4"
                : message.includes("audio URL") ? "https://example.test/audio.mp3"
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
    const image = surface.locator('[data-smart-type="block_image"]');
    await expect(image).toHaveAttribute("src", "https://example.test/image.png");
    await expect(image).toBeVisible();
    await image.click();
    await page.getByRole("button", { name: "Grow selected atom" }).click();
    await expect(image).toHaveAttribute("width", "180");
    await page.getByRole("button", { name: "Insert video" }).click();
    const video = surface.locator('[data-smart-type="video"]');
    await expect(video).toHaveAttribute("src", "https://example.test/video.mp4");
    await expect(video).toBeVisible();
    await page.getByRole("button", { name: "Insert audio" }).click();
    const audio = surface.locator('[data-smart-type="audio"]');
    await expect(audio).toHaveAttribute("src", "https://example.test/audio.mp3");
    await expect(audio).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export native document" }).click();
    expect((await download).suggestedFilename()).toBe("smart-rte.json");

    await page.locator('input[type="file"]').setInputFiles({
      name: "replacement.html", mimeType: "text/html", buffer: Buffer.from("<h2>Imported canonical content</h2>"),
    });
    await expect(surface.locator("h2")).toContainText("Imported canonical content");
  });

  test("selects canonical cells individually and supports merge/split", async ({ page }) => {
    page.on("dialog", (dialog) => void dialog.accept(dialog.message().includes("Image URL") ? "https://example.test/cell.png" : "Cell image"));
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
    await expect(page.getByRole("button", { name: "Split cell" })).toBeEnabled();
    await page.getByRole("button", { name: "Split cell" }).click();
    await expect(table.locator("tr").first().locator("td,th")).toHaveCount(2);
    await page.getByRole("button", { name: "Insert image" }).click();
    await expect(surface.locator('[data-smart-type="block_image"]')).toHaveAttribute("src", "https://example.test/cell.png");
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
