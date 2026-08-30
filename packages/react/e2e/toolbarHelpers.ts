import type { Page } from "@playwright/test";

/**
 * Opens a toolbar dropdown by its trigger label (the Direction B redesign's
 * long-tail tools live inside `<details class="srte-toolbar-menu">`, whose
 * `<summary>` carries Chromium's native "DisclosureTriangle" accessibility
 * role, not "button" - `getByRole("button", ...)` never matches it). Once
 * open, the dropdown's tools are `role="menuitem"` buttons, not `role="button"`.
 * No-ops if already open, so tests can call this defensively.
 */
export const openToolbarDropdown = async (page: Page, triggerLabel: string) => {
  const details = page.locator("details.srte-toolbar-menu", { has: page.locator("summary", { hasText: triggerLabel }) }).first();
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
};

export const toolbarMenuItem = (page: Page, label: string) => page.getByRole("menuitem", { name: label, exact: true });

/**
 * "Insert table" now opens a size picker (grid + custom rows/columns)
 * instead of inserting a fixed 2x2 immediately - this reproduces the old
 * default behavior for every test that only needs *a* table as setup, by
 * clicking through the grid's 2x2 cell.
 */
export const insertDefaultTable = async (page: Page) => {
  await page.getByRole("button", { name: "Insert table", exact: true }).click();
  await page.locator('[data-srte-table-size-cell="2x2"]').click();
};

/** Opens the size picker and clicks a specific `rows`x`columns` grid cell. */
export const insertTableSized = async (page: Page, rows: number, columns: number) => {
  await page.getByRole("button", { name: "Insert table", exact: true }).click();
  await page.locator(`[data-srte-table-size-cell="${rows}x${columns}"]`).click();
};
