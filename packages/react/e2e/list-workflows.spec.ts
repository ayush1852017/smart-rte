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
  await expect(editor.locator(":scope > ol > li")).toHaveCount(2);
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
  await expect(editor.locator(":scope > ol > li")).toHaveCount(2);
  await expect(editor.locator(":scope > ol > li:first-child")).toContainText("Toxoplasma (Option C):");
  await expect(editor.locator(":scope > ol > li:nth-child(2) > ol > li")).toHaveCount(3);
  await expect(editor).toContainText("No Patent Ductus Arteriosus");
});
