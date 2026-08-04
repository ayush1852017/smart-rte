import { expect, test, type Locator, type Page } from "@playwright/test";

const editorSelector = '.srte-editor [contenteditable="true"]';

const insertDefaultTable = async (page: Page) => {
  await page.getByTitle("Insert", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Insert table" }).click();
  const insertButton = page.getByRole("button", { name: "Insert", exact: true });
  await expect(insertButton).toBeVisible();
  await insertButton.click();
  const table = page.locator(`${editorSelector} table`);
  await expect(table).toHaveCount(1);
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(table.locator("tr").first().locator("td,th")).toHaveCount(3);
  return table;
};

const setCellText = async (cell: Locator, text: string) => {
  await cell.evaluate((element, nextText) => {
    element.textContent = nextText;
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
    }));
  }, text);
};

const selectCellRange = async (page: Page, start: Locator, end: Locator) => {
  const startBox = await start.boundingBox();
  const endBox = await end.boundingBox();
  if (!startBox || !endBox) throw new Error("Table cells must be visible before selecting them.");
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 4 });
  await page.mouse.up();
};

const openCellMenu = async (cell: Locator) => {
  await cell.click({ button: "right" });
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(editorSelector)).toBeVisible();
});

test("inserts a table through the real toolbar", async ({ page }) => {
  const table = await insertDefaultTable(page);
  await expect(table.locator("td,th")).toHaveCount(9);
});

test("merges and splits a selected cell range without losing content", async ({ page }) => {
  const table = await insertDefaultTable(page);
  const first = table.locator("tr").first().locator("td,th").nth(0);
  const second = table.locator("tr").first().locator("td,th").nth(1);
  await setCellText(first, "Alpha");
  await setCellText(second, "Beta");
  await selectCellRange(page, first, second);
  await openCellMenu(first);
  await page.getByRole("button", { name: "Merge cells" }).click();

  const merged = table.locator("tr").first().locator("td,th").first();
  await expect(table.locator("tr").first().locator("td,th")).toHaveCount(2);
  await expect(merged).toHaveAttribute("colspan", "2");
  await expect(merged).toContainText("Alpha");
  await expect(merged).toContainText("Beta");

  await openCellMenu(merged);
  await page.getByRole("button", { name: "Split cell" }).click();
  await expect(table.locator("tr").first().locator("td,th")).toHaveCount(3);
  await expect(table.locator("tr").first().locator("td,th").first()).not.toHaveAttribute("colspan", "2");
  await expect(table).toContainText("Alpha");
  await expect(table).toContainText("Beta");
});

test("undoes and redoes a cell merge as one history step", async ({ page }) => {
  const table = await insertDefaultTable(page);
  const first = table.locator("tr").first().locator("td,th").nth(0);
  const second = table.locator("tr").first().locator("td,th").nth(1);
  await selectCellRange(page, first, second);
  await openCellMenu(first);
  await page.getByRole("button", { name: "Merge cells" }).click();
  await expect(table.locator("tr").first().locator("td,th")).toHaveCount(2);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(table.locator("tr").first().locator("td,th")).toHaveCount(3);

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(table.locator("tr").first().locator("td,th")).toHaveCount(2);
  await expect(table.locator("tr").first().locator("td,th").first()).toHaveAttribute("colspan", "2");
});

test("routes row and column changes through the canonical table commands", async ({ page }) => {
  const table = await insertDefaultTable(page);
  const first = table.locator("td,th").first();
  await openCellMenu(first);
  await page.getByRole("button", { name: "Row below" }).click();
  await expect(table.locator("tr")).toHaveCount(4);
  await openCellMenu(table.locator("td,th").first());
  await page.getByRole("button", { name: "Column right" }).click();
  await expect(table.locator("tr").first().locator("td,th")).toHaveCount(4);
  await openCellMenu(table.locator("td,th").first());
  await page.getByRole("button", { name: "Delete row" }).click();
  await expect(table.locator("tr")).toHaveCount(3);
});

test("snaps cell selection to spans and keeps the overlay out of editor content", async ({ page }) => {
  const table = await insertDefaultTable(page);
  const first = table.locator("tr").first().locator("td,th").nth(0);
  const second = table.locator("tr").first().locator("td,th").nth(1);
  await selectCellRange(page, first, second);
  await openCellMenu(first);
  await page.getByRole("button", { name: "Merge cells" }).click();
  const merged = table.locator("tr").first().locator("td,th").first();
  const below = table.locator("tr").nth(1).locator("td,th").first();
  await selectCellRange(page, merged, below);
  await expect(page.locator('[data-smart-ui="table-cell-selection"]')).toHaveCount(1);
  await expect(page.locator(`${editorSelector} [data-smart-ui="table-cell-selection"]`)).toHaveCount(0);
});

test("expands a rectangular cell selection with Shift+Arrow", async ({ page }) => {
  const table = await insertDefaultTable(page);
  const first = table.locator("tr").first().locator("td,th").first();
  await first.evaluate((cell) => {
    const range = document.createRange(); range.selectNodeContents(cell); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    (cell.closest('[contenteditable="true"]') as HTMLElement | null)?.focus();
  });
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator('[data-smart-ui="table-cell-selection"]')).toHaveAttribute("aria-label", "2 table cells selected");
});

test("gives table navigation Tab precedence and appends a row at the final cell", async ({ page }) => {
  const table = await insertDefaultTable(page);
  const finalCell = table.locator("tr").last().locator("td,th").last();
  await finalCell.evaluate((cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    (cell.closest('[contenteditable="true"]') as HTMLElement | null)?.focus();
  });
  await page.keyboard.press("Tab");
  await expect(table.locator("tr")).toHaveCount(4);
});

test("renders leading headers with scope and body associations", async ({ page }) => {
  const table = await insertDefaultTable(page);
  await openCellMenu(table.locator("td,th").first());
  await page.getByRole("button", { name: "Make this row header" }).click();
  await expect(table.locator("th")).toHaveCount(3);
  await expect(table.locator("th").first()).toHaveAttribute("scope", "col");
  await expect(table.locator("tr").nth(1).locator("td").first()).toHaveAttribute("headers", /smart-header-/);
});
