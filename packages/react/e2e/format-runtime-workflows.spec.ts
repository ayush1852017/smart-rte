import { expect, test } from "@playwright/test";

const editorSelector = '.srte-editor [contenteditable="true"]';

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(editorSelector)).toBeVisible();
});

test("exports canonical content through the HTML format runtime", async ({ page }) => {
  await page.locator(editorSelector).evaluate((editor) => {
    editor.innerHTML = "<h2>Export heading</h2><p><strong>Export body</strong></p>";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  });
  await page.locator('summary[title="Export document"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("smart-rte-export.html");
});

test("imports HTML through the format runtime and canonicalizes its structure", async ({ page }) => {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('summary[title="Import document"]').click();
  await page.getByRole("menuitem", { name: /HTML/ }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "fixture.html",
    mimeType: "text/html",
    buffer: Buffer.from("<h2>Imported heading</h2><ul><li>Imported item</li></ul>"),
  });
  const editor = page.locator(editorSelector);
  await expect(editor.locator("h2")).toHaveText("Imported heading");
  await expect(editor.locator("ul > li")).toHaveText("Imported item");
});

test("imports Markdown through the format runtime", async ({ page }) => {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('summary[title="Import document"]').click();
  await page.getByRole("menuitem", { name: /Markdown/ }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "fixture.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("## Imported Markdown\n\n- First item\n- Second item"),
  });
  const editor = page.locator(editorSelector);
  await expect(editor.locator("h2")).toHaveText("Imported Markdown");
  await expect(editor.locator("ul > li")).toHaveCount(2);
});
