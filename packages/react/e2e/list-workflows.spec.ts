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
    editor.dispatchEvent(new Event("select", { bubbles: true }));
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  }, { startText, startOffset, endText, endOffset });
};

const chooseListStyle = async (page: Page, style: string) => {
  await page.locator('select[aria-label="Numbered list styles"]').evaluate((select, value) => {
    const element = select as HTMLSelectElement;
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, style);
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(editorSelector)).toBeVisible();
});

test("changes a selected bullet list to an alphabetic ordered list", async ({ page }) => {
  await setEditorHtml(page, `
    <ul>
      <li>Rubella</li>
      <li>Cytomegalovirus</li>
      <li>Toxoplasmosis</li>
      <li>Varicella</li>
    </ul>
  `);
  await selectTextRange(page, "Rubella", 0, "Varicella", "Varicella".length);
  await page.locator('select[aria-label="Numbered list styles"]').selectOption("ordered:upper-alpha");

  const editor = page.locator(editorSelector);
  await expect(editor.locator(":scope > ul")).toHaveCount(0);
  await expect(editor.locator(":scope > ol")).toHaveCount(1);
  await expect(editor.locator(":scope > ol")).toHaveCSS("list-style-type", "upper-alpha");
  await expect(editor.locator(":scope > ol > li")).toHaveCount(4);
});

test("overrides imported per-item marker styles when changing list type", async ({ page }) => {
  await setEditorHtml(page, `
    <ul>
      <li style="list-style-type: disc">Rubella</li>
      <li style="list-style-type: disc">Cytomegalovirus</li>
      <li style="list-style-type: disc">Toxoplasmosis</li>
      <li style="list-style-type: disc">Varicella</li>
    </ul>
  `);
  await selectTextRange(page, "Rubella", 0, "Varicella", "Varicella".length);
  await page.locator('select[aria-label="Numbered list styles"]').selectOption("ordered:upper-alpha");

  const items = page.locator(`${editorSelector} > ol > li`);
  await expect(items).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await expect(items.nth(index)).toHaveCSS("list-style-type", "upper-alpha");
  }
});

test("changes a mouse-selected bullet list to an alphabetic ordered list", async ({ page }) => {
  await setEditorHtml(page, `
    <ul>
      <li>Rubella</li>
      <li>Cytomegalovirus</li>
      <li>Toxoplasmosis</li>
      <li>Varicella</li>
    </ul>
  `);
  const items = page.locator(`${editorSelector} > ul > li`);
  const first = await items.first().boundingBox();
  const last = await items.last().boundingBox();
  if (!first || !last) throw new Error("List items are not visible.");
  await page.mouse.move(first.x + 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 2, last.y + last.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || ""))
    .toContain("Toxoplasmosis");

  await page.locator('select[aria-label="Numbered list styles"]').selectOption("ordered:upper-alpha");

  const editor = page.locator(editorSelector);
  await expect(editor.locator(":scope > ul")).toHaveCount(0);
  await expect(editor.locator(":scope > ol")).toHaveCSS("list-style-type", "upper-alpha");
  await expect(editor.locator(":scope > ol > li")).toHaveCount(4);
});

test("changes the common list hierarchy when selection crosses nested and outer items", async ({ page }) => {
  await setEditorHtml(page, `
    <ul>
      <li>Congenital Toxoplasmosis – Classic Triad:
        <ul>
          <li>Chorioretinitis</li>
          <li>Hydrocephalus</li>
          <li>Intracranial calcifications</li>
        </ul>
      </li>
      <li>No Patent Ductus Arteriosus</li>
      <li>No Salt &amp; Pepper Retinopathy</li>
    </ul>
  `);
  await selectTextRange(
    page,
    "Intracranial calcifications",
    0,
    "No Salt & Pepper Retinopathy",
    "No Salt & Pepper Retinopathy".length,
  );
  await page.locator('select[aria-label="Numbered list styles"]').selectOption("ordered:upper-alpha");

  const editor = page.locator(editorSelector);
  const outer = editor.locator(":scope > ol");
  await expect(outer).toHaveCSS("list-style-type", "upper-alpha");
  await expect(outer.locator(":scope > li")).toHaveCount(3);
  const nested = outer.locator(":scope > li:first-child > ol");
  await expect(nested).toHaveCSS("list-style-type", "lower-alpha");
  await expect(nested.locator(":scope > li")).toHaveCount(3);
});

test("applies a depth-aware preset to a selected list hierarchy", async ({ page }) => {
  await setEditorHtml(page, `
    <ul>
      <li>Parent<ul><li>Child</li><li>Child two</li></ul></li>
      <li>Sibling</li>
    </ul>
  `);
  await selectTextRange(page, "Parent", 0, "Sibling", "Sibling".length);
  await chooseListStyle(page, "ordered-preset:ordered-decimal-paren");

  const editor = page.locator(editorSelector);
  const outer = editor.locator(":scope > ol");
  const nested = outer.locator(":scope > li:first-child > ol");
  await expect(outer).toHaveAttribute("data-srte-list-preset", "ordered-decimal-paren");
  await expect(outer).toHaveAttribute("data-srte-list-depth", "0");
  await expect(outer).toHaveCSS("list-style-type", "decimal");
  await expect(nested).toHaveAttribute("data-srte-list-preset", "ordered-decimal-paren");
  await expect(nested).toHaveAttribute("data-srte-list-depth", "1");
  await expect(nested).toHaveCSS("list-style-type", "lower-alpha");
  await expect.poll(() => outer.locator(":scope > li").first().evaluate((item) =>
    getComputedStyle(item, "::marker").content
  )).toContain(")");
});

test("removes an existing ordered list without losing its items", async ({ page }) => {
  await setEditorHtml(page, `
    <ol type="A">
      <li>Rubella</li>
      <li>Cytomegalovirus (CMV)</li>
      <li>Toxoplasmosis</li>
      <li>Varicella</li>
    </ol>
  `);
  await selectTextRange(page, "Rubella", 0, "Varicella", "Varicella".length);
  await page.getByTitle("Numbered list", { exact: true }).click();

  const editor = page.locator(editorSelector);
  await expect(editor.locator("ol")).toHaveCount(0);
  await expect(editor.locator("li")).toHaveCount(0);
  await expect(editor).toContainText("Rubella");
  await expect(editor).toContainText("Cytomegalovirus (CMV)");
  await expect(editor).toContainText("Toxoplasmosis");
  await expect(editor).toContainText("Varicella");
});

test("converts a partially selected nested list as a complete subtree", async ({ page }) => {
  await setEditorHtml(page, `
    <p><strong>Toxoplasma (Option C):</strong></p>
    <ul>
      <li><strong>Congenital Toxoplasmosis – Classic Triad:</strong>
        <ul>
          <li><strong>Chorioretinitis:</strong> Typically severe</li>
          <li><strong>Hydrocephalus</strong></li>
          <li><strong>Intracranial calcifications:</strong> Diffuse</li>
        </ul>
      </li>
      <li>No Patent Ductus Arteriosus</li>
      <li>No Salt &amp; Pepper Retinopathy</li>
    </ul>
    <p><strong>Varicella (Option D):</strong></p>
  `);
  await selectTextRange(
    page,
    "Congenital Toxoplasmosis – Classic Triad:",
    0,
    "Hydrocephalus",
    "Hydrocephalus".length,
  );
  await chooseListStyle(page, "ordered:lower-alpha");

  const editor = page.locator(editorSelector);
  await expect(editor.locator(":scope > p").first()).toContainText("Toxoplasma (Option C):");
  await expect(editor.locator(":scope > ol")).toHaveCount(1);
  await expect(editor.locator(":scope > ol")).toHaveCSS("list-style-type", "lower-alpha");
  await expect(editor.locator(":scope > ol > li")).toHaveCount(3);
  await expect(editor.locator(":scope > ol > li").first().locator("ol")).toHaveCount(1);
  await expect(editor.locator(":scope > ol > li").first().locator("ol")).toHaveCSS(
    "list-style-type",
    "lower-alpha",
  );
  await expect(editor.locator(":scope > ol > li").first().locator("ol > li")).toHaveCount(3);
  await expect(editor).toContainText("Intracranial calcifications: Diffuse");
  await expect(editor).toContainText("No Patent Ductus Arteriosus");
  await expect(editor).toContainText("No Salt & Pepper Retinopathy");
  await expect(editor).toContainText("Varicella (Option D):");
});

test("undoes and redoes a nested list conversion as one history step", async ({ page }) => {
  await setEditorHtml(page, `
    <ul>
      <li>Parent<ul><li>Child one</li><li>Child two</li></ul></li>
      <li>Sibling</li>
    </ul>
  `);
  await selectTextRange(page, "Parent", 0, "Child one", "Child one".length);
  await chooseListStyle(page, "ordered:decimal");
  const editor = page.locator(editorSelector);
  await expect(editor.locator(":scope > ol")).toHaveCount(1);
  await expect(editor.locator("ol li")).toHaveCount(4);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(editor.locator(":scope > ul")).toHaveCount(1);
  await expect(editor.locator("ul li")).toHaveCount(4);

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(editor.locator(":scope > ol")).toHaveCount(1);
  await expect(editor.locator("ol li")).toHaveCount(4);
});

test("moves a list item up and down through the canonical product route", async ({ page }) => {
  await setEditorHtml(page, "<ul><li>one</li><li>two<ul><li>child</li></ul></li><li>three</li></ul>");
  await selectTextRange(page, "two", 0, "two", "two".length);
  await page.locator('summary[aria-label="Move and indent"]').click();
  await page.getByTitle("Move selected block up").click();

  const items = page.locator(`${editorSelector} > ul > li`);
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("twochild");
  await expect(items.nth(0).locator(":scope > ul > li")).toHaveText("child");

  await selectTextRange(page, "two", 0, "two", "two".length);
  await page.locator('summary[aria-label="Move and indent"]').click();
  await page.getByTitle("Move selected block down").click();
  await expect(items.nth(0)).toHaveText("one");
  await expect(items.nth(1)).toContainText("twochild");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(items.nth(0)).toContainText("twochild");
});

test("converts a heading plus a partial nested selection without dropping descendants", async ({ page }) => {
  await setEditorHtml(page, `
    <p>Toxoplasma (Option C):</p>
    <ul>
      <li>Congenital Toxoplasmosis – Classic Triad:
        <ul>
          <li>Chorioretinitis: Typically severe; not salt &amp; pepper pattern</li>
          <li>Hydrocephalus</li>
          <li>Intracranial calcifications: Diffuse, often involving basal ganglia</li>
        </ul>
      </li>
      <li>No Patent Ductus Arteriosus (PDA): PDA is not a feature of congenital toxoplasmosis</li>
      <li>No Salt &amp; Pepper Retinopathy: Ocular involvement is present but differs in appearance</li>
    </ul>
  `);
  await selectTextRange(page, "Toxoplasma (Option C):", 0, "Hydrocephalus", "Hydrocephalus".length);
  await chooseListStyle(page, "ordered:upper-alpha");

  const editor = page.locator(editorSelector);
  await expect(editor.locator(":scope > ol")).toHaveCount(1);
  await expect(editor.locator(":scope > ol > li")).toHaveCount(4);
  await expect(editor.locator(":scope > ol > li").first()).toContainText("Toxoplasma (Option C):");
  await expect(editor.locator(":scope > ol > li:nth-child(2)")).toContainText("Congenital Toxoplasmosis");
  await expect(editor.locator(":scope > ol > li:nth-child(2) > ol > li")).toHaveCount(3);
  await expect(editor).toContainText("No Patent Ductus Arteriosus");
  await expect(editor).toContainText("No Salt & Pepper Retinopathy");
});

test("main numbered-list button preserves a heading and nested descendants", async ({ page }) => {
  await setEditorHtml(page, `
    <p>Toxoplasma (Option C):</p>
    <ul>
      <li>Congenital Toxoplasmosis – Classic Triad:
        <ul><li>Chorioretinitis</li><li>Hydrocephalus</li><li>Intracranial calcifications</li></ul>
      </li>
      <li>No Patent Ductus Arteriosus (PDA)</li>
      <li>No Salt &amp; Pepper Retinopathy</li>
    </ul>
  `);
  await selectTextRange(page, "Toxoplasma (Option C):", 0, "Hydrocephalus", "Hydrocephalus".length);
  await page.getByTitle("Numbered list", { exact: true }).click();

  const editor = page.locator(editorSelector);
  await expect(editor.locator(":scope > ol")).toHaveCount(1);
  await expect(editor.locator(":scope > ol > li")).toHaveCount(4);
  await expect(editor.locator(":scope > ol > li:first-child")).toContainText("Toxoplasma (Option C):");
  await expect(editor.locator(":scope > ol > li:nth-child(2) > ol > li")).toHaveCount(3);
  await expect(editor).toContainText("No Patent Ductus Arteriosus");
});
