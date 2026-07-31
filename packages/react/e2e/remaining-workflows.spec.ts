import { expect, test, type Page } from "@playwright/test";

const editorSelector = '.srte-editor [contenteditable="true"]';

const setEditorHtml = async (page: Page, html: string) => {
  await page.locator(editorSelector).evaluate((editor, nextHtml) => {
    editor.innerHTML = nextHtml;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  }, html);
};

const selectTextRange = async (page: Page, startText: string, endText: string) => {
  await page.locator(editorSelector).evaluate((editor, selection) => {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) { nodes.push(node as Text); node = walker.nextNode(); }
    const start = nodes.find((text) => text.data.includes(selection.startText));
    const end = [...nodes].reverse().find((text) => text.data.includes(selection.endText));
    if (!start || !end) throw new Error("Selection text not found");
    const range = document.createRange();
    range.setStart(start, start.data.indexOf(selection.startText));
    range.setEnd(end, end.data.indexOf(selection.endText) + selection.endText.length);
    const current = window.getSelection();
    current?.removeAllRanges(); current?.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  }, { startText, endText });
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(editorSelector)).toBeVisible();
});

test("creates and removes a checklist while preserving checked state", async ({ page }) => {
  await setEditorHtml(page, "<p>First task</p><p>Second task</p>");
  await selectTextRange(page, "First task", "Second task");
  await page.getByTitle("Checklist", { exact: true }).click();
  const editor = page.locator(editorSelector);
  await expect(editor.locator('[data-srte-checklist="true"]')).toHaveCount(1);
  await expect(editor.locator('[data-srte-check]')).toHaveCount(2);
  await editor.locator('[data-srte-check]').first().click();
  await expect(editor.locator('[data-srte-check]').first()).toHaveAttribute("aria-label", "Mark incomplete");
  await selectTextRange(page, "First task", "Second task");
  await page.getByTitle("Checklist", { exact: true }).click();
  await expect(editor.locator('[data-srte-checklist="true"]')).toHaveCount(0);
  await expect(editor).toContainText("First task");
  await expect(editor).toContainText("Second task");
});

test("applies blockquote and code block commands to selected blocks", async ({ page }) => {
  await setEditorHtml(page, "<p>Quoted text</p><p>Code text</p>");
  await selectTextRange(page, "Quoted text", "Quoted text");
  await page.getByTitle("Blockquote", { exact: true }).click();
  await expect(page.locator(`${editorSelector} blockquote`)).toContainText("Quoted text");
  await selectTextRange(page, "Code text", "Code text");
  await page.getByTitle("Code block", { exact: true }).click();
  await expect(page.locator(`${editorSelector} pre`)).toContainText("Code text");
});

test("inserts a formula through the real formula dialog", async ({ page }) => {
  await setEditorHtml(page, "<p>Energy: </p>");
  await page.locator(`${editorSelector} p`).click();
  await page.getByTitle("Insert", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Formula" }).click();
  await page.locator('input[placeholder*="Type LaTeX"]').fill("\\frac{a}{b}");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(page.locator(`${editorSelector} [data-formula]`)).toHaveAttribute("data-formula", "\\frac{a}{b}");
});
