import { expect, test } from "@playwright/test";

const selectFirstWordOfSecondParagraph = async (page: import("@playwright/test").Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const paragraphs = root.querySelectorAll("p");
  const text = paragraphs[1].firstChild as Text;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 5); // "block" of "block 1"
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
});

const collapseAtStartOfSecondParagraph = async (page: import("@playwright/test").Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const paragraphs = root.querySelectorAll("p");
  const text = paragraphs[1].firstChild as Text;
  const range = document.createRange();
  range.setStart(text, 0);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
});

test.describe("Phase 12a - comments", () => {
  test("comments on a real cross-block Backspace merge - the thread survives, snapped to the surviving paragraph, not lost", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=2");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();
    await expect(editor.locator("p")).toHaveCount(2);

    // Select "block" inside the second paragraph and comment on it.
    await selectFirstWordOfSecondParagraph(page);
    const addComment = page.getByRole("button", { name: "Add comment", exact: true });
    await expect(addComment).toBeEnabled();
    await addComment.click();

    const panel = page.locator('[data-srte-comment-panel="true"]');
    await expect(panel).toBeVisible();
    const compose = panel.locator('[data-srte-comment-compose="true"] textarea');
    await compose.fill("Please clarify this");
    await panel.locator('[data-srte-comment-compose-submit="true"]').click();
    await expect(panel.getByText("Please clarify this", { exact: true })).toBeVisible();

    // A live marker (highlight + badge) renders over the commented text.
    await expect(page.locator("[data-srte-comment-highlight]").first()).toBeVisible();
    await expect(page.locator("[data-srte-comment-badge]").first()).toBeVisible();

    // Reply to the thread from the panel.
    const threadRow = panel.locator("[data-srte-comment-thread]").first();
    await threadRow.locator('input[placeholder="Reply…"]').fill("Will do");
    await threadRow.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(panel.getByText("Will do", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Close comments" }).click();

    // Real, user-driven cross-block merge: Backspace at the very start of
    // the second paragraph merges it into the first via the actual
    // production mergeNode path (input.ts's queueRangeDeletion) - not a
    // hand-constructed operation. The comment was anchored inside the
    // second paragraph, which this retires.
    await collapseAtStartOfSecondParagraph(page);
    await editor.focus();
    await page.keyboard.press("Backspace");
    await expect(editor.locator("p")).toHaveCount(1);
    await expect(editor).toContainText("block 1");

    // The thread must survive the merge - snapped to the surviving
    // paragraph (Phase 12a's default merge-orphan policy), not dropped.
    await expect(page.locator("[data-srte-comment-badge]").first()).toBeVisible();
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Please clarify this", { exact: true })).toBeVisible();
    await expect(panel.getByText("Will do", { exact: true })).toBeVisible();

    // Resolve, then reopen, then delete - the full lifecycle.
    await threadRow.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(threadRow).toHaveCount(0);
    await panel.getByLabel("Show resolved").check();
    const resolvedRow = panel.locator("[data-srte-comment-thread]").first();
    await resolvedRow.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Resolve", exact: true })).toBeVisible();

    await panel.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(panel.locator("[data-srte-comment-thread]")).toHaveCount(0);
    await expect(page.locator("[data-srte-comment-badge]")).toHaveCount(0);
  });

  test("'Add comment' is disabled without a real text selection", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.click();
    await expect(page.getByRole("button", { name: "Add comment", exact: true })).toBeDisabled();
  });
});
