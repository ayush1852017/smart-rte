import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Phase 8a canonical clipboard", () => {
  test("paste, copy, cut, drop and undo share the canonical path", async ({ page }) => {
    await page.goto("/?canonical=1");
    const result = await page.evaluate(() => {
      const runtime = window.__smartCanonical!;
      const root = document.querySelector<HTMLElement>('[aria-label="Canonical Smart RTE editing surface"]')!;
      const selection = { type: "text" as const, anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 5 } };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, runtime.editor.selection);

      const pasteData = new DataTransfer();
      pasteData.setData("text/plain", "pasted");
      let pastePrevented = false;
      runtime.pipeline.handlePaste({ clipboardData: pasteData, preventDefault: () => { pastePrevented = true; } } as ClipboardEvent);
      const pasted = JSON.stringify(runtime.editor.document).includes("pasted");
      const pasteHistory = runtime.editor.history.undo.length;
      runtime.editor.undo();
      const undoRestored = JSON.stringify(runtime.editor.document).includes("start");

      runtime.editor.setSelection(selection, { source: "api" });
      const copyData = new DataTransfer();
      runtime.pipeline.handleCopy({ clipboardData: copyData, preventDefault: () => undefined } as ClipboardEvent);
      const copyTypes = [...copyData.types];
      const cleanHtml = copyData.getData("text/html");

      const cutData = new DataTransfer();
      let cutPrevented = false;
      runtime.pipeline.handleCut({ clipboardData: cutData, preventDefault: () => { cutPrevented = true; } } as ClipboardEvent);
      const cutHistory = runtime.editor.history.undo.length;

      const dropData = new DataTransfer();
      dropData.setData("text/plain", "dropped");
      let dropPrevented = false;
      runtime.pipeline.handleDrop({ dataTransfer: dropData, clientX: 1, clientY: 1, preventDefault: () => { dropPrevented = true; } } as DragEvent);
      const dropped = JSON.stringify(runtime.editor.document).includes("dropped");
      return {
        pastePrevented, pasted, pasteHistory, undoRestored,
        copyTypes, cleanHtml, cutPrevented, cutHistory,
        dropPrevented, dropped,
      };
    });
    expect(result).toMatchObject({
      pastePrevented: true, pasted: true, pasteHistory: 1, undoRestored: true,
      cutPrevented: true, cutHistory: 1, dropPrevented: true, dropped: true,
    });
    expect(result.copyTypes.sort()).toEqual(["application/x-smart-rte+json", "text/html", "text/plain"].sort());
    expect(result.cleanHtml).not.toMatch(/data-smart-id|data-smart-ui/);
  });

  test("internal block drag moves rather than copies", async ({ page }) => {
    await page.goto("/?canonical=1");
    const result = await page.evaluate(() => {
      const runtime = window.__smartCanonical!;
      runtime.editor.setSelection({ type: "node", anchor: { path: [], offset: 0 }, head: { path: [], offset: 1 } }, { source: "api" });
      const transfer = new DataTransfer();
      (runtime.pipeline as unknown as { handleDragStart(event: DragEvent): void }).handleDragStart(
        { dataTransfer: transfer } as DragEvent,
      );
      runtime.editor.setSelection({ type: "text", anchor: { path: [1], offset: 7 }, head: { path: [1], offset: 7 } }, { source: "api" });
      runtime.pipeline.handleDrop({ dataTransfer: transfer, clientX: -100, clientY: -100, preventDefault: () => undefined } as DragEvent);
      return runtime.editor.document.children.map((node) => node.type === "text" ? node.text
        : (node.children || []).map((child) => child.type === "text" ? child.text : "").join(""));
    });
    expect(result).toEqual(["block 1", "start", "block 2"]);
  });

  /**
   * Phase 11 Tier 3: axe-core coverage expansion - clipboard-workflows.spec.ts
   * had zero axe scans before this pass. Pastes real HTML (headings, a
   * list, marks) through the canonical paste path and scans the result.
   */
  test("has no axe violations after pasting a mixed-feature HTML fragment", async ({ page }) => {
    await page.goto("/?canonical=1");
    const surface = '[aria-label="Canonical Smart RTE editing surface"]';
    await page.evaluate((selector) => {
      const runtime = window.__smartCanonical!;
      const root = document.querySelector<HTMLElement>(selector)!;
      runtime.editor.setSelection({ type: "text", anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 0 } }, { source: "api" });
      runtime.renderer.render(runtime.editor.document, runtime.editor.selection);
      const transfer = new DataTransfer();
      transfer.setData("text/html", "<h2>Pasted heading</h2><ul><li>one</li><li>two</li></ul><p><strong>bold</strong> text</p>");
      transfer.setData("text/plain", "Pasted heading\none\ntwo\nbold text");
      runtime.pipeline.handlePaste({ clipboardData: transfer, preventDefault: () => undefined } as ClipboardEvent);
      root.focus();
    }, surface);
    await expect(page.locator(surface)).toContainText("Pasted heading");
    const results = await new AxeBuilder({ page }).include(surface).analyze();
    expect(results.violations).toEqual([]);
  });
});
