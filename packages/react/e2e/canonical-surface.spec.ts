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

  test("uses node selection and the inline/block deletion asymmetry", async ({ page }) => {
    await page.goto("/?canonical=1&atoms=1");
    const result = await page.evaluate(() => {
      const harness = window.__smartCanonical!;
      const root = document.querySelector('[data-smart-canonical-surface="true"]')!;
      const dispatch = (inputType: string, data: string | null = null) => root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType, data }));
      (harness.renderer.mapping.nodeToDom("inline-atom") as HTMLElement).click();
      const clickedType = harness.editor.selection.type;
      dispatch("insertText", "Z");
      const inlineReplaced = harness.renderer.mapping.nodeToDom("atom-owner")?.textContent;
      harness.editor.setSelection({ type: "text", anchor: { path: [2], offset: 0 }, head: { path: [2], offset: 0 } });
      harness.renderer.render(harness.editor.document, harness.editor.selection);
      dispatch("deleteContentBackward");
      const firstBackspace = { type: harness.editor.selection.type, exists: harness.editor.positions.exists("block-atom") };
      dispatch("deleteContentBackward");
      return { clickedType, inlineReplaced, firstBackspace, afterSecond: harness.editor.positions.exists("block-atom") };
    });
    expect(result).toEqual({ clickedType: "node", inlineReplaced: "aZb", firstBackspace: { type: "node", exists: true }, afterSecond: false });
  });

  test("reconciles composition before, after, and between atoms with zero composing writes", async ({ page }) => {
    await page.goto("/?canonical=1&atoms=1");
    const result = await page.evaluate(() => {
      const harness = window.__smartCanonical!;
      const owner = harness.renderer.mapping.nodeToDom("atom-owner")!;
      const compose = (offset: number, mutate: () => Text) => {
        const selection = { type: "text" as const, anchor: { path: [0], offset }, head: { path: [0], offset } };
        harness.editor.setSelection(selection); harness.renderer.render(harness.editor.document, selection);
        harness.pipeline.handleCompositionStart(new CompositionEvent("compositionstart"));
        const text = mutate(); getSelection()?.setBaseAndExtent(text, text.data.length, text, text.data.length);
        harness.renderer.resetWriteCounters(); harness.pipeline.handleCompositionEnd(new CompositionEvent("compositionend"));
        return harness.renderer.composingDomWriteCount;
      };
      const beforeWrites = compose(1, () => { const text = owner.firstChild as Text; text.data = "aन"; return text; });
      const afterWrites = compose(3, () => { const text = owner.lastChild as Text; text.data = "मb"; return text; });
      const current = harness.editor.document.children[0] as { id: string; type: string; children: unknown[] };
      const second = { type: "formula", id: "inline-atom-2", attrs: { source: "y", notation: "latex" } };
      const next = { ...current, children: [...current.children.slice(0, 2), second, ...current.children.slice(2)] };
      harness.editor.transact((builder) => builder.operations.push({ type: "replaceNode", pos: { path: [], offset: 0 }, before: current as never, after: next as never }), { addToHistory: false });
      harness.renderer.render(harness.editor.document, harness.editor.selection);
      const betweenWrites = compose(3, () => {
        const secondAtom = harness.renderer.mapping.nodeToDom("inline-atom-2")!;
        const text = document.createTextNode("界"); secondAtom.parentNode!.insertBefore(text, secondAtom); return text;
      });
      // Atoms (e.g. live-rendered KaTeX formulas) may contain rich internal
      // markup whose own textContent no longer equals their raw source, so
      // reconciliation is checked as surrounding-text-around-opaque-atoms
      // rather than a flat textContent comparison against atom source.
      const finalOwner = harness.renderer.mapping.nodeToDom("atom-owner")!;
      const text = Array.from(finalOwner.childNodes).map((node) => (
        node.nodeType === Node.TEXT_NODE ? (node as Text).data : `[${(node as Element).getAttribute("data-smart-id")}]`
      )).join("");
      return { text, beforeWrites, afterWrites, betweenWrites, atoms: ["inline-atom", "inline-atom-2"].map((id) => harness.editor.positions.exists(id)) };
    });
    expect(result).toEqual({ text: "aन[inline-atom]界[inline-atom-2]मb", beforeWrites: 0, afterWrites: 0, betweenWrites: 0, atoms: [true, true] });
  });

  test("keeps upload completion outside history and drops stale completion", async ({ page }) => {
    await page.goto("/?canonical=1&atoms=1");
    const result = await page.evaluate(() => window.__smartCanonical!.runAtomLifecycle());
    expect(result).toEqual({ completed: true, removedByUndo: true, staleDropped: true, historyDepth: 1 });
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
    expect(result.logged).toEqual(expect.arrayContaining([
      "insertFromYank",
      "paste-without-clipboard-data",
      "drop-without-data-transfer",
    ]));
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
});

test.describe("Phase 7 atomic content engine", () => {
  test("renders required image alternatives and accessible read-only formulas without axe violations", async ({ page }) => {
    await page.goto("/?canonical=1&atoms=1");
    await expect(page.locator('[data-smart-id="block-atom"]')).toHaveAttribute("alt", "Example image");
    await expect(page.locator('[data-smart-id="inline-atom"]')).toHaveAttribute("role", "math");
    await expect(page.locator('[data-smart-id="inline-atom"]')).toHaveAttribute("contenteditable", "false");
    const result = await new AxeBuilder({ page }).include(surface).analyze();
    expect(result.violations).toEqual([]);
  });

  test("replays 700 privacy-safe retained atom scenarios in this browser", async ({ page }, testInfo) => {
    await page.goto("/?canonical=1&atoms=1");
    await expect(page.locator(surface)).toBeVisible();
    const summary = await page.evaluate(() => window.__smartCanonical!.runAtomShadowCorpus(700));
    testInfo.annotations.push({ type: "atom-shadow-corpus", description: JSON.stringify({ browser: testInfo.project.name, scenarios: summary.scenarios, equivalent: summary.equivalent, divergences: summary.divergences, corrections: summary.corrections }) });
    console.log(`[phase7][${testInfo.project.name}] atom-shadow=${JSON.stringify({ scenarios: summary.scenarios, equivalent: summary.equivalent, divergences: summary.divergences, corrections: summary.corrections })}`);
    expect(summary.divergences.semantic).toBeUndefined();
    expect(summary.divergences["data-loss"]).toBeUndefined();
    expect(summary.divergences.unknown).toBeUndefined();
    expect(JSON.stringify(summary.logs)).not.toContain("fixture");
    expect(JSON.stringify(summary.logs)).not.toContain("alert");
  });
});

for (const blocks of [2_000, 10_000] as const) test(`continuous typing at ${blocks.toLocaleString("en-US")} blocks reports five input-to-paint samples`, async ({ page }, testInfo) => {
  await page.goto(`/?canonical=1&blocks=${blocks}`);
  const editor = page.locator(surface);
  await expect(editor).toBeVisible();
  await page.locator('[data-smart-id="canonical-p-0"]').click();
  const samples: number[] = [];
  for (const character of "abcde") {
    await page.evaluate(() => { window.__smartCanonical!.lastInputPaintMs = null; });
    await page.keyboard.type(character);
    await page.waitForFunction(() => window.__smartCanonical?.lastInputPaintMs !== null);
    samples.push(await page.evaluate(() => window.__smartCanonical!.lastInputPaintMs!));
  }
  const result = await page.evaluate(() => ({
    text: window.__smartCanonical!.renderer.mapping.nodeToDom("canonical-p-0")?.textContent,
  }));
  const sorted = [...samples].sort((a, b) => a - b);
  const summary = { samples, median: sorted[2]!, p95: sorted[4]!, worst: sorted[4]! };
  testInfo.annotations.push({ type: "input-to-paint-ms", description: JSON.stringify(summary) });
  console.log(`[phase6-baseline][${testInfo.project.name}][blocks=${blocks}] input-to-paint=${JSON.stringify(summary)}`);
  expect(result.text).toBe("startabcde");
  expect(samples).toHaveLength(5);
});

test("typing in a 50×50 canonical table reports five input-to-paint samples", async ({ page }, testInfo) => {
  await page.goto("/?canonical=1&table=50");
  const editor = page.locator(surface);
  await expect(editor).toBeVisible();
  await page.locator('[data-smart-id="benchmark-p-1-0"]').click();
  const samples: number[] = [];
  for (const character of "abcde") {
    await page.evaluate(() => { window.__smartCanonical!.lastInputPaintMs = null; });
    await page.keyboard.type(character);
    await page.waitForFunction(() => window.__smartCanonical?.lastInputPaintMs !== null);
    samples.push(await page.evaluate(() => window.__smartCanonical!.lastInputPaintMs!));
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const summary = { samples, median: sorted[2]!, p95: sorted[4]!, worst: sorted[4]! };
  testInfo.annotations.push({ type: "table-input-to-paint-ms", description: JSON.stringify(summary) });
  console.log(`[phase6][${testInfo.project.name}][table=50x50] input-to-paint=${JSON.stringify(summary)}`);
  await expect(page.locator('[data-smart-id="benchmark-p-1-0"]')).toContainText("1:0abcde");
});

test("canonical table exposes caption, scoped headers, associations, and no axe violations", async ({ page }) => {
  await page.goto("/?canonical=1&table=3");
  await expect(page.locator(`${surface} table`)).toHaveCount(1);
  await expect(page.locator(`${surface} th`)).toHaveCount(3);
  await expect(page.locator(`${surface} th`).first()).toHaveAttribute("scope", "col");
  await expect(page.locator(`${surface} td`).first()).toHaveAttribute("headers", /smart-header-/);
  const results = await new AxeBuilder({ page }).include(surface).analyze();
  expect(results.violations).toEqual([]);
});

test.describe("Phase 5 block accessibility", () => {
  test("exposes heading, quote, and labelled code-block semantics without axe violations", async ({ page }) => {
    await page.goto("/?canonical=1&blockSemantics=1");
    await expect(page.locator(surface)).toBeVisible();
    await expect(page.locator(`${surface} h1`)).toHaveText("Document title");
    await expect(page.locator(`${surface} h2`)).toHaveText("Section title");
    await expect(page.locator(`${surface} blockquote`)).toHaveText("Quoted text");
    await expect(page.locator(`${surface} pre`)).toHaveAttribute("aria-label", "Code block, typescript");
    const results = await new AxeBuilder({ page }).include(surface).analyze();
    expect(results.violations).toEqual([]);
  });
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
    // The canonical harness is mounted by a React effect. Under full WebKit
    // load, page.goto can resolve before that effect has focused the editable
    // root; an immediate Enter then goes to the page instead of the seeded
    // list item and the test observes the unchanged three-item list. Wait for
    // the harness and focus explicitly so this test exercises list Enter,
    // rather than a mount-order race.
    await page.waitForFunction(() => Boolean(window.__smartCanonical));
    await expect(page.locator(surface)).toBeVisible();
    await page.locator(surface).focus();
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
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    // Undo updates model history; explicitly render because editor.undo is a
    // kernel operation when called from the keyboard pipeline.
    await expect(checkbox).toHaveAttribute("aria-checked", "false");
  });
});
