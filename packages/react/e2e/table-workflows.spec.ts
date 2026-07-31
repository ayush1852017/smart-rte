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
