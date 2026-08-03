import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const surface = '[data-smart-canonical-surface="true"]';

test.describe("Phase 2.5 canonical editing surface", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?canonical=1&blocks=24");
    await expect(page.locator(surface)).toBeVisible();
    await page.locator('[data-smart-id="canonical-p-0"]').click();
  });

  test("routes typing, replacement, deletion, navigation, paragraph insertion, and history", async ({ page }) => {
    await page.keyboard.type("abc");
    await expect(page.locator('[data-smart-id="canonical-p-0"]')).toHaveText("startabc");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    await expect(page.locator('[data-smart-id="canonical-p-0"]')).toHaveText("startac");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("next");
    await expect(page.locator(surface).locator("p").nth(1)).toHaveText("next");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(page.locator(surface).locator("p").nth(1)).toHaveText("");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
    await expect(page.locator(surface).locator("p").nth(1)).toHaveText("next");
  });

  test("covers replacement, selection overwrite, deletion variants, and history input types", async ({ page }) => {
    const result = await page.evaluate(() => {
      const harness = window.__smartCanonical!;
      const root = document.querySelector('[data-smart-canonical-surface="true"]')!;
      const dispatch = (inputType: string, data: string | null = null) => root.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true, cancelable: true, inputType, data,
      }));
      const select = (path: number[], anchor: number, head = anchor) => {
        const selection = { type: "text" as const, anchor: { path, offset: anchor }, head: { path, offset: head } };
        harness.editor.setSelection(selection);
        harness.renderer.render(harness.editor.document, selection);
      };
      select([0], 1, 4);
      dispatch("insertReplacementText", "X");
      select([1], 7);
      dispatch("deleteContentBackward");
      select([2], 0);
      dispatch("deleteContentForward");
      select([3], 7);
      dispatch("deleteWordBackward");
      select([4], 0);
      dispatch("deleteWordForward");
      select([5], 5);
      dispatch("deleteSoftLineBackward");
      select([20], 8);
      dispatch("deleteContentForward");
      select([22], 0);
      dispatch("deleteContentBackward");
      select([0], 2);
      dispatch("insertText", "Q");
      dispatch("historyUndo");
      const undoText = harness.renderer.mapping.nodeToDom("canonical-p-0")?.textContent;
      dispatch("historyRedo");
      return {
        texts: ["canonical-p-0", "canonical-p-1", "canonical-p-2", "canonical-p-3", "canonical-p-4", "canonical-p-5", "canonical-p-20", "canonical-p-22"]
          .map((id) => harness.renderer.mapping.nodeToDom(id)?.textContent),
        undoText,
        blockCount: harness.editor.document.children.length,
      };
    });
    expect(result.texts).toEqual(["sXQt", "block ", "lock 2", "block ", " 4", " 5", "block 20block 21", "block 22block 23"]);
    expect(result.undoText).toBe("sXt");
    expect(result.blockCount).toBe(22);
  });

  test("navigates graphemes and atoms and deletes an adjacent atom as a node", async ({ page }) => {
    await page.goto("/?canonical=1&atoms=1");
    const editor = page.locator('[data-smart-id="atom-owner"]');
    await editor.click();
    await page.evaluate(() => {
      const harness = window.__smartCanonical!;
      harness.editor.setSelection({ type: "text", anchor: { path: [0], offset: 2 }, head: { path: [0], offset: 2 } });
      harness.renderer.render(harness.editor.document, harness.editor.selection);
    });
    await page.keyboard.press("ArrowLeft");
    expect(await page.evaluate(() => window.__smartCanonical!.editor.selection.head.offset)).toBe(1);
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => window.__smartCanonical!.editor.selection.head.offset)).toBe(2);
    await page.keyboard.press("Backspace");
    expect(await editor.textContent()).toBe("ab");
    expect(await page.evaluate(() => window.__smartCanonical!.editor.positions.exists("inline-atom"))).toBe(false);
    await page.keyboard.press("Home");
    expect(await page.evaluate(() => window.__smartCanonical!.editor.selection.head.offset)).toBe(0);
    await page.keyboard.press("Alt+ArrowRight");
    expect(await page.evaluate(() => window.__smartCanonical!.editor.selection.head.offset)).toBe(2);
    await page.keyboard.press("Home");
    await page.keyboard.press("End");
    expect(await page.evaluate(() => window.__smartCanonical!.editor.selection.head.offset)).toBe(2);
  });

  test("reconciles composition without renderer writes to the composing paragraph", async ({ page }) => {
    const result = await page.evaluate(() => {
      const harness = window.__smartCanonical!;
      const paragraph = harness.renderer.mapping.nodeToDom("canonical-p-0")!;
      const text = paragraph.firstChild!;
      harness.pipeline.handleCompositionStart(new CompositionEvent("compositionstart", { data: "" }));
      harness.pipeline.handleCompositionUpdate(new CompositionEvent("compositionupdate", { data: "नम" }));
      const compositionInput = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertCompositionText", data: "नम" });
      paragraph.dispatchEvent(compositionInput);
      text.nodeValue = "startनमस्ते";
      getSelection()?.setBaseAndExtent(text, text.nodeValue.length, text, text.nodeValue.length);
      harness.renderer.resetWriteCounters();
      harness.pipeline.handleCompositionEnd(new CompositionEvent("compositionend", { data: "नमस्ते" }));
      return {
        text: paragraph.textContent,
        model: (harness.editor.document.children[0] as { children?: Array<{ text?: string }> }).children?.[0]?.text,
        writes: harness.renderer.composingDomWriteCount,
        compositionPrevented: compositionInput.defaultPrevented,
      };
    });
    expect(result).toEqual({ text: "startनमस्ते", model: "startनमस्ते", writes: 0, compositionPrevented: false });
  });

  test("groups composition-over-selection and treats cancellation as a no-op", async ({ page }) => {
    const result = await page.evaluate(() => {
      const harness = window.__smartCanonical!;
      const paragraph = harness.renderer.mapping.nodeToDom("canonical-p-0")!;
      const text = paragraph.firstChild!;
      const selected = { type: "text" as const, anchor: { path: [0], offset: 1 }, head: { path: [0], offset: 4 } };
      harness.editor.setSelection(selected);
      harness.renderer.render(harness.editor.document, selected);
      harness.pipeline.handleCompositionStart(new CompositionEvent("compositionstart"));
      text.nodeValue = "s界t";
      getSelection()?.setBaseAndExtent(text, 2, text, 2);
      harness.pipeline.handleCompositionEnd(new CompositionEvent("compositionend", { data: "界" }));
      const afterReplace = paragraph.textContent;
      const historyDepth = harness.editor.history.undo.length;
      harness.pipeline.handleCompositionStart(new CompositionEvent("compositionstart"));
      harness.pipeline.handleCompositionEnd(new CompositionEvent("compositionend", { data: "" }));
      return { afterReplace, historyDepth, afterCancelDepth: harness.editor.history.undo.length };
    });
    expect(result).toEqual({ afterReplace: "s界t", historyDepth: 1, afterCancelDepth: 1 });
  });

  test("cancels unsupported, paste, and drop input without model corruption", async ({ page }) => {
    const result = await page.evaluate(() => {
      const root = document.querySelector('[data-smart-canonical-surface="true"]')!;
      const unsupported = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertFromYank" });
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      root.dispatchEvent(unsupported);
      root.dispatchEvent(paste);
      root.dispatchEvent(drop);
      return {
        prevented: [unsupported.defaultPrevented, paste.defaultPrevented, drop.defaultPrevented],
        text: root.querySelector('[data-smart-id="canonical-p-0"]')?.textContent,
        logged: window.__smartCanonical!.pipeline.unhandledInputTypes,
      };
    });
    expect(result.prevented).toEqual([true, true, true]);
    expect(result.text).toBe("start");
    expect(result.logged).toEqual(expect.arrayContaining(["insertFromYank", "paste", "drop"]));
  });

  test("promotes a native crossing selection before storing it", async ({ page }) => {
    await page.goto("/?canonical=1&isolation=1");
    const result = await page.evaluate(() => {
      const harness = window.__smartCanonical!;
      const first = harness.renderer.mapping.nodeToDom("before")!.firstChild!;
      const second = harness.renderer.mapping.nodeToDom("inside")!.firstChild!;
      getSelection()?.setBaseAndExtent(first, 1, second, 2);
      harness.pipeline.syncSelectionFromDom();
      return harness.editor.selection;
    });
    expect(result).toEqual({ type: "node", anchor: { path: [], offset: 1 }, head: { path: [], offset: 2 } });
  });
});

test.describe("Phase 4 canonical inline formatting", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?canonical=1&blocks=8");
    await expect(page.locator(surface)).toBeVisible();
    await page.locator('[data-smart-id="canonical-p-0"]').click();
  });

  test("preserves stored marks through typing, composition, undo, and redo", async ({ page }) => {
    const result = await page.evaluate(() => {
      const harness = window.__smartCanonical!;
      const root = document.querySelector('[data-smart-canonical-surface="true"]')!;
      root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "formatBold" }));
      root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "x" }));
      const afterType = harness.renderer.mapping.nodeToDom("canonical-p-0")?.innerHTML;
      harness.editor.undo();
      harness.renderer.render(harness.editor.document, harness.editor.selection);
      const afterUndo = harness.renderer.mapping.nodeToDom("canonical-p-0")?.textContent;
      harness.editor.redo();
      harness.renderer.render(harness.editor.document, harness.editor.selection);
      const afterRedo = harness.renderer.mapping.nodeToDom("canonical-p-0")?.innerHTML;

      const paragraph = harness.renderer.mapping.nodeToDom("canonical-p-0")!;
      const text = paragraph.querySelector("strong")?.firstChild || paragraph.firstChild!;
      harness.pipeline.handleCompositionStart(new CompositionEvent("compositionstart"));
      text.nodeValue = `${text.nodeValue || ""}न`;
      getSelection()?.setBaseAndExtent(text, text.nodeValue.length, text, text.nodeValue.length);
      harness.renderer.resetWriteCounters();
      harness.pipeline.handleCompositionEnd(new CompositionEvent("compositionend", { data: "न" }));
      return {
        afterType, afterUndo, afterRedo,
        composed: harness.renderer.mapping.nodeToDom("canonical-p-0")?.innerHTML,
        writes: harness.renderer.composingDomWriteCount,
      };
    });
    expect(result.afterType).toContain("<strong");
    expect(result.afterUndo).toBe("start");
    expect(result.afterRedo).toContain("<strong");
    expect(result.composed).toContain("न");
    expect(result.composed).toContain("<strong");
    expect(result.writes).toBe(0);
  });

  test("uses atomic hard_break and semantic marked DOM without axe violations", async ({ page }) => {
    await page.keyboard.press("Shift+Enter");
    await expect(page.locator('[data-smart-type="hard_break"]')).toHaveCount(1);
    const result = await new AxeBuilder({ page }).include(surface).analyze();
    expect(result.violations).toEqual([]);
  });

  test("replays 1,000 privacy-safe retained-legacy inline scenarios in this browser", async ({ page }, testInfo) => {
    const summary = await page.evaluate(() => window.__smartCanonical!.runInlineShadowCorpus(1_000));
    testInfo.annotations.push({ type: "inline-shadow-corpus", description: JSON.stringify({
      browser: testInfo.project.name, scenarios: summary.scenarios, equivalent: summary.equivalent, divergences: summary.divergences,
    }) });
    console.log(`[phase4][${testInfo.project.name}] inline-shadow=${JSON.stringify({
      scenarios: summary.scenarios,
      equivalent: summary.equivalent,
      divergences: summary.divergences,
    })}`);
    expect(summary.divergences.semantic).toBeUndefined();
    expect(summary.divergences["data-loss"]).toBeUndefined();
    expect(JSON.stringify(summary.logs)).not.toContain("formatting fixture");
    expect(JSON.stringify(summary.logs)).not.toContain("linked text");
  });
});

test("continuous typing at 10,000 blocks reports input-to-paint latency", async ({ page }, testInfo) => {
  await page.goto("/?canonical=1&blocks=10000");
  const editor = page.locator(surface);
  await expect(editor).toBeVisible();
  await page.locator('[data-smart-id="canonical-p-0"]').click();
  await page.keyboard.type("abcdefghij", { delay: 30 });
  await page.waitForFunction(() => window.__smartCanonical?.lastInputPaintMs !== null);
  const result = await page.evaluate(() => ({
    latency: window.__smartCanonical!.lastInputPaintMs!,
    text: window.__smartCanonical!.renderer.mapping.nodeToDom("canonical-p-0")?.textContent,
  }));
  testInfo.annotations.push({ type: "input-to-paint-ms", description: String(result.latency) });
  console.log(`[phase2.5][${testInfo.project.name}] input-to-paint=${result.latency.toFixed(3)}ms`);
  expect(result.text).toBe("startabcdefghij");
  // One nominal 60 Hz frame plus timer/rAF quantization tolerance.
  expect(result.latency).toBeLessThan(20);
});

test.describe("Phase 3 canonical list vertical slice", () => {
  test("has no axe violations in semantic list and checklist fixtures", async ({ page }) => {
    for (const fixture of ["lists=1", "checks=1"]) {
      await page.goto(`/?canonical=1&${fixture}`);
      await expect(page.locator(surface)).toBeVisible();
      const results = await new AxeBuilder({ page }).include(surface).analyze();
      expect(results.violations).toEqual([]);
    }
  });

  test("replays 1,000 privacy-safe comparator scenarios in this browser", async ({ page }, testInfo) => {
    await page.goto("/?canonical=1&lists=1");
    const summary = await page.evaluate(() => window.__smartCanonical!.runShadowCorpus(1_000));
    testInfo.annotations.push({ type: "shadow-corpus", description: JSON.stringify({
      browser: testInfo.project.name, scenarios: summary.scenarios, equivalent: summary.equivalent, divergences: summary.divergences,
    }) });
    expect(summary).toMatchObject({ scenarios: 1_000, equivalent: 1_000, divergences: {} });
    expect(JSON.stringify(summary.logs)).not.toContain("content-");
    expect(JSON.stringify(summary.logs)).not.toContain("nested-");
  });

  test("uses semantic DOM and canonical Tab/outdent with one announcement per level", async ({ page }) => {
    await page.goto("/?canonical=1&lists=1");
    await expect(page.locator(`${surface} > ul > li`)).toHaveCount(3);
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-smart-id="canonical-nested-list"] > li')).toHaveCount(2);
    await expect(page.locator('[data-smart-ui="list-level-announcement"]')).toHaveText("List level 2");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(`${surface} > ul > li`)).toHaveCount(3);
    await expect(page.locator('[data-smart-ui="list-level-announcement"]')).toHaveText("List level 1");
    expect(await page.evaluate(() => window.__smartCanonical!.editor.history.undo.length)).toBe(2);
  });

  test("handles Enter start/mid/end and restores structural history", async ({ page }) => {
    await page.goto("/?canonical=1&lists=1");
    await page.keyboard.press("Enter");
    await expect(page.locator(`${surface} > ul > li`)).toHaveCount(4);
    await page.keyboard.type("X");
    await expect(page.locator('[data-smart-id="canonical-item-c-p"]')).toHaveText("Xgamma");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(page.locator(`${surface} > ul > li`)).toHaveCount(3);
    await page.evaluate(() => {
      const harness = window.__smartCanonical!;
      const selection = { type: "text" as const, anchor: { path: [0, 2, 0], offset: 2 }, head: { path: [0, 2, 0], offset: 2 } };
      harness.editor.setSelection(selection);
      harness.renderer.render(harness.editor.document, selection);
    });
    await page.keyboard.press("Enter");
    await expect(page.locator(`${surface} > ul > li`)).toHaveCount(4);
    await expect(page.locator(`${surface} > ul > li`).nth(2)).toHaveText("ga");
    await expect(page.locator(`${surface} > ul > li`).nth(3)).toHaveText("mma");
  });

  test("Backspace merges into the deepest preceding descendant and Delete mirrors forward", async ({ page }) => {
    await page.goto("/?canonical=1&lists=1");
    await page.keyboard.press("Backspace");
    await expect(page.locator('[data-smart-id="canonical-nested-p"]')).toHaveText("nestedgamma");
    await expect(page.locator('[data-smart-id="canonical-item-c"]')).toHaveCount(0);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(page.locator('[data-smart-id="canonical-item-c"]')).toHaveCount(1);
    await page.evaluate(() => {
      const harness = window.__smartCanonical!;
      const selection = { type: "text" as const, anchor: { path: [0, 1, 0], offset: 4 }, head: { path: [0, 1, 0], offset: 4 } };
      harness.editor.setSelection(selection);
      harness.renderer.render(harness.editor.document, selection);
    });
    await page.keyboard.press("Delete");
    await expect(page.locator('[data-smart-id="canonical-item-b-p"]')).toHaveText("betanested");
    await expect(page.locator('[data-smart-id="canonical-nested-item"]')).toHaveCount(0);
  });

  test("gives table navigation precedence over list Tab", async ({ page }) => {
    await page.goto("/?canonical=1&listTable=1");
    const before = await page.evaluate(() => JSON.stringify(window.__smartCanonical!.editor.document));
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => JSON.stringify(window.__smartCanonical!.editor.document))).toBe(before);
    expect(await page.evaluate(() => window.__smartCanonical!.editor.history.undo.length)).toBe(0);
  });

  test("toggles checklist state from the keyboard with semantic checkbox state", async ({ page }) => {
    await page.goto("/?canonical=1&checks=1");
    const item = page.locator('[data-smart-id="check-item"]');
    const checkbox = item.locator('[data-smart-ui="check-control"]');
    await expect(checkbox).toHaveAttribute("role", "checkbox");
    await expect(checkbox).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Space");
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    // Undo updates model history; explicitly render because editor.undo is a
    // kernel operation when called from the keyboard pipeline.
    await expect(checkbox).toHaveAttribute("aria-checked", "false");
  });
});
