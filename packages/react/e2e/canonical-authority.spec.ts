import { expect, test } from "@playwright/test";

const semanticSnapshot = async (page: import("@playwright/test").Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const walk = (node: Node): unknown => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement) || node.dataset.smartUi !== undefined) return null;
    return {
      tag: node.tagName.toLowerCase(),
      children: Array.from(node.childNodes).map(walk).filter((value) => value !== null && value !== ""),
    };
  };
  const selection = window.getSelection();
  return {
    tree: Array.from(root.childNodes).map(walk).filter((value) => value !== null),
    selection: selection?.rangeCount ? {
      collapsed: selection.isCollapsed,
      anchorOffset: selection.anchorOffset,
      focusOffset: selection.focusOffset,
    } : null,
  };
});

const placeCaretAtEnd = async (page: import("@playwright/test").Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) text = node as Text;
  const range = document.createRange();
  if (text) range.setStart(text, text.data.length); else range.selectNodeContents(root);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  root.focus();
});

test.describe("Phase 8b canonical product authority", () => {
  test("owns product input, checkpoints, undo, and composition without DOM writes", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type("abc");
    await expect(editor).toContainText("Canonical product editorabc");
    const checkpoint = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical: import("../src/canonicalEditorRuntime.js").CanonicalEditorRuntime }).__smartProductCanonical;
      return runtime.createCheckpoint();
    });
    await page.keyboard.type("later");
    await page.evaluate((value) => {
      const runtime = (window as typeof window & { __smartProductCanonical: import("../src/canonicalEditorRuntime.js").CanonicalEditorRuntime }).__smartProductCanonical;
      runtime.restoreCheckpoint(value);
    }, checkpoint);
    await expect(editor).not.toContainText("later");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical: import("../src/canonicalEditorRuntime.js").CanonicalEditorRuntime }).__smartProductCanonical;
      runtime.surface.renderer?.resetWriteCounters();
      const root = runtime.surface.root!;
      root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      root.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "क" }));
    });
    const composingWrites = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical: import("../src/canonicalEditorRuntime.js").CanonicalEditorRuntime }).__smartProductCanonical;
      return runtime.surface.renderer?.composingDomWriteCount;
    });
    expect(composingWrites).toBe(0);
  });

  test("reports a first divergent intent for a retained-vs-canonical typing trajectory", async ({ browser }) => {
    const context = await browser.newContext();
    const legacy = await context.newPage();
    const canonical = await context.newPage();
    await legacy.goto("/?sessionReplay=1");
    await canonical.goto("/?canonicalAuthority=1&sessionReplay=1");
    const legacyEditor = legacy.locator('[contenteditable="true"]');
    const canonicalEditor = canonical.locator('[contenteditable="true"]');
    const intents = ["a", "b", "c"];
    let firstDivergence: { index: number; intent: string; legacy: unknown; canonical: unknown } | null = null;
    for (let index = 0; index < intents.length; index += 1) {
      await placeCaretAtEnd(legacy);
      await legacy.keyboard.type(intents[index]);
      await placeCaretAtEnd(canonical);
      await canonical.keyboard.type(intents[index]);
      const left = await semanticSnapshot(legacy);
      const right = await semanticSnapshot(canonical);
      const leftText = await legacyEditor.textContent();
      const rightText = await canonicalEditor.textContent();
      if (leftText !== rightText && !firstDivergence) firstDivergence = { index, intent: intents[index], legacy: left, canonical: right };
    }
    expect(firstDivergence).toBeNull();
    await context.close();
  });

  test("Enter immediately displays the caret on a new empty line", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    await placeCaretAtEnd(page);
    await page.keyboard.press("Enter");

    const state = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      const paragraph = root.lastElementChild as HTMLElement;
      const selection = window.getSelection();
      return {
        paragraphType: paragraph?.dataset.smartType,
        hasEmptyLine: Boolean(paragraph?.querySelector('[data-smart-empty-line][data-smart-ui="empty-line"]')),
        caretOwnerId: selection?.focusNode instanceof HTMLElement
          ? selection.focusNode.dataset.smartId
          : selection?.focusNode?.parentElement?.dataset.smartId,
        paragraphId: paragraph?.dataset.smartId,
        focusOffset: selection?.focusOffset,
      };
    });
    expect(state).toMatchObject({ paragraphType: "paragraph", hasEmptyLine: true, focusOffset: 0 });
    expect(state.caretOwnerId).toBe(state.paragraphId);
  });

  test("Enter at the bottom scrolls the new line into the editor viewport", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=100");
    await placeCaretAtEnd(page);
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      root.scrollTop = 0;
    });
    await page.keyboard.press("Enter");

    await expect.poll(() => page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      const last = root.lastElementChild as HTMLElement;
      const rootRect = root.getBoundingClientRect();
      const lastRect = last.getBoundingClientRect();
      return {
        scrolled: root.scrollTop > 0,
        visible: lastRect.top >= rootRect.top && lastRect.bottom <= rootRect.bottom + 1,
        hasEmptyLine: Boolean(last.querySelector("[data-smart-empty-line]")),
      };
    })).toEqual({ scrolled: true, visible: true, hasEmptyLine: true });
  });

  for (const blocks of [2_000, 10_000]) test(`records 20 product input samples at ${blocks} blocks`, async ({ page }, testInfo) => {
    await page.goto(`/?canonicalAuthority=1&blocks=${blocks}`);
    const samples = await page.evaluate(async () => {
      const runtime = (window as typeof window & { __smartProductCanonical: import("../src/canonicalEditorRuntime.js").CanonicalEditorRuntime }).__smartProductCanonical;
      const values: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const started = performance.now();
        runtime.editor.typeText("x", { timestamp: index * 1_000 });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        values.push(performance.now() - started);
      }
      return values;
    });
    const sorted = [...samples].sort((left, right) => left - right);
    const metrics = { blocks, median: sorted[10], p95: sorted[18], worst: sorted[19] };
    console.log(`Phase 8b production performance ${testInfo.project.name}`, metrics);
    testInfo.annotations.push({ type: "performance", description: JSON.stringify(metrics) });
    expect(Number.isFinite(metrics.worst)).toBe(true);
  });

  test("captures the headed content-visibility experiment separately from production", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "One headed Chromium trace is the requested decision input.");
    await page.goto("/?canonicalAuthority=1&blocks=10000");
    const sample = async (candidate: boolean) => page.evaluate(async (enabled) => {
      const runtime = (window as typeof window & { __smartProductCanonical: import("../src/canonicalEditorRuntime.js").CanonicalEditorRuntime }).__smartProductCanonical;
      if (enabled) runtime.surface.root?.querySelectorAll<HTMLElement>(":scope > *").forEach((block) => {
        block.style.contentVisibility = "auto";
        block.style.containIntrinsicBlockSize = "24px";
      });
      const values: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const started = performance.now();
        runtime.editor.typeText("z", { timestamp: 100_000 + index * 1_000 });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        values.push(performance.now() - started);
      }
      return values;
    }, candidate);
    const baseline = await sample(false);
    const candidate = await sample(true);
    console.log("Phase 8b headed content-visibility experiment", { baseline, candidate });
    expect(candidate).toHaveLength(5);
  });
});
