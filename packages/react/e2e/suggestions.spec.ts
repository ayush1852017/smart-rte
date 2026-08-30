import { expect, test } from "@playwright/test";
import { openToolbarDropdown, toolbarMenuItem } from "./toolbarHelpers.js";

const selectWord = async (page: import("@playwright/test").Page, paragraphIndex: number, from: number, to: number) => page.evaluate(({ paragraphIndex, from, to }) => {
  const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const text = root.querySelectorAll("p")[paragraphIndex].firstChild as Text;
  const range = document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}, { paragraphIndex, from, to });

const collapseAt = async (page: import("@playwright/test").Page, paragraphIndex: number, offset: number) => page.evaluate(({ paragraphIndex, offset }) => {
  const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const text = root.querySelectorAll("p")[paragraphIndex].firstChild as Text;
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}, { paragraphIndex, offset });

test.describe("Phase 12a - suggestions (track changes)", () => {
  test("suggest deletion: marks text struck-through without removing it, then accept actually removes it", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();

    await selectWord(page, 0, 0, 9); // "Canonical" of "Canonical product editor"
    await openToolbarDropdown(page, "Review");
    const suggestDelete = toolbarMenuItem(page, "Suggest deletion");
    await expect(suggestDelete).toBeEnabled();
    await suggestDelete.click();

    const struck = editor.locator('[data-smart-mark="suggestion"][data-suggestion-kind="delete"]');
    await expect(struck).toHaveText("Canonical");
    await expect(editor).toContainText("Canonical product editor"); // still present, not deleted

    await openToolbarDropdown(page, "Review");
    await toolbarMenuItem(page, "Suggestions").click();
    const panel = page.locator('[data-srte-suggestion-panel="true"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('"Canonical"', { exact: true })).toBeVisible();

    await panel.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(editor).not.toContainText("Canonical product editor");
    await expect(editor).toContainText("product editor");
  });

  test("suggest insertion: composes proposed text at the caret, underlined until accepted, and reject removes it", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();

    await collapseAt(page, 0, 0);
    await openToolbarDropdown(page, "Review");
    await toolbarMenuItem(page, "Suggest insertion").click();
    const panel = page.locator('[data-srte-suggestion-panel="true"]');
    await expect(panel).toBeVisible();
    const compose = panel.locator('[data-srte-suggestion-compose="true"] textarea');
    await compose.fill("PREFIX-");
    await panel.locator('[data-srte-suggestion-compose-submit="true"]').click();

    const underlined = editor.locator('[data-smart-mark="suggestion"][data-suggestion-kind="insert"]');
    await expect(underlined).toHaveText("PREFIX-");
    await expect(editor).toContainText("PREFIX-Canonical product editor");

    await expect(panel.getByText('"PREFIX-"', { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(editor).not.toContainText("PREFIX-");
    await expect(editor).toContainText("Canonical product editor");
  });

  test("suggest block removal survives a real cross-block Backspace merge, then accepting removes the merged block", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=2");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();
    await expect(editor.locator("p")).toHaveCount(2);

    // Propose removing the second paragraph ("block 1").
    await collapseAt(page, 1, 0);
    await openToolbarDropdown(page, "Review");
    await toolbarMenuItem(page, "Suggest removing this").click();
    await expect(page.locator("[data-srte-suggestion-highlight]").first()).toBeVisible();
    const panel = page.locator('[data-srte-suggestion-panel="true"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText("suggests removing this block", { exact: false })).toBeVisible();
    await panel.getByRole("button", { name: "Close suggestions" }).click();

    // Real, user-driven cross-block merge: Backspace at the very start of
    // the second paragraph merges it into the first (deleteAcrossBlock),
    // retiring the exact node id the suggestion is anchored to.
    await collapseAt(page, 1, 0);
    await editor.focus();
    await page.keyboard.press("Backspace");
    await expect(editor.locator("p")).toHaveCount(1);
    await expect(editor).toContainText("block 1");

    // The suggestion must survive the merge, snapped to the surviving paragraph.
    await expect(page.locator("[data-srte-suggestion-highlight]").first()).toBeVisible();
    await openToolbarDropdown(page, "Review");
    await toolbarMenuItem(page, "Suggestions").click();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Accept", exact: true }).click();

    // The suggestion is now anchored to the (merged) survivor as a whole
    // node - accepting it removes the entire merged paragraph (the
    // document's own normalization then guarantees a minimum one empty
    // paragraph exists, rather than leaving a literally empty document).
    await expect(editor).not.toContainText("block 1");
    await expect(editor.locator("p")).toHaveText("");
  });

  test("ambient track-changes mode: normal typing and Backspace become live suggestions while enabled, and stop when disabled", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();

    await openToolbarDropdown(page, "Review");
    const toggle = toolbarMenuItem(page, "Show edits");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await openToolbarDropdown(page, "Review");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Ordinary typing at the end of the line - no explicit "Suggest
    // insertion" action - becomes live insert-suggestion marks. Real
    // per-keystroke typing (unlike a single bulk insertText) produces one
    // mark per keystroke rather than one merged span per burst - a real,
    // minor rough edge (adjacent same-author marks aren't coalesced into
    // one reviewable suggestion) named here rather than silently assumed away.
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
      const text = root.querySelector("p")!.firstChild as Text;
      const range = document.createRange();
      range.setStart(text, text.data.length);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await editor.focus();
    await page.keyboard.type(" more");
    const inserted = editor.locator('[data-smart-mark="suggestion"][data-suggestion-kind="insert"]');
    await expect(inserted).toHaveCount(5); // one mark per keystroke: " ", "m", "o", "r", "e"
    await expect(editor).toContainText("Canonical product editor more");

    // Ordinary Backspace - no explicit "Suggest deletion" action - marks
    // the character struck-through instead of removing it.
    await page.keyboard.press("Backspace");
    const deleted = editor.locator('[data-smart-mark="suggestion"][data-suggestion-kind="delete"]');
    await expect(deleted).toHaveText("e");
    await expect(editor).toContainText("Canonical product editor more"); // "e" still present, struck-through

    // Disabling the mode returns to ordinary direct editing: a fresh
    // keystroke is a real, unmarked edit - no new suggestion mark appears.
    await openToolbarDropdown(page, "Review");
    await toggle.click();
    await openToolbarDropdown(page, "Review");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    const markCountBeforeDisabling = await editor.locator('[data-smart-mark="suggestion"]').count();
    await page.keyboard.type("!");
    await expect(editor.locator('[data-smart-mark="suggestion"]')).toHaveCount(markCountBeforeDisabling);
    await expect(editor).toContainText("!");
  });

  test("ambient track-changes mode: the Track changes toggle documents its two excluded cases", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    // Item 1 (2026-08-25 follow-up): decided against forcing ambient
    // interception to cover cross-paragraph replace / cross-block merge -
    // both require representing a proposed paragraph *merge*, a
    // materially different suggestion shape (structural, not inline-mark-
    // based) this phase doesn't build; a passive tooltip on the toggle
    // documents the real scope instead of silently letting a user believe
    // every edit is tracked.
    await openToolbarDropdown(page, "Review");
    const toggle = toolbarMenuItem(page, "Show edits");
    await expect(toggle).toHaveAttribute("title", /Merging paragraphs together.*still applies directly/);
  });

  test("ambient track-changes mode: typing over a selection spanning two paragraphs still merges them directly, not as a suggestion", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=2");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();
    await expect(editor.locator("p")).toHaveCount(2);

    await openToolbarDropdown(page, "Review");
    await toolbarMenuItem(page, "Show edits").click();
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
      const paragraphs = root.querySelectorAll("p");
      const range = document.createRange();
      range.setStart(paragraphs[0].firstChild as Text, 0);
      range.setEnd(paragraphs[1].firstChild as Text, (paragraphs[1].firstChild as Text).data.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await editor.focus();
    await page.keyboard.type("X");

    await expect(editor.locator("p")).toHaveCount(1);
    await expect(editor.locator('[data-smart-mark="suggestion"]')).toHaveCount(0);
    await expect(editor).toContainText("X");
  });

  test("ambient track-changes mode: Backspace at a paragraph boundary still merges directly (deleteAcrossBlock), not as a suggestion", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=2");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();
    await expect(editor.locator("p")).toHaveCount(2);

    await openToolbarDropdown(page, "Review");
    await toolbarMenuItem(page, "Show edits").click();
    await collapseAt(page, 1, 0);
    await editor.focus();
    await page.keyboard.press("Backspace");

    await expect(editor.locator("p")).toHaveCount(1);
    await expect(editor).toContainText("block 1");
    await expect(editor.locator('[data-smart-mark="suggestion"]')).toHaveCount(0);
  });
});
