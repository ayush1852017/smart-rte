import { expect, test, type Page } from "@playwright/test";

const editorSelector = '.srte-editor [contenteditable="true"]';

const setEditorHtml = async (page: Page, html: string) => {
  await page.locator(editorSelector).evaluate((editor, nextHtml) => {
    editor.innerHTML = nextHtml;
    editor.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
    }));
  }, html);
};

const selectTextRange = async (
  page: Page,
  startText: string,
  startOffset: number,
  endText: string,
  endOffset: number,
) => {
  await page.locator(editorSelector).evaluate((editor, selection) => {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
    const start = textNodes.find((text) => text.data.includes(selection.startText));
    const end = [...textNodes].reverse().find((text) => text.data.includes(selection.endText));
    if (!start || !end) throw new Error(`Selection text not found: ${selection.startText} → ${selection.endText}`);
    const range = document.createRange();
    range.setStart(start, start.data.indexOf(selection.startText) + selection.startOffset);
    range.setEnd(end, end.data.indexOf(selection.endText) + selection.endOffset);
    const current = window.getSelection();
    current?.removeAllRanges();
    current?.addRange(range);
    editor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  }, { startText, startOffset, endText, endOffset });
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(editorSelector)).toBeVisible();
});

test("applies bold to a mixed selection and updates the toolbar state", async ({ page }) => {
  await setEditorHtml(page, "<p>Plain <strong>Bold</strong> tail</p>");
  await selectTextRange(page, "Plain ", 0, "Bold", "Bold".length);
  const bold = page.getByTitle("Bold", { exact: true });
  await expect(bold).toHaveAttribute("aria-pressed", "mixed");
  await bold.click();

  const paragraph = page.locator(`${editorSelector} p`);
  await expect(paragraph.locator("strong,b")).toHaveCount(1);
  await expect(paragraph.locator("strong,b")).toHaveText("Plain Bold");
  await selectTextRange(page, "Plain ", 0, "Bold", "Bold".length);
  await expect(bold).toHaveAttribute("aria-pressed", "true");
});

test("changes heading and alignment for the selected block", async ({ page }) => {
  await setEditorHtml(page, "<p>Section title</p><p>Body text</p>");
  await selectTextRange(page, "Section title", 0, "Section title", "Section title".length);
  await page.getByTitle("Paragraph/Heading").selectOption("h2");

  const heading = page.locator(`${editorSelector} h2`);
  await expect(heading).toHaveText("Section title");
  await page.getByTitle("Text alignment", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Align center" }).click();
  await expect(heading).toHaveCSS("text-align", "center");
  await expect(page.locator(`${editorSelector} p`)).toHaveText("Body text");
});

test("creates a native link while preserving the selected label", async ({ page }) => {
  await setEditorHtml(page, "<p>Read documentation today</p>");
  await selectTextRange(page, "documentation", 0, "documentation", "documentation".length);
  await page.getByRole("button", { name: "Insert or edit link" }).click();
  await expect(page.locator('[data-srte-link-popover="true"]')).toBeVisible();
  await page.locator('[data-srte-link-href-input="true"]').fill("https://example.com/docs");
  await page.getByRole("button", { name: "Insert", exact: true }).click();

  const link = page.locator(`${editorSelector} a`);
  await expect(link).toHaveText("documentation");
  await expect(link).toHaveAttribute("href", "https://example.com/docs");
  await expect(page.locator(editorSelector)).toContainText("Read documentation today");
});

test("undoes and redoes inline formatting as one history step", async ({ page }) => {
  await setEditorHtml(page, "<p>Format this text</p>");
  await selectTextRange(page, "this", 0, "this", "this".length);
  await page.getByTitle("Bold", { exact: true }).click();
  const editor = page.locator(editorSelector);
  await expect(editor.locator("strong,b")).toHaveText("this");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(editor.locator("strong,b")).toHaveCount(0);
  await expect(editor).toContainText("Format this text");

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(editor.locator("strong,b")).toHaveText("this");
});
