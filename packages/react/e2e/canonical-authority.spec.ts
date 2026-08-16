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

const installTrailingQuote = async (page: import("@playwright/test").Page) => page.evaluate(() => {
  const runtime = (window as typeof window & { __smartProductCanonical?: {
    editor: { schema: { version: number }; state: { revision: number } };
    replaceValue: (value: unknown) => void;
  } }).__smartProductCanonical;
  const authority = document.querySelector<HTMLElement>('[data-smart-authority]')?.dataset.smartAuthority;
  if (!runtime) throw new Error("Canonical runtime is not available");
  runtime.replaceValue({
    schemaVersion: runtime.editor.schema.version,
    revision: runtime.editor.state.revision + 1,
    document: {
      type: "doc",
      id: "bug4-doc",
      children: [{
        type: "blockquote",
        id: "bug4-quote",
        children: [{ type: "paragraph", id: "bug4-quote-paragraph", children: [{ type: "text", text: "quoted" }] }],
      }],
    },
  });
  return { authority };
});

const placeCaretInTopLevelBlock = async (page: import("@playwright/test").Page, index: number, atEnd = false) => page.evaluate(({ index, atEnd }) => {
  const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
  const blocks = [...root.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute("data-smart-id"));
  const target = blocks[index];
  if (!target) throw new Error(`No top-level block at index ${index}`);
  const text = document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
  const range = document.createRange();
  if (text) {
    const offset = atEnd ? text.data.length : 0;
    range.setStart(text, offset);
  } else {
    range.selectNodeContents(target);
    range.collapse(!atEnd);
  }
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}, { index, atEnd });

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
    if (!runtime) {
      const root = document.querySelector<HTMLElement>('[contenteditable="true"]');
      const native = window.getSelection();
      if (!root || !native?.anchorNode || !native.focusNode) return null;
      const modelTags = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "UL", "OL", "LI", "TABLE", "TR", "TD", "TH", "BLOCKQUOTE", "IMG", "VIDEO", "AUDIO"]);
      const structuralTags = new Set(["UL", "OL", "LI", "TABLE", "TR", "TD", "TH", "BLOCKQUOTE", "IMG", "VIDEO", "AUDIO"]);
      const ownerFor = (node: Node | null) => {
        let current = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
        while (current && current !== root && !modelTags.has(current.tagName)) current = current.parentElement;
        return current instanceof HTMLElement && current !== root ? current : null;
      };
      const modelPath = (owner: HTMLElement) => {
        const path: number[] = [];
        let current: HTMLElement | null = owner;
        while (current && current !== root) {
          const parent = current.parentElement;
          if (!parent) break;
          if (modelTags.has(current.tagName)) {
            const siblings = Array.from(parent.children).filter((child) => modelTags.has(child.tagName));
            const index = siblings.indexOf(current);
            if (index >= 0) path.unshift(index);
          }
          current = parent;
        }
        return path;
      };
      const offsetIn = (owner: HTMLElement, node: Node, offset: number) => {
        const range = document.createRange();
        range.selectNodeContents(owner);
        try { range.setEnd(node, offset); } catch { return 0; }
        return range.toString().length;
      };
      const point = (node: Node | null, offset: number) => {
        const owner = ownerFor(node);
        if (!owner || !root.contains(owner)) return null;
        return { ownerPath: modelPath(owner), kind: structuralTags.has(owner.tagName) ? "structural" : "inline", offset: offsetIn(owner, node!, offset) };
      };
      return { type: native.isCollapsed ? "text" : "text", anchor: point(native.anchorNode, native.anchorOffset), head: point(native.focusNode, native.focusOffset) };
    }
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
      { name: "list.setPreset", run: async (currentPage) => { await currentPage.getByRole("combobox", { name: "List preset" }).selectOption("bullet-diamond"); } },
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
      { name: "table.mergeCells", run: async (currentPage) => { const table = currentPage.locator('[data-smart-authority="canonical"] [contenteditable="true"] table'); await selectCellRange(currentPage, table.locator("tr").first().locator("td,th").nth(0), table.locator("tr").first().locator("td,th").nth(1)); await expect(currentPage.locator('[data-smart-cell-selected="true"]')).toHaveCount(2); await expect.poll(() => currentPage.evaluate(() => window.__smartProductCanonical?.editor.selection.type)).toBe("cell"); await expect(currentPage.getByRole("button", { name: "Merge cells", exact: true })).toBeEnabled(); await button("Merge cells")(currentPage); await expect(table.locator("tr").first().locator("td,th").first()).toHaveAttribute("colspan", "2"); } },
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
        // Toolbar clicks and native selectionchange dispatches can complete
        // on separate browser tasks. Let both the model subscription and the
        // renderer's selection projection settle before taking the semantic
        // checkpoint; this is synchronization, not a retry of the intent.
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
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
      // Native DOM ranges are browser-owned and can transiently disappear
      // when focus moves between toolbar commands. The replay contract is
      // canonical structure plus semantic model selection; native range
      // details are covered by the focused renderer/selection tests.
      const comparable = (snapshot: unknown) => {
        const value = snapshot as { structure: unknown; semanticSelection: unknown };
        return volatile({ structure: value.structure, semanticSelection: value.semanticSelection });
      };
      expect(second.map(comparable)).toEqual(first.map(comparable));
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

  test("runs the retained/canonical command replay in the selected browser", async ({ page }, testInfo) => {
    await page.goto("/?gate13Replay=1");
    const result = await page.locator("[data-gate13-replay]").evaluate(async (element) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const value = (window as typeof window & { __smartGate13Replay?: { comparableIntents: number; intentResults: Array<{ equivalent: boolean; selectionCompared: boolean }>; listCorpus: { scenarios: number; equivalent: number; divergences: Record<string, number> }; atomCorpus: { scenarios: number; divergences: Record<string, number> } } }).__smartGate13Replay;
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Gate 13 replay did not finish.");
    });
    const failures = result.intentResults.filter((entry) => !entry.equivalent);
    const unexpected = failures.filter((entry) => !["expected-normalization", "visual-only", "selection-only"].includes((entry as { classification?: string }).classification || ""));
    console.info("Phase 8b retained/canonical browser replay", testInfo.project.name, JSON.stringify({ comparableIntents: result.comparableIntents, divergenceCount: failures.length, divergences: failures.map((entry) => ({ intent: (entry as { intent?: string }).intent, classification: (entry as { classification?: string }).classification, hash: (entry as { hash?: string }).hash })), listCorpus: result.listCorpus }));
    testInfo.annotations.push({ type: "gate-13-browser-replay", description: JSON.stringify({ browser: testInfo.project.name, comparableIntents: result.comparableIntents, failures: failures.map((entry) => ({ intent: (entry as { intent?: string }).intent, classification: (entry as { classification?: string }).classification, hash: (entry as { hash?: string }).hash })), listCorpus: result.listCorpus, atomCorpus: result.atomCorpus }) });
    // 42 minus the 7 block.* intents (domBlockCommandBridge.ts) minus the
    // 12 mark.* intents (canonicalInlineCommandBridge.ts), both retired in
    // Phase 8b closeout (2026-08-12).
    expect(result.comparableIntents).toBe(23);
    expect(result.intentResults).toHaveLength(23);
    expect(result.listCorpus.scenarios).toBe(5);
    expect(result.listCorpus.equivalent).toBe(5);
    expect(result.listCorpus.divergences).toEqual({});
    expect(result.atomCorpus.scenarios).toBe(7);
    expect(result.atomCorpus.equivalent).toBe(4);
    expect(result.atomCorpus.divergences).toEqual({ "expected-normalization": 3 });
    // This route is evidence collection, not a waiver mechanism.  Known
    // retained/canonical differences remain visible in the annotation and in
    // the delta report; Gate 14 is closed only when this list is empty.
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

  test("reaches the editable position after a literal final blockquote", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const setup = await installTrailingQuote(page);
    expect(setup.authority).toBe("canonical");
    const state = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ type: string; id: string }>; selection: { head: { path: number[]; offset: number } } } } } }).__smartProductCanonical!;
      const range = document.createRange();
      range.setStart(root, root.childNodes.length);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return {
        children: runtime.editor.document.children.map((node) => ({ type: node.type, id: node.id })),
        selection: runtime.editor.selection,
        native: { node: selection.anchorNode?.nodeName, offset: selection.anchorOffset },
      };
    });
    expect(state.children.at(-1)?.type).toBe("paragraph");
    expect(state.selection.head.path).toEqual([state.children.length - 1]);
    expect(state.selection.head.offset).toBe(0);
  });

  test("select-all then Down collapses to the editable position after a final blockquote", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const setup = await installTrailingQuote(page);
    expect(setup.authority).toBe("canonical");
    const root = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await root.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(25);
    const state = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ type: string; id: string }>; selection: { type: string; head: { path: number[]; offset: number } } } } } }).__smartProductCanonical!;
      const selection = window.getSelection();
      return {
        children: runtime.editor.document.children.map((node) => ({ type: node.type, id: node.id })),
        selection: runtime.editor.selection,
        native: { collapsed: selection?.isCollapsed, node: selection?.focusNode?.nodeName, offset: selection?.focusOffset },
      };
    });
    expect(state.children.at(-1)?.type).toBe("paragraph");
    expect(state.selection.type).toBe("text");
    expect(state.selection.head.path).toEqual([state.children.length - 1]);
    expect(state.selection.head.offset).toBe(0);
  });

  test("keeps a toolbar-created final blockquote boundary editable", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    await selectFirstText(page);
    await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await page.getByRole("button", { name: "Blockquote", exact: true }).click();
    const state = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ type: string }>; selection: { head: { path: number[]; offset: number } } } } } }).__smartProductCanonical!;
      return {
        children: runtime.editor.document.children.map((node) => node.type),
        selection: runtime.editor.selection,
      };
    });
    expect(state.children).toContain("blockquote");
    const root = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await root.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { selection: { type: string; head: { path: number[]; offset: number } } } } }).__smartProductCanonical!;
      return runtime.editor.selection;
    })).toMatchObject({ type: "text" });
    const after = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ type: string }>; selection: { head: { path: number[]; offset: number } } } } } }).__smartProductCanonical!;
      return { children: runtime.editor.document.children.map((node) => node.type), selection: runtime.editor.selection };
    });
    expect(after.children.at(-1)).toBe("paragraph");
    expect(after.selection.head.path).toEqual([after.children.length - 1]);
    expect(after.selection.head.offset).toBe(0);
  });

  test("keeps the moved block caret and native selection aligned while typing", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=4");
    await placeCaretInTopLevelBlock(page, 1, true);
    const before = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ id: string; type: string; children?: Array<{ text?: string }> }> }; selection: { head: { path: number[]; offset: number } } } } }).__smartProductCanonical!;
      return {
        ids: runtime.editor.document.children.map((node) => node.id),
        texts: runtime.editor.document.children.map((node) => node.children?.map((child) => child.text || "").join("") || ""),
        selection: runtime.editor.selection,
      };
    });
    await page.getByRole("button", { name: "Move block down", exact: true }).click();
    const moved = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ id: string; type: string; children?: Array<{ text?: string }> }> }; selection: { head: { path: number[]; offset: number } }; resolve: (input: { pos: { path: number[]; offset: number } }) => { nodeId: string } } } }).__smartProductCanonical!;
      const native = window.getSelection();
      const nativeOwner = native?.focusNode instanceof Element
        ? native.focusNode.closest<HTMLElement>("[data-smart-id]")
        : native?.focusNode?.parentElement?.closest<HTMLElement>("[data-smart-id]");
      const modelOwner = runtime.editor.resolve({ pos: runtime.editor.selection.head }).nodeId;
      return {
        ids: runtime.editor.document.children.map((node) => node.id),
        texts: runtime.editor.document.children.map((node) => node.children?.map((child) => child.text || "").join("") || ""),
        selection: runtime.editor.selection,
        modelOwner,
        nativeOwner: nativeOwner?.dataset.smartId || null,
      };
    });
    expect(moved.ids).toEqual([before.ids[0], before.ids[2], before.ids[1], before.ids[3]]);
    expect(moved.modelOwner).toBe(before.ids[1]);
    expect(moved.nativeOwner).toBe(moved.modelOwner);
    await page.keyboard.type(" moved");
    const typed = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ children?: Array<{ text?: string }> }> } } } }).__smartProductCanonical!;
      const texts = runtime.editor.document.children.map((node) => node.children?.map((child) => child.text || "").join("") || "");
      return { texts, occurrences: texts.filter((text) => text.includes(" moved")).length };
    });
    expect(typed.occurrences).toBe(1);
    expect(typed.texts[2]).toContain(" moved");
  });

  test("keeps the moved block owner aligned through repeated moves and delayed typing", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=5");
    await placeCaretInTopLevelBlock(page, 2, true);
    const before = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ id: string }> }; selection: unknown } } }).__smartProductCanonical!;
      return { ids: runtime.editor.document.children.map((node) => node.id), selection: runtime.editor.selection };
    });
    const selectedId = before.ids[2];
    const directions = ["down", "up", "down", "up"] as const;
    for (const direction of directions) {
      await page.getByRole("button", { name: direction === "down" ? "Move block down" : "Move block up", exact: true }).click();
      // A browser can dispatch selectionchange after the DOM move. Waiting for
      // that task boundary is intentional: the regression was a stale native
      // range that only became visible on the next input.
      await page.waitForTimeout(50);
      const snapshot = await page.evaluate(() => {
        const runtime = (window as typeof window & {
          __smartProductCanonical?: {
            editor: {
              document: { children: Array<{ id: string }> };
              selection: { head: { path: number[]; offset: number } };
              resolve: (input: { pos: { path: number[]; offset: number } }) => { nodeId: string };
            };
          };
        }).__smartProductCanonical!;
        const native = window.getSelection();
        const nativeOwner = native?.focusNode instanceof Element
          ? native.focusNode.closest<HTMLElement>("[data-smart-id]")
          : native?.focusNode?.parentElement?.closest<HTMLElement>("[data-smart-id]");
        return {
          ids: runtime.editor.document.children.map((node) => node.id),
          modelOwner: runtime.editor.resolve({ pos: runtime.editor.selection.head }).nodeId,
          nativeOwner: nativeOwner?.dataset.smartId || null,
        };
      });
      expect(snapshot.modelOwner).toBe(selectedId);
      expect(snapshot.nativeOwner).toBe(selectedId);
    }
    await page.keyboard.type(" repeated-move");
    const typed = await page.evaluate((selectedId) => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ id: string; children?: Array<{ text?: string }> }> } } } }).__smartProductCanonical!;
      return runtime.editor.document.children.map((node) => ({ id: node.id, text: node.children?.map((child) => child.text || "").join("") || "" }));
    }, selectedId);
    expect(typed.filter((node) => node.text.includes(" repeated-move"))).toHaveLength(1);
    expect(typed.find((node) => node.id === selectedId)?.text).toContain(" repeated-move");
  });

  test("does not duplicate rapid typing after repeated block moves", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=6");
    await placeCaretInTopLevelBlock(page, 2, true);
    const selectedId = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ id: string }> }; selection: { head: { path: number[]; offset: number } } };
      } }).__smartProductCanonical!;
      return runtime.editor.document.children[runtime.editor.selection.head.path[0]]?.id;
    });
    if (!selectedId) throw new Error("No block was selected for rapid-move typing regression.");

    for (let index = 0; index < 12; index += 1) {
      await page.getByRole("button", { name: index % 2 === 0 ? "Move block down" : "Move block up", exact: true }).click();
      await page.keyboard.type(` rapid-move-${index} `);
    }

    const result = await page.evaluate((id) => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ id: string; children?: Array<{ text?: string }> }> } };
      } }).__smartProductCanonical!;
      return runtime.editor.document.children.map((node) => ({
        id: node.id,
        text: node.children?.map((child) => child.text || "").join("") || "",
      })).map((node) => ({ ...node, selected: node.id === id }));
    }, selectedId);
    for (let index = 0; index < 12; index += 1) {
      const token = `rapid-move-${index}`;
      expect(result.filter((node) => node.text.includes(token))).toHaveLength(1);
      expect(result.find((node) => node.text.includes(token))?.selected).toBe(true);
    }
  });

  test("keeps list.move selection aligned through reordering and typing", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=3");
    await page.evaluate(() => {
      const blocks = document.querySelectorAll<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"] > p');
      const range = document.createRange();
      range.selectNodeContents(blocks[0]);
      range.setEndAfter(blocks[1]);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > ul > li:nth-child(2) p', true);
    const before = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ type: string; id: string; children?: Array<{ id: string }> }> }; selection: { head: { path: number[] } } } } }).__smartProductCanonical!;
      const list = runtime.editor.document.children.find((node) => node.type === "list")!;
      return { itemIds: list.children?.map((item) => item.id) || [], paragraphId: list.children?.[1].children?.[0].id || "" };
    });
    await page.getByRole("button", { name: "Move item up", exact: true }).click();
    await page.waitForTimeout(50);
    const moved = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ type: string; children?: Array<{ id: string }> }> }; selection: { head: { path: number[] } }; resolve: (input: { pos: { path: number[]; offset: number } }) => { nodeId: string } } } }).__smartProductCanonical!;
      const native = window.getSelection();
      const nativeOwner = native?.focusNode instanceof Element
        ? native.focusNode.closest<HTMLElement>("[data-smart-id]")
        : native?.focusNode?.parentElement?.closest<HTMLElement>("[data-smart-id]");
      const list = runtime.editor.document.children.find((node) => node.type === "list")!;
      return {
        itemIds: list.children?.map((item) => item.id) || [],
        modelOwner: runtime.editor.resolve({ pos: runtime.editor.selection.head }).nodeId,
        nativeOwner: nativeOwner?.dataset.smartId || null,
      };
    });
    expect(moved.itemIds).toEqual([before.itemIds[1], before.itemIds[0]]);
    expect(moved.modelOwner).toBe(before.paragraphId);
    expect(moved.nativeOwner).toBe(before.paragraphId);
    await page.keyboard.type(" list-moved");
    const typed = await page.locator('[data-smart-authority="canonical"] [contenteditable="true"] > ul > li p').allTextContents();
    expect(typed.filter((text) => text.includes(" list-moved"))).toHaveLength(1);
  });

  test("keeps table row and column move owners aligned while typing", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true);
    await page.getByRole("button", { name: "Insert table", exact: true }).click();
    const table = page.locator('[data-smart-authority="canonical"] [contenteditable="true"] table');
    await expect(table.locator("tr")).toHaveCount(2);

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] table tr:first-child td:first-child p', true);
    const beforeRowMove = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: {
          document: { children: Array<{ type: string; children?: Array<{ id: string }> }> };
          selection: { head: { path: number[]; offset: number } };
          resolve: (input: { pos: { path: number[]; offset: number } }) => { nodeId: string };
        };
      } }).__smartProductCanonical!;
      const tableNode = runtime.editor.document.children.find((node) => node.type === "table")!;
      const native = window.getSelection();
      const nativeOwner = native?.focusNode instanceof Element
        ? native.focusNode.closest<HTMLElement>("[data-smart-id]")
        : native?.focusNode?.parentElement?.closest<HTMLElement>("[data-smart-id]");
      return {
        rowIds: tableNode.children?.map((row) => row.id) || [],
        ownerId: runtime.editor.resolve({ pos: runtime.editor.selection.head }).nodeId,
        nativeOwner: nativeOwner?.dataset.smartId || null,
      };
    });
    await page.getByRole("button", { name: "Move row down", exact: true }).click();
    const afterRowMove = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: {
          document: { children: Array<{ type: string; children?: Array<{ id: string }> }> };
          selection: { head: { path: number[]; offset: number } };
          resolve: (input: { pos: { path: number[]; offset: number } }) => { nodeId: string };
        };
      } }).__smartProductCanonical!;
      const tableNode = runtime.editor.document.children.find((node) => node.type === "table")!;
      const native = window.getSelection();
      const nativeOwner = native?.focusNode instanceof Element
        ? native.focusNode.closest<HTMLElement>("[data-smart-id]")
        : native?.focusNode?.parentElement?.closest<HTMLElement>("[data-smart-id]");
      return {
        rowIds: tableNode.children?.map((row) => row.id) || [],
        ownerId: runtime.editor.resolve({ pos: runtime.editor.selection.head }).nodeId,
        nativeOwner: nativeOwner?.dataset.smartId || null,
      };
    });
    expect(afterRowMove.rowIds).toEqual([beforeRowMove.rowIds[1], beforeRowMove.rowIds[0]]);
    expect(afterRowMove.ownerId).toBe(beforeRowMove.ownerId);
    expect(afterRowMove.nativeOwner).toBe(beforeRowMove.ownerId);
    await page.keyboard.type(" row-moved");

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] table tr:first-child td:first-child p', true);
    const beforeColumnMove = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: {
          document: { children: Array<{ type: string; children?: Array<{ children?: Array<{ id: string }> }> }> };
          selection: { head: { path: number[]; offset: number } };
          resolve: (input: { pos: { path: number[]; offset: number } }) => { nodeId: string };
        };
      } }).__smartProductCanonical!;
      const tableNode = runtime.editor.document.children.find((node) => node.type === "table")!;
      const firstRow = tableNode.children?.[0];
      const native = window.getSelection();
      const nativeOwner = native?.focusNode instanceof Element
        ? native.focusNode.closest<HTMLElement>("[data-smart-id]")
        : native?.focusNode?.parentElement?.closest<HTMLElement>("[data-smart-id]");
      return {
        cellIds: firstRow?.children?.map((cell) => cell.id) || [],
        ownerId: runtime.editor.resolve({ pos: runtime.editor.selection.head }).nodeId,
        nativeOwner: nativeOwner?.dataset.smartId || null,
      };
    });
    await page.getByRole("button", { name: "Move column right", exact: true }).click();
    const afterColumnMove = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: {
          document: { children: Array<{ type: string; children?: Array<{ children?: Array<{ id: string }> }> }> };
          selection: { head: { path: number[]; offset: number } };
          resolve: (input: { pos: { path: number[]; offset: number } }) => { nodeId: string };
        };
      } }).__smartProductCanonical!;
      const tableNode = runtime.editor.document.children.find((node) => node.type === "table")!;
      const firstRow = tableNode.children?.[0];
      const native = window.getSelection();
      const nativeOwner = native?.focusNode instanceof Element
        ? native.focusNode.closest<HTMLElement>("[data-smart-id]")
        : native?.focusNode?.parentElement?.closest<HTMLElement>("[data-smart-id]");
      return {
        cellIds: firstRow?.children?.map((cell) => cell.id) || [],
        ownerId: runtime.editor.resolve({ pos: runtime.editor.selection.head }).nodeId,
        nativeOwner: nativeOwner?.dataset.smartId || null,
      };
    });
    expect(afterColumnMove.cellIds).toEqual([beforeColumnMove.cellIds[1], beforeColumnMove.cellIds[0]]);
    expect(afterColumnMove.ownerId).toBe(beforeColumnMove.ownerId);
    expect(afterColumnMove.nativeOwner).toBe(beforeColumnMove.ownerId);
    await page.keyboard.type(" column-moved");

    const texts = await page.locator('[data-smart-authority="canonical"] [contenteditable="true"] table p').allTextContents();
    expect(texts.filter((text) => text.includes(" row-moved"))).toHaveLength(1);
    expect(texts.filter((text) => text.includes(" column-moved"))).toHaveLength(1);
  });

  test("deletes the empty paragraph after Enter exits a list", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    await selectFirstText(page);
    await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-smart-authority="canonical"] [contenteditable="true"] > p')).toHaveCount(1);
    await page.keyboard.press("Backspace");

    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ type: string }> }; selection: { head: { path: number[]; offset: number } } } } }).__smartProductCanonical;
      const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      return {
        types: runtime?.editor.document.children.map((node) => node.type),
        directParagraphs: root.querySelectorAll(":scope > p").length,
      };
    });
    expect(result.types).toEqual(["list"]);
    expect(result.directParagraphs).toBe(0);
  });

  for (const key of ["Backspace", "Delete"] as const) test(`select-all ${key} leaves one editable paragraph`, async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=3");
    await page.locator('[data-smart-authority="canonical"] [contenteditable="true"]').focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press(key);

    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ type: string; children?: unknown[] }> }; selection: { head: { path: number[]; offset: number } } } } }).__smartProductCanonical;
      return {
        children: runtime?.editor.document.children.map((node) => ({ type: node.type, childCount: node.children?.length || 0 })),
        selection: runtime?.editor.selection.head,
      };
    });
    expect(result.children).toEqual([{ type: "paragraph", childCount: 0 }]);
    expect(result.selection).toEqual({ path: [0], offset: 0 });
  });

  for (const key of ["Backspace", "Delete"] as const) test(`select-all ${key} clears a mixed list-table-atom document`, async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: {
          type: "doc", id: "select-all-complex-doc", children: [
            { type: "paragraph", id: "complex-before", children: [{ type: "text", text: "before" }] },
            { type: "list", id: "complex-list", children: [{ type: "list_item", id: "complex-item", children: [{ type: "paragraph", id: "complex-item-p", children: [{ type: "text", text: "item" }] }] }] },
            { type: "table", id: "complex-table", children: [{ type: "table_row", id: "complex-row", children: [{ type: "table_cell", id: "complex-cell", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "complex-cell-p", children: [{ type: "text", text: "cell" }] }] }] }] },
            { type: "block_image", id: "complex-image", attrs: { src: "https://cdn.test/complex.png", alt: "Complex image", status: "ready", width: 100, height: 50 } },
          ],
        },
      });
    });
    const root = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await root.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press(key);

    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: {
        document: { children: Array<{ type: string; children?: unknown[] }> };
        selection: { head: { path: number[]; offset: number } };
      } } }).__smartProductCanonical!;
      return {
        children: runtime.editor.document.children.map((node) => ({ type: node.type, childCount: node.children?.length || 0 })),
        selection: runtime.editor.selection.head,
      };
    });
    expect(result.children).toEqual([{ type: "paragraph", childCount: 0 }]);
    expect(result.selection).toEqual({ path: [0], offset: 0 });
  });

  test("preserves consecutive spaces in the live canonical model", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await placeCaretAtEnd(page);
    for (let index = 0; index < 4; index += 1) await page.keyboard.press("Space");
    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ children?: Array<{ text?: string }> }> } };
      } }).__smartProductCanonical!;
      const text = runtime.editor.document.children.flatMap((node) => node.children || [])
        .map((child) => child.text || "").join("");
      return { text, trailingSpaces: text.match(/ *$/)?.[0].length || 0 };
    });
    expect(result.trailingSpaces).toBe(4);
  });

  test("preserves spaces typed inside checklist text", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { replaceValue: (value: unknown) => void; editor: { schema: { version: number }; state: { revision: number } } } }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "check-space-doc", children: [{
          type: "list", id: "check-space-list", attrs: { style: "disc", checkable: true }, children: [{
            type: "list_item", id: "check-space-item", attrs: { checked: false }, children: [{
              type: "paragraph", id: "check-space-paragraph", children: [{ type: "text", text: "Buymilk" }],
            }],
          }],
        }] },
      });
      const text = document.querySelector<HTMLElement>('[data-smart-id="check-space-paragraph"]')?.firstChild;
      if (!(text instanceof Text)) throw new Error("Checklist text node is missing");
      const range = document.createRange();
      range.setStart(text, 3); range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      (document.querySelector('[contenteditable="true"]') as HTMLElement).focus();
    });
    await page.keyboard.press("Space");
    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: any } } }).__smartProductCanonical!;
      const list = runtime.editor.document.children[0];
      const item = list.children[0];
      return { text: item.children[0].children[0].text, checked: item.attrs?.checked === true };
    });
    expect(result).toEqual({ text: "Buy milk", checked: false });
  });

  test("applies every exposed list preset through toolbar routing", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await selectFirstText(page);
    await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
    const presets = [
      ["ordered-decimal", "ol"], ["ordered-decimal-paren", "ol"], ["ordered-outline", "ol"],
      ["ordered-upper-alpha", "ol"], ["ordered-upper-roman", "ol"], ["ordered-leading-zero", "ol"],
      ["bullet-disc", "ul"], ["bullet-diamond", "ul"], ["bullet-square", "ul"], ["bullet-arrow", "ul"],
      ["bullet-star", "ul"], ["bullet-arrow-circle", "ul"],
    ] as const;
    const optionValues = await page.getByRole("combobox", { name: "List preset" }).locator("option").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).filter(Boolean));
    expect(optionValues).toEqual(presets.map(([preset]) => preset));
    for (const [preset, tag] of presets) {
      await page.getByRole("combobox", { name: "List preset" }).selectOption(preset);
      const result = await page.evaluate(() => {
        const runtime = (window as typeof window & { __smartProductCanonical?: {
          editor: { document: { children: Array<{ type: string; attrs?: Record<string, unknown> }> } };
        } }).__smartProductCanonical!;
        const list = runtime.editor.document.children.find((node) => node.type === "list");
        const element = document.querySelector<HTMLElement>(`[data-smart-list-preset="${String(list?.attrs?.preset || "")}"]`);
        const firstItem = element?.querySelector<HTMLElement>(":scope > li");
        return {
          preset: list?.attrs?.preset,
          style: list?.attrs?.style,
          depth: element?.getAttribute("data-smart-list-depth"),
          marker: firstItem ? getComputedStyle(firstItem, "::marker").content : null,
        };
      });
      expect(result).toMatchObject({ preset, style: undefined, depth: "0" });
      expect(result.marker).not.toBe("normal");
      await expect(page.locator(`[data-smart-authority="canonical"] [contenteditable="true"] > ${tag}`)).toHaveCount(1);
    }
  });

  test("applies a preset chosen from a nested cursor to the whole list tree", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number }; setSelection: (selection: unknown, options?: unknown) => void; document: unknown; selection: unknown };
        replaceValue: (value: unknown) => void;
        renderer: { render: (document: unknown, selection: unknown) => void };
      } }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: {
          type: "doc", id: "nested-preset-doc", children: [{
            type: "list", id: "nested-preset-outer", attrs: { style: "disc" }, children: [{
              type: "list_item", id: "nested-preset-item", children: [
                { type: "paragraph", id: "nested-preset-parent", children: [{ type: "text", text: "Parent" }] },
                { type: "list", id: "nested-preset-inner", attrs: { style: "disc" }, children: [{
                  type: "list_item", id: "nested-preset-child-item", children: [
                    { type: "paragraph", id: "nested-preset-child", children: [{ type: "text", text: "Child" }] },
                  ],
                }] },
              ],
            }],
          }],
        },
      });
      const selection = { type: "text" as const, anchor: { path: [0, 0, 1, 0, 0], offset: 0 }, head: { path: [0, 0, 1, 0, 0], offset: 5 } };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const presets = [
      "bullet-disc", "bullet-diamond", "bullet-square", "bullet-arrow", "bullet-star", "bullet-arrow-circle",
      "ordered-decimal", "ordered-decimal-paren", "ordered-outline", "ordered-upper-alpha", "ordered-upper-roman", "ordered-leading-zero",
    ];
    for (const preset of presets) {
      await page.getByRole("combobox", { name: "List preset" }).selectOption(preset);
      const result = await page.evaluate((presetId) => {
        const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: any[] } } } }).__smartProductCanonical!;
        const outer = runtime.editor.document.children[0];
        const inner = outer.children[0].children.find((node: any) => node.type === "list");
        const outerElement = document.querySelector<HTMLElement>('[data-smart-id="nested-preset-outer"]');
        const innerElement = document.querySelector<HTMLElement>('[data-smart-id="nested-preset-inner"]');
        const outerItem = outerElement?.querySelector<HTMLElement>(":scope > li");
        const innerItem = innerElement?.querySelector<HTMLElement>(":scope > li");
        return {
          outer: outer.attrs,
          inner: inner?.attrs,
          outerDepth: outerElement?.getAttribute("data-smart-list-depth"),
          innerDepth: innerElement?.getAttribute("data-smart-list-depth"),
          outerMarker: outerItem ? getComputedStyle(outerItem, "::marker").content : null,
          innerMarker: innerItem ? getComputedStyle(innerItem, "::marker").content : null,
        };
      }, preset);
      // A preset chosen from anywhere in the list — including a deeply
      // nested cursor — applies to the whole list tree, not just the
      // segment nearest the cursor.
      expect(result.outer).toMatchObject({ preset });
      expect(result.inner).toMatchObject({ preset });
      expect(result.outerDepth).toBe("0");
      expect(result.innerDepth).toBe("1");
      expect(result.outerMarker).not.toBe("normal");
      expect(result.innerMarker).not.toBe("normal");
    }
  });

  test("updates nested markers when the outer list preset changes", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; document: unknown; setSelection: (selection: unknown, options?: unknown) => void };
        replaceValue: (value: unknown) => void;
        renderer: { render: (document: unknown, selection: unknown) => void };
      } }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: 1,
        document: {
          type: "doc", id: "outer-marker-doc", children: [{
            type: "list", id: "outer-marker-list", attrs: { style: "disc", preset: "bullet-disc" }, children: [{
              type: "list_item", id: "outer-marker-item", children: [
                { type: "paragraph", id: "outer-marker-parent", children: [{ type: "text", text: "Parent" }] },
                { type: "list", id: "outer-marker-inner", attrs: { style: "disc", preset: "bullet-disc" }, children: [{
                  type: "list_item", id: "outer-marker-child-item", children: [
                    { type: "paragraph", id: "outer-marker-child", children: [{ type: "text", text: "Child" }] },
                  ],
                }] },
              ],
            }] },
          ],
        },
      });
      const selection = { type: "text" as const, anchor: { path: [0, 0, 0], offset: 0 }, head: { path: [0, 0, 0], offset: 6 } };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    await page.getByRole("combobox", { name: "List preset" }).selectOption("ordered-upper-alpha");
    const result = await page.evaluate(() => {
      const outer = document.querySelector<HTMLElement>('[data-smart-id="outer-marker-list"]');
      const inner = document.querySelector<HTMLElement>('[data-smart-id="outer-marker-inner"]');
      const innerItem = inner?.querySelector<HTMLElement>(":scope > li");
      return {
        outerPreset: outer?.getAttribute("data-smart-list-preset"),
        innerPreset: inner?.getAttribute("data-smart-list-preset"),
        innerMarker: innerItem ? getComputedStyle(innerItem, "::marker").content : null,
      };
    });
    expect(result.outerPreset).toBe("ordered-upper-alpha");
    expect(result.innerPreset).toBe("ordered-upper-alpha");
    expect(result.innerMarker).not.toBe("normal");
  });

  test("Tab hoists an indented item's own nested children to siblings instead of moving the whole subtree", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "tab-hoist-doc", children: [{
          type: "list", id: "tab-hoist-mid", attrs: { style: "decimal" }, children: [
            { type: "list_item", id: "tab-hoist-sibling", children: [{ type: "paragraph", id: "tab-hoist-sibling-p", children: [{ type: "text", text: "Sibling" }] }] },
            {
              type: "list_item", id: "tab-hoist-target", children: [
                { type: "paragraph", id: "tab-hoist-target-p", children: [{ type: "text", text: "Target" }] },
                {
                  type: "list", id: "tab-hoist-deep", attrs: { style: "decimal" }, children: [
                    { type: "list_item", id: "tab-hoist-child-1", children: [{ type: "paragraph", id: "tab-hoist-child-1-p", children: [{ type: "text", text: "ChildOne" }] }] },
                    { type: "list_item", id: "tab-hoist-child-2", children: [{ type: "paragraph", id: "tab-hoist-child-2-p", children: [{ type: "text", text: "ChildTwo" }] }] },
                  ],
                },
              ],
            },
          ],
        }] },
      });
      const position = runtime.editor.positions.positionOf("tab-hoist-target-p");
      const point = { path: [...position.pos.path, 0], offset: 3 };
      const selection = { type: "text", anchor: point, head: point };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    await page.locator('[contenteditable="true"]').press("Tab");
    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const outer = runtime.editor.document.children[0];
      const sibling = outer.children[0];
      const nested = sibling.children[1];
      return {
        siblingChildCount: sibling.children.length,
        nestedItemIds: nested?.children?.map((n: any) => n.id),
        targetItemChildCount: nested?.children?.[0]?.children?.length,
      };
    });
    expect(result.siblingChildCount).toBe(2);
    expect(result.nestedItemIds).toEqual(["tab-hoist-target", "tab-hoist-child-1", "tab-hoist-child-2"]);
    // The moved item itself no longer carries its former nested list.
    expect(result.targetItemChildCount).toBe(1);
  });

  test("keeps keyboard focus inside the editor when Tab has no legal indent to apply", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "tab-focus-doc", children: [{
          type: "list", id: "tab-focus-list", attrs: { style: "decimal" }, children: [
            { type: "list_item", id: "tab-focus-only", children: [{ type: "paragraph", id: "tab-focus-only-p", children: [{ type: "text", text: "First and only" }] }] },
          ],
        }] },
      });
      const position = runtime.editor.positions.positionOf("tab-focus-only-p");
      const point = { path: [...position.pos.path, 0], offset: 3 };
      const selection = { type: "text", anchor: point, head: point };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await editor.focus();
    // The first item of a list has no predecessor to nest under, so indent
    // correctly declines — but Tab must still be absorbed by the editor
    // rather than falling through to native focus navigation.
    await page.keyboard.press("Tab");
    await expect(editor).toBeFocused();
    // Editing still works immediately afterward — focus genuinely never left.
    await page.keyboard.type("!");
    await expect(page.locator('p:has-text("Fir!st and only")')).toBeVisible();
  });

  test("keeps outdent enabled when the selected item reaches maximum legal indent", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number }; setSelection: (selection: unknown, options?: unknown) => void; document: any };
        replaceValue: (value: unknown) => void;
        renderer: { render: (document: unknown, selection: unknown) => void };
      } }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "indent-state-doc", children: [{ type: "list", id: "indent-state-list", attrs: { style: "disc" }, children: [
          { type: "list_item", id: "indent-state-a", children: [{ type: "paragraph", id: "indent-state-a-p", children: [{ type: "text", text: "A" }] }] },
          { type: "list_item", id: "indent-state-b", children: [{ type: "paragraph", id: "indent-state-b-p", children: [{ type: "text", text: "B" }] }] },
          { type: "list_item", id: "indent-state-c", children: [{ type: "paragraph", id: "indent-state-c-p", children: [{ type: "text", text: "C" }] }] },
        ] }] },
      });
      const selection = { type: "text" as const, anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 1, 0], offset: 1 } };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const indent = page.getByRole("button", { name: "Indent list item" });
    const outdent = page.getByRole("button", { name: "Outdent list item" });
    await expect(indent).toBeEnabled();
    await indent.click();
    await expect(indent).toBeDisabled();
    await expect(outdent).toBeEnabled();
    await outdent.click();
    // At depth zero the command remains legal because Phase 3 defines it as
    // the list-unwrapping action. A second click performs that unwrap.
    await expect(outdent).toBeEnabled();
    await outdent.click();
    await expect(outdent).toBeDisabled();
    await expect(indent).toBeDisabled();
  });

  test("keeps outdent enabled for a contiguous multi-item selection at maximum indent", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "indent-range-doc", children: [{ type: "list", id: "indent-range-list", attrs: { style: "disc" }, children: [
          { type: "list_item", id: "indent-range-a", children: [{ type: "paragraph", id: "indent-range-a-p", children: [{ type: "text", text: "A" }] }] },
          { type: "list_item", id: "indent-range-b", children: [{ type: "paragraph", id: "indent-range-b-p", children: [{ type: "text", text: "B" }] }] },
          { type: "list_item", id: "indent-range-c", children: [{ type: "paragraph", id: "indent-range-c-p", children: [{ type: "text", text: "C" }] }] },
        ] }] },
      });
      const selection = { type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 2, 0], offset: 1 } };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const indent = page.getByRole("button", { name: "Indent list item" });
    const outdent = page.getByRole("button", { name: "Outdent list item" });
    await expect(indent).toBeEnabled();
    await indent.click();
    await expect(indent).toBeDisabled();
    await expect(outdent).toBeEnabled();
    await expect(page.locator('[data-smart-id="indent-range-a"] > ul > li')).toHaveCount(2);
  });

  test("keeps indent and unwrap-outdent available for a subset at depth zero", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: {
          type: "doc", id: "indent-depth-zero-doc", children: [{
            type: "list", id: "indent-depth-zero-outer", attrs: { style: "disc" }, children: [{
              type: "list_item", id: "indent-depth-zero-parent", children: [
                { type: "paragraph", id: "indent-depth-zero-parent-p", children: [{ type: "text", text: "Parent" }] },
                { type: "list", id: "indent-depth-zero-level-one", attrs: { style: "disc" }, children: [{
                  type: "list_item", id: "indent-depth-zero-level-one-parent", children: [
                    { type: "paragraph", id: "indent-depth-zero-level-one-parent-p", children: [{ type: "text", text: "Level one" }] },
                    { type: "list", id: "indent-depth-zero-level-two", attrs: { style: "disc" }, children: [
                      { type: "list_item", id: "indent-depth-zero-item-b", children: [{ type: "paragraph", id: "indent-depth-zero-item-b-p", children: [{ type: "text", text: "B" }] }] },
                      { type: "list_item", id: "indent-depth-zero-item-c", children: [{ type: "paragraph", id: "indent-depth-zero-item-c-p", children: [{ type: "text", text: "C" }] }] },
                    ] },
                  ],
                }] },
              ],
            }] },
          ],
        },
      });
      const selection = { type: "text" as const, anchor: { path: [0, 0, 1, 0, 1, 0], offset: 0 }, head: { path: [0, 0, 1, 0, 1, 1, 0], offset: 1 } };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const indent = page.getByRole("button", { name: "Indent list item" });
    const outdent = page.getByRole("button", { name: "Outdent list item" });
    await expect(indent).toBeDisabled();
    await expect(outdent).toBeEnabled();
    await outdent.click();
    await expect(outdent).toBeEnabled();
    await expect(indent).toBeEnabled();
    await outdent.click();
    // The selected subset is now at depth zero, still inside the outer list.
    // Both indent and the depth-zero unwrap action remain legal at this point.
    await expect(indent).toBeEnabled();
    await expect(outdent).toBeEnabled();
    const state = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const list = runtime.editor.document.children[0];
      return { scope: runtime.editor.resolveScope({ want: "list-selection" }), listType: list?.type, ids: list?.children?.map((node: any) => node.id), selection: runtime.editor.selection };
    });
    expect(state.listType).toBe("list");
    expect(state.ids).toEqual(["indent-depth-zero-parent", "indent-depth-zero-item-b", "indent-depth-zero-item-c"]);
    expect(state.scope.kind).toBe("list-selection");
  });

  test("keeps the end of a converted code block editable at and away from document end", async ({ page }) => {
    const convertAndPlaceAtEnd = async (withFollowingBlock: boolean) => {
      await page.goto(`/?canonicalAuthority=1&blocks=1`);
      await page.evaluate((withFollowing) => {
        const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
        runtime.replaceValue({
          schemaVersion: runtime.editor.schema.version,
          revision: runtime.editor.state.revision + 1,
          document: { type: "doc", id: withFollowing ? "converted-code-nonfinal-doc" : "converted-code-final-doc", children: [
            { type: "paragraph", id: "converted-code-p", children: [{ type: "text", text: "convert me" }] },
            ...(withFollowing ? [{ type: "paragraph", id: "converted-code-after", children: [{ type: "text", text: "after" }] }] : []),
          ] },
        });
      }, withFollowingBlock);
      await selectFirstText(page);
      await page.getByRole("combobox", { name: "Block type" }).selectOption("code_block");
      await expect(page.locator('[data-smart-type="code_block"]')).toHaveCount(1);
      await placeCaret(page, '[data-smart-type="code_block"]', true);
      const beforeTyping = await page.evaluate(() => {
        const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
        const selection = window.getSelection();
        return { type: runtime.editor.document.children[0].type, selection: runtime.editor.selection, nativeCollapsed: selection?.isCollapsed };
      });
      expect(beforeTyping.type).toBe("code_block");
      expect(beforeTyping.selection.head).toEqual({ path: [0], offset: 10 });
      expect(beforeTyping.nativeCollapsed).toBe(true);
      await page.keyboard.type("!");
      const afterTyping = await page.evaluate(() => {
        const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
        return { text: runtime.editor.document.children[0].children?.map((node: any) => node.text || "").join(""), selection: runtime.editor.selection };
      });
      expect(afterTyping.text).toBe("convert me!");
      expect(afterTyping.selection.head).toEqual({ path: [0], offset: 11 });
      if (withFollowingBlock) {
        const following = await page.evaluate(() => (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!.editor.document.children[1]);
        expect(following).toMatchObject({ id: "converted-code-after", type: "paragraph" });
      }
    };
    await convertAndPlaceAtEnd(false);
    await convertAndPlaceAtEnd(true);
  });

  test("keeps mixed list-scope indent and outdent actions available after a partial unwrap", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "mixed-indent-doc", children: [
          { type: "list", id: "mixed-indent-list", attrs: { style: "decimal" }, children: [
            { type: "list_item", id: "mixed-indent-top", children: [
              { type: "paragraph", id: "mixed-indent-top-p", children: [{ type: "text", text: "Top item" }] },
              { type: "list", id: "mixed-indent-level-one", attrs: { style: "decimal" }, children: [
                { type: "list_item", id: "mixed-indent-one", children: [
                  { type: "paragraph", id: "mixed-indent-one-p", children: [{ type: "text", text: "One" }] },
                  { type: "list", id: "mixed-indent-level-two", attrs: { style: "decimal" }, children: [
                    { type: "list_item", id: "mixed-indent-two-before", children: [{ type: "paragraph", id: "mixed-indent-two-before-p", children: [{ type: "text", text: "Two before" }] }] },
                    { type: "list_item", id: "mixed-indent-two-a", children: [{ type: "paragraph", id: "mixed-indent-two-a-p", children: [{ type: "text", text: "Two A" }] }] },
                    { type: "list_item", id: "mixed-indent-two-b", children: [{ type: "paragraph", id: "mixed-indent-two-b-p", children: [{ type: "text", text: "Two B" }] }] },
                  ] },
                ], },
                { type: "list_item", id: "mixed-indent-one-tail", children: [{ type: "paragraph", id: "mixed-indent-one-tail-p", children: [{ type: "text", text: "One tail" }] }] },
              ] },
            ] },
            { type: "list_item", id: "mixed-indent-after", children: [{ type: "paragraph", id: "mixed-indent-after-p", children: [{ type: "text", text: "After" }] }] },
          ] },
        ] },
      });
      const selection = { type: "text" as const, anchor: { path: [0, 0, 1, 0, 1, 1, 0], offset: 0 }, head: { path: [0, 0, 1, 1, 0], offset: 8 } };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const indent = page.getByRole("button", { name: "Indent list item" });
    const outdent = page.getByRole("button", { name: "Outdent list item" });
    await expect(outdent).toBeEnabled();
    await outdent.click();
    await expect(outdent).toBeEnabled();
    await outdent.click();
    const state = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const scope = runtime.editor.resolveScope({ want: "list-selection" });
      return {
        scopeKind: scope.kind,
        parts: scope.kind === "mixed" ? scope.parts.map((part: any) => ({ kind: part.kind, listId: part.listId, items: part.items?.map((item: any) => item.itemId), blockIds: part.blockIds })) : [],
        root: runtime.editor.document.children?.map((node: any) => ({ id: node.id, type: node.type, children: node.children?.map((child: any) => ({ id: child.id, type: child.type, children: child.children?.map((grand: any) => ({ id: grand.id, type: grand.type })) })) })),
        selection: runtime.editor.selection,
      };
    });
    expect(state.scopeKind).toBe("mixed");
    expect(state.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "list-selection", listId: "mixed-indent-level-two" }),
      expect.objectContaining({ kind: "block-range", blockIds: ["mixed-indent-one-tail-p"] }),
    ]));
    const rootTypes = (state.root || []).map((node: { type: string }) => node.type);
    expect(rootTypes).toEqual(expect.arrayContaining(["paragraph", "list"]));
    // Mixed scopes follow the Phase 3 policy: list parts remain actionable;
    // plain blocks are ignored rather than disabling the whole toolbar.
    await expect(indent).toBeEnabled();
    await expect(outdent).toBeEnabled();
    await indent.click();
    expect(await page.locator('[data-smart-authority="canonical"] [data-smart-type="list"]').count()).toBeGreaterThanOrEqual(2);
    const selectedIds = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const find = (node: any): string[] => node?.type === "text" ? [] : [node?.id, ...(node?.children || []).flatMap(find)];
      return find(runtime.editor.document);
    });
    expect(selectedIds).toEqual(expect.arrayContaining(["mixed-indent-two-a", "mixed-indent-two-b", "mixed-indent-one-tail-p"]));
  });

  test("tracks the Block type dropdown with the current caret owner", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "dropdown-sync-doc", children: [
          { type: "paragraph", id: "dropdown-paragraph", children: [{ type: "text", text: "Paragraph" }] },
          { type: "heading", id: "dropdown-heading", attrs: { level: 2 }, children: [{ type: "text", text: "Heading" }] },
          { type: "code_block", id: "dropdown-code", children: [{ type: "text", text: "Code" }] },
        ] },
      });
    });
    const dropdown = page.getByRole("combobox", { name: "Block type" });
    await placeCaretInTopLevelBlock(page, 0);
    await expect(dropdown).toHaveValue("paragraph");
    await placeCaretInTopLevelBlock(page, 1);
    await expect(dropdown).toHaveValue("heading-2");
    await placeCaretInTopLevelBlock(page, 2, true);
    await expect(dropdown).toHaveValue("code_block");
    await placeCaretInTopLevelBlock(page, 0, true);
    await expect(dropdown).toHaveValue("paragraph");
  });

  test("tracks the Block type dropdown for a code block nested inside a blockquote", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "nested-dropdown-doc", children: [
          { type: "blockquote", id: "nested-dropdown-quote", children: [
            { type: "code_block", id: "nested-dropdown-code", children: [{ type: "text", text: "Code" }] },
          ] },
        ] },
      });
    });
    const dropdown = page.getByRole("combobox", { name: "Block type" });
    await placeCaret(page, '[data-smart-id="nested-dropdown-code"]', true);
    await expect(dropdown).toHaveValue("code_block");
  });

  test("toggles checklist controls and has no default checkbox outline", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "check-toggle-doc", children: [{
          type: "list", id: "check-toggle-list", attrs: { style: "disc", checkable: true }, children: [
            { type: "list_item", id: "check-toggle-item", attrs: { checked: false }, children: [{ type: "paragraph", id: "check-toggle-p", children: [{ type: "text", text: "Task" }] }] },
          ],
        }] },
      });
    });
    const checkbox = page.locator('[data-smart-ui="check-control"]');
    await expect(checkbox).toHaveAttribute("aria-checked", "false");
    const initialStyle = await checkbox.evaluate((element) => {
      const style = getComputedStyle(element);
      const before = getComputedStyle(element, "::before");
      return { border: style.borderStyle, outline: style.outlineStyle, pseudoBorder: before.borderStyle };
    });
    expect(initialStyle.border).toBe("none");
    expect(initialStyle.outline).toBe("none");
    expect(initialStyle.pseudoBorder).toBe("solid");
    const box = await checkbox.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click((box?.x || 0) + (box?.width || 0) / 2, (box?.y || 0) + (box?.height || 0) / 2);
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await expect(checkbox).toHaveAttribute("aria-label", "Mark incomplete");
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "false");
  });

  test("toggles a checklist through the projected checkbox after toolbar creation", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await selectFirstText(page);
    await page.getByRole("button", { name: "Checklist", exact: true }).click();
    const checkbox = page.locator('[data-smart-ui="check-control"]');
    await expect(checkbox).toHaveCount(1);
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "false");
  });

  test("shows the active list toggle and removes only the current item on re-click", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "toggle-off-doc", children: [{
          type: "list", id: "toggle-off-list", attrs: { style: "disc" }, children: ["first", "second", "third"].map((label, index) => ({
            type: "list_item", id: `toggle-off-item-${index}`, children: [{ type: "paragraph", id: `toggle-off-p-${index}`, children: [{ type: "text", text: label }] }],
          })),
        }] },
      });
      const position = runtime.editor.positions.positionOf("toggle-off-p-2");
      const point = { path: [...position.pos.path, 0], offset: 0 };
      const selection = { type: "text", anchor: point, head: point };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const bullets = page.getByRole("button", { name: "Bulleted list", exact: true });
    await expect(bullets).toHaveAttribute("aria-pressed", "true");
    await bullets.click();
    await expect(bullets).toHaveAttribute("aria-pressed", "false");
    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const list = runtime.editor.document.children.find((node: any) => node.id === "toggle-off-list");
      return {
        rootTypes: runtime.editor.document.children.map((node: any) => node.type),
        listItemIds: list?.children?.map((node: any) => node.id),
      };
    });
    expect(result.rootTypes).toEqual(["list", "paragraph"]);
    expect(result.listItemIds).toEqual(["toggle-off-item-0", "toggle-off-item-1"]);
    await expect(page.locator('[data-smart-authority="canonical"] [contenteditable="true"] > p')).toHaveText("third");
  });

  test("reconstructs nesting after unwrapping a nested item and re-listing it", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "nest-roundtrip-doc", children: [{
          type: "list", id: "nest-roundtrip-outer", attrs: { style: "disc" }, children: [{
            type: "list_item", id: "nest-roundtrip-parent", children: [
              { type: "paragraph", id: "nest-roundtrip-parent-p", children: [{ type: "text", text: "Parent" }] },
              { type: "list", id: "nest-roundtrip-inner", attrs: { style: "disc" }, children: [{
                type: "list_item", id: "nest-roundtrip-child", children: [{ type: "paragraph", id: "nest-roundtrip-child-p", children: [{ type: "text", text: "Child" }] }],
              }] },
            ],
          }],
        }] },
      });
      const point = { path: [0, 0, 1, 0, 0], offset: 0 };
      const selection = { type: "text", anchor: point, head: point };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const bullets = page.getByRole("button", { name: "Bulleted list", exact: true });
    // First unwrap: toggle off the deep (Child) item only.
    await expect(bullets).toHaveAttribute("aria-pressed", "true");
    await bullets.click();
    // Second unwrap: cursor lands on the remaining Parent item, which is
    // still an active bulleted list of one item containing both paragraphs
    // — toggle it off too, so both paragraphs become true top-level content.
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const point = { path: [0, 0, 0], offset: 0 };
      const selection = { type: "text", anchor: point, head: point };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    await expect(bullets).toHaveAttribute("aria-pressed", "true");
    await bullets.click();
    const afterUnwrap = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      return {
        rootTypes: runtime.editor.document.children.map((node: any) => node.type),
        childIndent: runtime.editor.document.children[1]?.attrs?.indentLevel,
      };
    });
    expect(afterUnwrap.rootTypes).toEqual(["paragraph", "paragraph"]);
    expect(afterUnwrap.childIndent).toBe(1);

    // Select both top-level paragraphs and rebuild a list from them.
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const selection = {
        type: "text",
        anchor: { path: [0], offset: 0 },
        head: { path: [1], offset: 5 },
      };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    await bullets.click();
    const rebuilt = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const outerList = runtime.editor.document.children[0];
      const parentItem = outerList?.children?.[0];
      const innerList = parentItem?.children?.[1];
      const childItem = innerList?.children?.[0];
      return {
        rootTypes: runtime.editor.document.children.map((node: any) => node.type),
        parentText: parentItem?.children?.[0]?.children?.[0]?.text,
        parentIndent: parentItem?.children?.[0]?.attrs?.indentLevel,
        innerType: innerList?.type,
        childText: childItem?.children?.[0]?.children?.[0]?.text,
        childIndent: childItem?.children?.[0]?.attrs?.indentLevel,
      };
    });
    expect(rebuilt.rootTypes).toEqual(["list"]);
    expect(rebuilt.parentText).toBe("Parent");
    expect(rebuilt.parentIndent).toBeUndefined();
    expect(rebuilt.innerType).toBe("list");
    expect(rebuilt.childText).toBe("Child");
    expect(rebuilt.childIndent).toBeUndefined();
  });

  test("deletes multi-item list and block-level selections with Delete", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "delete-product-doc", children: [
          { type: "list", id: "delete-product-list", attrs: { style: "disc" }, children: [0, 1, 2, 3].map((index) => ({
            type: "list_item", id: `delete-product-item-${index}`, children: [{ type: "paragraph", id: `delete-product-p-${index}`, children: [{ type: "text", text: `item ${index}` }] }],
          })) },
          { type: "blockquote", id: "delete-product-quote", children: [{ type: "paragraph", id: "delete-product-quote-p", children: [{ type: "text", text: "quote" }] }] },
          { type: "code_block", id: "delete-product-code", children: [{ type: "text", text: "code" }] },
          { type: "paragraph", id: "delete-product-after", children: [{ type: "text", text: "after" }] },
        ] },
      });
      const dispatch = () => root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentForward" }));
      const listSelection = { type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 2, 0], offset: 6 } };
      runtime.editor.setSelection(listSelection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, listSelection);
      dispatch();
      const list = runtime.editor.document.children.find((node: any) => node.id === "delete-product-list");
      const listIds = list?.children?.map((node: any) => node.id);
      const selectNode = (id: string) => {
        const position = runtime.editor.positions.positionOf(id);
        if (!position) throw new Error(`Missing ${id}`);
        const selection = { type: "node", anchor: position.pos, head: { path: [...position.pos.path], offset: position.pos.offset + 1 } };
        runtime.editor.setSelection(selection, { source: "api" });
        runtime.renderer.render(runtime.editor.document, selection);
        dispatch();
      };
      selectNode("delete-product-quote");
      const quoteExistsAfterDelete = runtime.editor.positions.exists("delete-product-quote");
      selectNode("delete-product-code");
      return { listIds, quoteExistsAfterDelete, codeExistsAfterDelete: runtime.editor.positions.exists("delete-product-code") };
    });
    expect(result.listIds).toEqual(["delete-product-item-0", "delete-product-item-3"]);
    expect(result.quoteExistsAfterDelete).toBe(false);
    expect(result.codeExistsAfterDelete).toBe(false);
  });

  test("deletes only the natively selected subset of list items", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "native-delete-doc", children: [{
          type: "list", id: "native-delete-list", attrs: { style: "decimal" }, children: Array.from({ length: 5 }, (_, index) => ({
            type: "list_item", id: `native-delete-item-${index}`, children: [{ type: "paragraph", id: `native-delete-p-${index}`, children: [{ type: "text", text: `item ${index}` }] }],
          })),
        }] },
      });
      const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      const items = Array.from(root.querySelectorAll<HTMLElement>("[data-smart-type=\"list_item\"]"));
      const start = items[1].querySelector("p")?.firstChild;
      const end = items[3].querySelector("p")?.firstChild;
      if (!start || !end) throw new Error("Native subset fixture did not render list text.");
      const range = document.createRange();
      range.setStart(start, 0);
      range.setEnd(end, 0);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      root.focus();
    });
    await page.keyboard.press("Delete");
    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const list = runtime.editor.document.children.find((node: any) => node.id === "native-delete-list");
      return { ids: list?.children?.map((node: any) => node.id), text: list?.children?.map((node: any) => node.children?.[0]?.children?.[0]?.text) };
    });
    expect(result.ids).toEqual(["native-delete-item-0", "native-delete-item-3", "native-delete-item-4"]);
    expect(result.text).toEqual(["item 0", "item 3", "item 4"]);
  });

  test("offers list creation after outdent unwraps a nested item", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "unwrap-indent-doc", children: [{
          type: "list", id: "unwrap-indent-list", attrs: { style: "disc" }, children: [{
            type: "list_item", id: "unwrap-indent-parent", children: [
              { type: "paragraph", id: "unwrap-indent-parent-p", children: [{ type: "text", text: "Parent" }] },
              { type: "list", id: "unwrap-indent-nested", attrs: { style: "disc" }, children: [{
                type: "list_item", id: "unwrap-indent-child", children: [{ type: "paragraph", id: "unwrap-indent-child-p", children: [{ type: "text", text: "Child" }] }],
              }] },
            ],
          }],
        }] },
      });
      const selection = { type: "text" as const, anchor: { path: [0, 0, 1, 0, 0], offset: 0 }, head: { path: [0, 0, 1, 0, 0], offset: 5 } };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const outdent = page.getByRole("button", { name: "Outdent list item" });
    await expect(outdent).toBeEnabled();
    await outdent.click();
    await expect(outdent).toBeEnabled();
    await outdent.click();

    const indent = page.getByRole("button", { name: "Indent list item" });
    const bullets = page.getByRole("button", { name: "Bulleted list" });
    await expect(indent).toBeDisabled();
    await expect(bullets).toBeEnabled();
    await bullets.click();
    const childListItem = page.locator('[data-smart-authority="canonical"] [contenteditable="true"] > ul > li').filter({ hasText: "Child" });
    await expect(childListItem).toHaveCount(1);
  });

  test("preserves marks and later structure across an Enter split", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const before = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number }; setSelection: (selection: unknown, options?: unknown) => void; document: unknown };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: {
          type: "doc", id: "enter-mark-doc", children: [
            { type: "paragraph", id: "enter-mark-p", children: [
              { type: "text", text: "large", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }] },
              { type: "text", text: "tail", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }, { type: "textColor", attrs: { value: "#ff0000" } }] },
            ] },
            { type: "paragraph", id: "enter-mark-below", children: [{ type: "text", text: "untouched" }] },
          ],
        },
      });
      runtime.editor.setSelection({ type: "text", anchor: { path: [0], offset: 3 }, head: { path: [0], offset: 3 } }, { source: "api" });
    });
    await page.keyboard.press("Enter");
    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ id: string; type: string; children?: Array<{ text?: string; marks?: unknown[] }> }> }; selection: { head: { path: number[]; offset: number } } };
      } }).__smartProductCanonical!;
      return {
        children: runtime.editor.document.children,
        selection: runtime.editor.selection,
      };
    });
    expect(result.children[0].children).toEqual([{ type: "text", text: "lar", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }] }]);
    expect(result.children[1].children).toEqual([
      { type: "text", text: "ge", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }] },
      { type: "text", text: "tail", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }, { type: "textColor", attrs: { value: "#ff0000" } }] },
    ]);
    expect(result.children[2]).toMatchObject({ id: "enter-mark-below", type: "paragraph", children: [{ text: "untouched" }] });
    expect(result.selection.head).toEqual({ path: [1], offset: 0 });
  });

  test("keeps code-block Enter as a newline inside a blockquote", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number }; positions: { contentRangeOf: (id: string) => { from: { path: number[] } } | null }; setSelection: (selection: unknown, options?: unknown) => void; document: any; selection: unknown };
        replaceValue: (value: unknown) => void;
        renderer: { render: (document: unknown, selection: unknown) => void };
      } }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: {
          type: "doc", id: "quoted-code-browser-doc", children: [{
            type: "blockquote", id: "quoted-code-browser-quote", children: [{
              type: "code_block", id: "quoted-code-browser", attrs: { language: "ts" }, children: [{ type: "text", text: "abc" }],
            }],
          }],
        },
      });
      const range = runtime.editor.positions.contentRangeOf("quoted-code-browser");
      if (!range) throw new Error("Code block content range was not indexed");
      const selection = { type: "text" as const, anchor: { path: [...range.from.path], offset: 1 }, head: { path: [...range.from.path], offset: 1 } };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    await page.keyboard.press("Enter");
    const result = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: any; selection: any } } }).__smartProductCanonical!;
      const quote = runtime.editor.document.children.find((node: any) => node.id === "quoted-code-browser-quote");
      const code = quote?.children?.find((node: any) => node.id === "quoted-code-browser");
      return { text: code?.children?.map((child: any) => child.text || "").join(""), quoteChildren: quote?.children?.map((node: any) => node.type), selection: runtime.editor.selection.head };
    });
    expect(result.text).toBe("a\nbc");
    expect(result.quoteChildren).toEqual(["code_block"]);
  });

  test("keeps checklist controls beside top-level and nested item content", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { schema: any; state: any }; replaceValue: (value: unknown) => void } }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "check-css-doc", children: [{
          type: "list", id: "check-css-list", attrs: { style: "disc", checkable: true }, children: [
            { type: "list_item", id: "check-css-top", attrs: { checked: false }, children: [
              { type: "paragraph", id: "check-css-top-p", children: [{ type: "text", text: "Top task" }] },
              { type: "list", id: "check-css-nested-list", attrs: { style: "disc", checkable: true }, children: [{
                type: "list_item", id: "check-css-nested", attrs: { checked: false }, children: [
                  { type: "paragraph", id: "check-css-nested-p", children: [{ type: "text", text: "Nested task" }] },
                ],
              }] },
            ] },
          ],
        }] },
      });
    });
    const boxes = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-smart-ui="check-control"]')].map((control) => {
      const item = control.parentElement!;
      const content = item.querySelector<HTMLElement>(":scope > p")!;
      const controlRect = control.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        gap: contentRect.left - controlRect.right,
        control: getComputedStyle(control).gridColumn,
        content: getComputedStyle(content).gridColumn,
      };
    }));
    expect(boxes).toHaveLength(2);
    boxes.forEach((box) => {
      expect(box.gap).toBeGreaterThanOrEqual(0);
      expect(box.control).toBe("1");
      expect(box.content).toBe("2");
    });
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
