import { expect, test } from "@playwright/test";
import { foundationSchema, normalizedStructureWithoutIds, parseCanonicalListHtml } from "smartrte-core/foundation";

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

const selectFirstText = async (page: import("@playwright/test").Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode();
  if (!text) return;
  const range = document.createRange(); range.selectNodeContents(text);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
});

const placeCaret = async (page: import("@playwright/test").Page, selector: string, last = false) => {
  await expect(page.locator(selector).first()).toBeAttached();
  await page.evaluate(({ selector, last }) => {
    const matches = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const target = last ? matches.at(-1) : matches[0];
    if (!target) throw new Error(`Cannot place caret: no element matches ${selector}`);
    const range = document.createRange(); range.selectNodeContents(target); range.collapse(false);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, { selector, last });
};

const selectCellRange = async (page: import("@playwright/test").Page, start: import("@playwright/test").Locator, end: import("@playwright/test").Locator) => {
  const startBox = await start.boundingBox();
  const endBox = await end.boundingBox();
  if (!startBox || !endBox) throw new Error("Cannot select generated table cells without layout boxes.");
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 4 });
  await page.mouse.up();
};

const chooseMedia = async (page: import("@playwright/test").Page, kind: "image" | "video" | "audio", name: string, mimeType: string) => {
  const picker = page.getByRole("dialog", { name: `Choose ${kind}` });
  await picker.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: Buffer.from(`${kind}-generated-session`) });
  await expect(picker).toHaveCount(0);
};

const replaySnapshot = async (page: import("@playwright/test").Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-smart-ui],[data-smart-projection]").forEach((node) => node.remove());
  const selection = window.getSelection();
  const point = (node: Node | null, offset: number) => {
    if (!node || !root.contains(node)) return null;
    let block = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    while (block?.parentElement && block.parentElement !== root) block = block.parentElement;
    if (!block || block.parentElement !== root) return null;
    const range = document.createRange();
    range.selectNodeContents(block);
    range.setEnd(node, offset);
    return { block: Array.from(root.children).indexOf(block), offset: range.toString().length };
  };
  return {
    html: clone.innerHTML,
    selection: selection ? {
      anchor: point(selection.anchorNode, selection.anchorOffset),
      head: point(selection.focusNode, selection.focusOffset),
      type: selection.isCollapsed ? "caret" : "range",
    } : null,
  };
});

const normalizedReplaySnapshot = async (page: import("@playwright/test").Page) => {
  const value = await replaySnapshot(page);
  const semanticSelection = await page.evaluate(() => {
    const runtime = (window as typeof window & { __smartProductCanonical?: { editor: {
      selection: { type: string; anchor: { path: number[]; offset: number }; head: { path: number[]; offset: number } };
      resolve: (input: { pos: { path: number[]; offset: number } }) => { pos: { path: number[]; offset: number }; kind: string };
    } } }).__smartProductCanonical;
    if (!runtime) return null;
    const selection = runtime.editor.selection;
    const point = (pos: { path: number[]; offset: number }) => {
      const resolved = runtime.editor.resolve({ pos });
      return { ownerPath: [...resolved.pos.path], kind: resolved.kind, offset: pos.offset };
    };
    return { type: selection.type, anchor: point(selection.anchor), head: point(selection.head) };
  });
  return {
    structure: normalizedStructureWithoutIds(parseCanonicalListHtml(value.html), foundationSchema),
    selection: value.selection,
    semanticSelection,
  };
};

test.describe("Phase 8b canonical product authority", () => {
  test("owns product input, checkpoints, undo, and composition without DOM writes", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor).toBeVisible();
    await placeCaretAtEnd(page);
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

  test("reports the first divergence across the retained-vs-canonical lifecycle trajectory", async ({ browser }) => {
    const context = await browser.newContext();
    const legacy = await context.newPage();
    const canonical = await context.newPage();
    await legacy.goto("/?sessionReplay=1");
    await canonical.goto("/?canonicalAuthority=1&sessionReplay=1");
    const intents: { name: string; run: (page: import("@playwright/test").Page, canonical: boolean) => Promise<void> }[] = [
      { name: "type-a", run: async (page) => { await placeCaretAtEnd(page); await page.keyboard.type("a"); } },
      { name: "type-b", run: async (page) => { await page.keyboard.type("b"); } },
      { name: "select-all", run: async (page) => { await selectFirstText(page); } },
      { name: "bold", run: async (page) => page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>('button[aria-label="Bold"],button[title="Bold"]');
        button?.click();
      }) },
      { name: "undo", run: async (page) => {
        await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click());
      } },
      { name: "redo", run: async (page) => {
        await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Redo"]')!.click());
      } },
      { name: "focus-blur-focus", run: async (page) => {
        const root = page.locator('[contenteditable="true"]'); await root.focus(); await root.blur(); await root.focus();
      } },
      { name: "external-replacement", run: async (page, canonical) => page.evaluate((isCanonical) => {
        const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
        if (isCanonical) {
          window.__smartProductCanonical!.replaceValue({
            schemaVersion: window.__smartProductCanonical!.editor.schema.version,
            revision: 50,
            document: { type: "doc", id: "replay-doc", children: [{ type: "paragraph", id: "replay-p", children: [{ type: "text", text: "replacement" }] }] },
          });
        } else {
          root.innerHTML = "<p>replacement</p>";
          root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
        }
        const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode();
        if (text) {
          const range = document.createRange(); range.setStart(text, 0); range.collapse(true);
          const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
        }
      }, canonical) },
      { name: "paste-fragment", run: async (page) => page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
        root.focus();
        const transfer = new DataTransfer();
        transfer.setData("text/html", "<strong> pasted</strong>");
        transfer.setData("text/plain", " pasted");
        root.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
      }) },
      { name: "drop-fragment", run: async (page, canonical) => page.evaluate((isCanonical) => {
        const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
        if (isCanonical) {
          const transfer = new DataTransfer();
          transfer.setData("text/html", "<em> dropped</em>");
          transfer.setData("text/plain", " dropped");
          root.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
          return;
        }
        // Synthetic DragEvent does not execute the browser's native legacy
        // default insertion, so the retained harness performs that default.
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        const emphasis = document.createElement("em"); emphasis.textContent = " dropped";
        range.insertNode(emphasis); range.setStartAfter(emphasis); range.collapse(true);
        selection.removeAllRanges(); selection.addRange(range);
        root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromDrop" }));
      }, canonical) },
      { name: "composition", run: async (page) => page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
        root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
        const selection = window.getSelection();
        if (selection?.rangeCount) {
          let text = selection.focusNode?.nodeType === Node.TEXT_NODE ? selection.focusNode as Text : null;
          if (!text && selection.focusNode?.nodeType === Node.ELEMENT_NODE) {
            const owner = selection.focusNode as Element;
            const candidate = owner.childNodes[Math.max(0, selection.focusOffset - 1)] || owner.childNodes[selection.focusOffset];
            const walker = document.createTreeWalker(candidate, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) text = node as Text;
          }
          if (text) {
            text.data += "क";
            selection.setBaseAndExtent(text, text.data.length, text, text.data.length);
          }
        }
        root.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "क" }));
        root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "क" }));
      }) },
    ];
    let firstDivergence: { index: number; intent: string; legacy: unknown; canonical: unknown } | null = null;
    for (let index = 0; index < intents.length; index += 1) {
      await intents[index].run(legacy, false);
      await intents[index].run(canonical, true);
      const left = await normalizedReplaySnapshot(legacy);
      const right = await normalizedReplaySnapshot(canonical);
      const comparableSelection = left.selection?.anchor && left.selection.head && right.selection?.anchor && right.selection.head;
      const selectionCompared = comparableSelection && intents[index].name !== "composition";
      const equivalent = JSON.stringify(left.structure) === JSON.stringify(right.structure)
        && (!selectionCompared || JSON.stringify(left.selection) === JSON.stringify(right.selection));
      if (!equivalent && !firstDivergence) {
        firstDivergence = { index, intent: intents[index].name, legacy: left, canonical: right };
      }
    }
    expect(firstDivergence).toBeNull();
    await context.close();
  });

  test("replays generated complete command sessions with semantic selection checkpoints", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    type Intent = { name: string; run: (page: import("@playwright/test").Page) => Promise<void> };
    const button = (name: string): Intent["run"] => async (currentPage) => {
      await currentPage.getByRole("button", { name, exact: true }).click();
    };
    const markSession: Intent[] = [
      { name: "mark.bold", run: async (currentPage) => { await selectFirstText(currentPage); await button("Bold")(currentPage); } },
      { name: "mark.italic", run: button("Italic") },
      { name: "mark.underline", run: button("Underline") },
      { name: "mark.strike", run: button("Strikethrough") },
      { name: "mark.code", run: button("Inline code") },
      { name: "mark.superscript", run: button("Superscript") },
      { name: "mark.subscript", run: button("Subscript") },
      { name: "mark.textColor", run: button("Text colour") },
      { name: "mark.backgroundColor", run: button("Background colour") },
      { name: "mark.fontSize", run: button("Font size") },
      { name: "mark.fontFamily", run: button("Font family") },
      { name: "mark.link", run: async (currentPage) => { await currentPage.getByRole("button", { name: "Insert or edit link", exact: true }).click(); } },
    ];
    const blockSession: Intent[] = [
      { name: "block.setType", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p'); await currentPage.getByRole("combobox", { name: "Block type" }).selectOption("heading-2"); } },
      { name: "block.setAttributes", run: button("Align center") },
      { name: "block.wrap", run: button("Blockquote") },
      { name: "block.unwrap", run: button("Blockquote") },
      { name: "block.move", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > :is(p,h1,h2,h3,h4,h5,h6)', true); await button("Move block up")(currentPage); } },
      { name: "block.indent", run: button("Indent block") },
      { name: "block.outdent", run: button("Outdent block") },
    ];
    const selectFirstTableCell = async (currentPage: import("@playwright/test").Page) => {
      const table = currentPage.locator('[data-smart-authority="canonical"] [contenteditable="true"] table');
      const cell = table.locator("tr").first().locator("td,th").first();
      await selectCellRange(currentPage, cell, cell);
    };
    const listSession: Intent[] = [
      { name: "list.create", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p'); await button("Bulleted list")(currentPage); await currentPage.keyboard.press("End"); await currentPage.keyboard.press("Enter"); await currentPage.keyboard.type("second"); } },
      { name: "list.setPreset", run: async (currentPage) => { await currentPage.getByRole("combobox", { name: "List preset" }).selectOption("bullet-circle"); } },
      { name: "list.setStyle", run: button("Bulleted list") },
      { name: "list.indent", run: button("Indent list item") },
      { name: "list.outdent", run: button("Outdent list item") },
      { name: "list.move", run: button("Move item up") },
      { name: "list.move.reverse", run: button("Move item down") },
      { name: "list.create.numbered", run: button("Numbered list") },
      { name: "list.setChecked", run: async (currentPage) => { await button("Checklist")(currentPage); await button("Check selected items")(currentPage); } },
      { name: "list.restartNumbering", run: async (currentPage) => { await button("Numbered list")(currentPage); await button("Restart numbering")(currentPage); } },
      { name: "list.continueNumbering", run: button("Continue numbering") },
      { name: "list.unwrap", run: button("Numbered list") },
    ];
    const tableSession: Intent[] = [
      { name: "table.insert", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p'); await button("Insert table")(currentPage); } },
      { name: "table.mergeCells", run: async (currentPage) => { const table = currentPage.locator('[data-smart-authority="canonical"] [contenteditable="true"] table'); await selectCellRange(currentPage, table.locator("tr").first().locator("td,th").nth(0), table.locator("tr").first().locator("td,th").nth(1)); await button("Merge cells")(currentPage); } },
      { name: "table.splitCell", run: async (currentPage) => { await selectFirstTableCell(currentPage); await button("Split cell")(currentPage); } },
      { name: "table.insertRow", run: async (currentPage) => { await selectFirstTableCell(currentPage); await button("Add row")(currentPage); } },
      { name: "table.removeRow", run: async (currentPage) => { await selectFirstTableCell(currentPage); await button("Remove row")(currentPage); } },
      { name: "table.insertColumn", run: async (currentPage) => { await selectFirstTableCell(currentPage); await button("Add column")(currentPage); } },
      { name: "table.removeColumn", run: async (currentPage) => { await selectFirstTableCell(currentPage); await button("Remove column")(currentPage); } },
      { name: "table.setHeader", run: async (currentPage) => { await selectFirstTableCell(currentPage); await button("Header row")(currentPage); } },
      { name: "table.moveRow", run: async (currentPage) => { await selectFirstTableCell(currentPage); await button("Move row down")(currentPage); } },
      { name: "table.moveColumn", run: async (currentPage) => { await selectFirstTableCell(currentPage); await button("Move column right")(currentPage); } },
      { name: "table.remove", run: async (currentPage) => { await selectFirstTableCell(currentPage); await button("Remove table")(currentPage); } },
    ];
    const atomSession: Intent[] = [
      { name: "atom.insert.image", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true); await button("Insert image")(currentPage); await chooseMedia(currentPage, "image", "generated.png", "image/png"); } },
      { name: "atom.resize", run: async (currentPage) => { await currentPage.locator('[data-smart-type="block_image"]').click(); await button("Grow selected atom")(currentPage); await button("Shrink selected atom")(currentPage); } },
      { name: "atom.update", run: async (currentPage) => { await button("Edit selected atom")(currentPage); } },
      { name: "atom.delete", run: button("Delete selected atom") },
      { name: "atom.insert.video", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true); await button("Insert video")(currentPage); await chooseMedia(currentPage, "video", "generated.mp4", "video/mp4"); } },
      { name: "atom.insert.audio", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true); await button("Insert audio")(currentPage); await chooseMedia(currentPage, "audio", "generated.mp3", "audio/mpeg"); } },
      { name: "atom.insert.formula", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true); await button("Insert formula")(currentPage); } },
    ];
    const sessions: Array<{ name: string; intents: Intent[] }> = [
      { name: "marks", intents: markSession },
      { name: "blocks", intents: blockSession },
      { name: "lists", intents: listSession },
      { name: "tables", intents: tableSession },
      { name: "atoms", intents: atomSession },
    ];
    const volatile = (value: unknown) => JSON.stringify(value).replace(/https:\/\/media\.playground\.test\/[^"\\]+/g, "https://media.playground.test/fixture");
    const runSession = async (intents: readonly Intent[]) => {
      await expect(page.locator('[data-smart-authority="canonical"] [contenteditable="true"]')).toBeVisible();
      const snapshots: unknown[] = [];
      for (const intent of intents) {
        await intent.run(page);
        const snapshot = await normalizedReplaySnapshot(page);
        snapshots.push(snapshot);
        expect(snapshot.structure).toBeDefined();
      }
      return snapshots;
    };
    page.on("dialog", (dialog) => {
      const message = dialog.message();
      const answer = message.includes("Text colour") || message.includes("Background colour") ? "#336699"
        : message.includes("Font size") ? "18"
          : message.includes("Font family") ? "Inter"
            : message.includes("Link URL") ? "https://generated.example.test"
              : message.includes("Alt text") ? "Generated image" : "E=mc^2";
      void dialog.accept(answer);
    });
    let totalIntents = 0;
    let comparableSelections = 0;
    for (const session of sessions) {
      await page.goto("/?canonicalAuthority=1&blocks=3&sessionReplay=1");
      const first = await runSession(session.intents);
      await page.goto("/?canonicalAuthority=1&blocks=3&sessionReplay=1");
      const second = await runSession(session.intents);
      expect(second.map((snapshot) => volatile(snapshot))).toEqual(first.map((snapshot) => volatile(snapshot)));
      first.forEach((snapshot, index) => {
        const selection = (snapshot as { semanticSelection?: unknown }).semanticSelection;
        const replaySelection = (second[index] as { semanticSelection?: unknown }).semanticSelection;
        if (selection && replaySelection) comparableSelections += 1;
      });
      totalIntents += session.intents.length;
    }
    testInfo.annotations.push({ type: "session-replay", description: `${sessions.length} generated sessions, ${totalIntents} intents, ${comparableSelections} semantic selection checkpoints compared` });
    expect(totalIntents).toBeGreaterThan(40);
    expect(comparableSelections).toBeGreaterThan(40);
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
