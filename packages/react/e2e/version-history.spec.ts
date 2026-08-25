import { expect, test } from "@playwright/test";

const placeCaretAtEnd = async (page: import("@playwright/test").Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) text = node as Text;
  const range = document.createRange();
  if (text) range.setStart(text, text.data.length); else range.selectNodeContents(root);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
});

test.describe("Phase 12a - version history", () => {
  test("saves versions, restores an earlier one non-destructively, keeps editing working, and shows a diff summary between two versions", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();

    // Save the first version of the seeded content.
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    const panel = page.locator('[data-srte-version-history="true"]');
    await expect(panel).toBeVisible();
    await panel.locator('input[placeholder="Label this version (optional)"]').fill("Original");
    await panel.getByRole("button", { name: "Save version", exact: true }).click();
    await expect(panel.locator("text=Original")).toBeVisible();
    await panel.getByRole("button", { name: "Close version history" }).click();

    // Edit the document, then save a second version.
    await placeCaretAtEnd(page);
    await page.keyboard.type(" - edited");
    await expect(editor).toContainText("edited");

    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await expect(panel).toBeVisible();
    await panel.locator('input[placeholder="Label this version (optional)"]').fill("After edit");
    await panel.getByRole("button", { name: "Save version", exact: true }).click();
    await expect(panel.locator("text=After edit")).toBeVisible();

    // Compare the two saved versions - a real content difference must be summarized.
    const checkboxes = panel.locator('input[type="checkbox"]');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    const summary = panel.locator('[data-srte-version-diff-summary="true"]');
    await expect(summary).not.toHaveText("Comparing…");
    await expect(summary).toContainText("edited");
    await checkboxes.nth(0).uncheck();
    await checkboxes.nth(1).uncheck();

    // Restore the original version - non-destructive: both prior entries
    // must still be present afterward, plus a new one recording the
    // restoration itself. Nothing is ever deleted or rewritten.
    const originalEntry = panel.locator("[data-srte-version-entry]").filter({ hasText: "Original" });
    await originalEntry.getByRole("button", { name: "Restore" }).click();
    await expect(panel.getByText("Restored: Original", { exact: true })).toBeVisible();
    await expect(panel.getByText("Original", { exact: true })).toBeVisible();
    await expect(panel.getByText("After edit", { exact: true })).toBeVisible();
    await expect(panel.locator("[data-srte-version-entry]")).toHaveCount(3);
    await panel.getByRole("button", { name: "Close version history" }).click();

    await expect(editor).not.toContainText("edited");

    // A normal edit after restore must still work - the revision re-stamp
    // must not have wedged the transaction pipeline.
    await placeCaretAtEnd(page);
    await page.keyboard.type(" - edited again");
    await expect(editor).toContainText("edited again");
  });

  test("deleting a saved version removes it from the list", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    const panel = page.locator('[data-srte-version-history="true"]');
    await panel.locator('input[placeholder="Label this version (optional)"]').fill("Throwaway");
    await panel.getByRole("button", { name: "Save version", exact: true }).click();
    await expect(panel.locator("text=Throwaway")).toBeVisible();

    await panel.getByRole("button", { name: "Delete" }).click();
    await expect(panel.locator("text=Throwaway")).toHaveCount(0);
  });
});
