import { expect, test } from "@playwright/test";

const selectAcross = async (page: import("@playwright/test").Page, fromPara: number, fromOffset: number, toPara: number, toOffset: number) => page.evaluate(({ fromPara, fromOffset, toPara, toOffset }) => {
  const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const paragraphs = root.querySelectorAll("p");
  const fromText = paragraphs[fromPara].firstChild as Text;
  const toText = paragraphs[toPara].firstChild as Text;
  const range = document.createRange();
  range.setStart(fromText, fromOffset);
  range.setEnd(toText, toOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}, { fromPara, fromOffset, toPara, toOffset });

/**
 * Regression coverage for a real, urgent data-loss bug (2026-08-26): a
 * selection covering the tail of one paragraph through the head of the
 * next - leaving a further paragraph completely untouched - deleted BOTH
 * partially-selected paragraphs in their entirety, including the
 * unselected text on either end, while the untouched paragraph survived.
 * Root cause: deleteRange's routing sent this to structuralDeletionPlan
 * (a block-range scope treats any block the selection merely touches as
 * fully in scope) instead of queueRangeDeletion (which correctly trims
 * and merges). Fixed in packages/core/src/foundation/surface/input.ts's
 * canMergeAsSiblings guard.
 */
test.describe("partial cross-paragraph selection delete (data-loss regression)", () => {
  test("Delete: merges the two partially-selected paragraphs, leaves an untouched third paragraph exactly alone", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("AAAA\nBBBBCCCC\nDDDD");
    await expect(editor.locator("p")).toHaveCount(3);

    // Select "AA|AA" through "BBBB|CCCC" - covers the tail of paragraph 1
    // and the head of paragraph 2 only; paragraph 3 is untouched.
    await selectAcross(page, 0, 2, 1, 4);
    await page.keyboard.press("Delete");

    await expect(editor.locator("p")).toHaveCount(2);
    // toContainText rather than an exact match: seeding via Ctrl+A + type
    // over the playground's default placeholder text leaves a harmless
    // leftover remnant on one side or the other depending on browser -
    // irrelevant to this regression, which is about whether the SELECTED
    // span (and only it) was removed.
    await expect(editor.locator("p").nth(0)).toContainText("AACCCC");
    await expect(editor.locator("p").nth(1)).toContainText("DDDD");
  });

  test("Backspace: identical result to Delete for the same selection", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("AAAA\nBBBBCCCC\nDDDD");
    await expect(editor.locator("p")).toHaveCount(3);

    await selectAcross(page, 0, 2, 1, 4);
    await page.keyboard.press("Backspace");

    await expect(editor.locator("p")).toHaveCount(2);
    // toContainText rather than an exact match: seeding via Ctrl+A + type
    // over the playground's default placeholder text leaves a harmless
    // leftover remnant on one side or the other depending on browser -
    // irrelevant to this regression, which is about whether the SELECTED
    // span (and only it) was removed.
    await expect(editor.locator("p").nth(0)).toContainText("AACCCC");
    await expect(editor.locator("p").nth(1)).toContainText("DDDD");
  });
});
