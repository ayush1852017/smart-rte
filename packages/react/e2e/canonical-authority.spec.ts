import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { insertDefaultTable, openToolbarDropdown, toolbarMenuItem } from "./toolbarHelpers.js";
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

// Phase 11.5 §2.1: image insertion now opens MediaManager ("Media library")
// by default instead of the simple DefaultMediaPicker ("Choose image");
// video/audio are unaffected.
const chooseMedia = async (page: import("@playwright/test").Page, kind: "image" | "video" | "audio", name: string, mimeType: string) => {
  const picker = page.getByRole("dialog", { name: kind === "image" ? "Media library" : `Choose ${kind}` });
  await picker.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: Buffer.from(`${kind}-generated-session`) });
  await expect(picker).toHaveCount(0);
};

// The color popover's native <input type="color"> was replaced by an
// in-page saturation/value square + hue slider (docs/bugs - "no click
// needed" redesign) specifically so the drag surface is visible on the
// popover's first click, and so every drag frame is a real page-owned
// pointer event instead of an opaque OS dialog's own events. There is no
// Apply button anymore: typing a valid hex (or dragging the square/slider,
// or clicking a recent swatch) stages a live preview, and closing the
// popover *any* way other than the explicit Discard button - outside
// click, Escape, the × button - commits whatever is staged. Escape is the
// simplest, position-independent way to commit in a test.
const pickColor = async (page: import("@playwright/test").Page, hex: string) => {
  await page.locator("[data-srte-color-hex-input]").fill(hex);
  await page.keyboard.press("Escape");
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
    // Direction B toolbar redesign moved most of these tools into a
    // per-group dropdown (see toolbarHelpers.ts) - this map lets every
    // existing `button("X")` call site below keep working unchanged except
    // for the handful of tools that were also relabeled (Inline code->Code,
    // Remove row/column/table->Delete row/column/table, the atom-resize
    // labels, Track changes->Show edits, Suggest block removal->Suggest
    // removing this).
    const dropdownOf: Record<string, string> = {
      Code: "More text styles", Superscript: "More text styles", Subscript: "More text styles", "Text colour": "More text styles", "Background colour": "More text styles",
      "Font size": "More text styles", "Font family": "More text styles",
      "Move block up": "More paragraph tools", "Move block down": "More paragraph tools", "Indent block": "More paragraph tools", "Outdent block": "More paragraph tools",
      "Indent list item": "More list tools", "Outdent list item": "More list tools", "Move item up": "More list tools", "Move item down": "More list tools",
      "Check selected items": "More list tools", "Restart numbering": "More list tools", "Continue numbering": "More list tools",
      "Merge cells": "Table tools", "Split cell": "Table tools", "Add row": "Table tools", "Delete row": "Table tools", "Add column": "Table tools", "Delete column": "Table tools",
      "Header row": "Table tools", "Move row up": "Table tools", "Move row down": "Table tools", "Move column left": "Table tools", "Move column right": "Table tools", "Delete table": "Table tools",
      "Insert video": "More to insert", "Insert audio": "More to insert", "Insert formula": "More to insert", "Remove link": "More to insert",
      "Enlarge selected media": "More to insert", "Shrink selected media": "More to insert", "Edit selected media": "More to insert", "Delete selected media": "More to insert",
    };
    const button = (rawName: string): Intent["run"] => {
      const rename: Record<string, string> = {
        "Inline code": "Code", "Remove row": "Delete row", "Remove column": "Delete column", "Remove table": "Delete table",
        "Grow selected atom": "Enlarge selected media", "Shrink selected atom": "Shrink selected media",
        "Edit selected atom": "Edit selected media", "Delete selected atom": "Delete selected media",
      };
      const name = rename[rawName] ?? rawName;
      return async (currentPage) => {
        const dropdown = dropdownOf[name];
        if (dropdown) await openToolbarDropdown(currentPage, dropdown);
        await (dropdown ? toolbarMenuItem(currentPage, name) : currentPage.getByRole("button", { name, exact: true })).click();
      };
    };
    const markSession: Intent[] = [
      { name: "mark.bold", run: async (currentPage) => { await selectFirstText(currentPage); await button("Bold")(currentPage); } },
      { name: "mark.italic", run: button("Italic") },
      { name: "mark.underline", run: button("Underline") },
      { name: "mark.strike", run: button("Strikethrough") },
      { name: "mark.code", run: button("Inline code") },
      { name: "mark.superscript", run: button("Superscript") },
      { name: "mark.subscript", run: button("Subscript") },
      { name: "mark.textColor", run: async (currentPage) => {
        await openToolbarDropdown(currentPage, "More text styles");
        await toolbarMenuItem(currentPage, "Text colour").click();
        await currentPage.locator("[data-srte-color-hex-input]").fill("#336699");
        await currentPage.keyboard.press("Escape");
      } },
      { name: "mark.backgroundColor", run: async (currentPage) => {
        await openToolbarDropdown(currentPage, "More text styles");
        await toolbarMenuItem(currentPage, "Background colour").click();
        await currentPage.locator("[data-srte-color-hex-input]").fill("#336699");
        await currentPage.keyboard.press("Escape");
      } },
      { name: "mark.fontSize", run: button("Font size") },
      { name: "mark.fontFamily", run: button("Font family") },
      { name: "mark.link", run: async (currentPage) => {
        await currentPage.getByRole("button", { name: "Insert or edit link", exact: true }).click();
        await currentPage.locator("[data-srte-link-href-input]").fill("https://generated.example.test");
        const textInput = currentPage.locator("[data-srte-link-text-input]");
        if (await textInput.count()) await textInput.fill("Generated link");
        await currentPage.getByRole("button", { name: /^(Insert|Update)$/, exact: true }).click();
      } },
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
      { name: "list.setPreset", run: async (currentPage) => { await openToolbarDropdown(currentPage, "More list tools"); await currentPage.getByRole("combobox", { name: "List preset" }).selectOption("bullet-diamond"); } },
      // Was `button("Bulleted list")` - since the list-toggle-off fix
      // (docs/bugs/list-toggle-off-fails-after-preset-change.md) compares by
      // effective kind (bullet/ordered) rather than a literal style string,
      // clicking "Bulleted list" while already on a bullet-family preset is
      // now correctly a toggle-*off* (unwraps the list), not a "reset to
      // plain disc" restyle - so this intent switches to a genuinely
      // different kind (ordered) instead, to keep exercising "change list
      // style" rather than accidentally exercising "remove the list" here,
      // and to leave a real list in place for list.indent right after.
      { name: "list.setStyle", run: button("Numbered list") },
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
      { name: "table.insert", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p'); await insertDefaultTable(currentPage); } },
      { name: "table.mergeCells", run: async (currentPage) => { const table = currentPage.locator('[data-smart-authority="canonical"] [contenteditable="true"] table'); await selectCellRange(currentPage, table.locator("tr").first().locator("td,th").nth(0), table.locator("tr").first().locator("td,th").nth(1)); await expect(currentPage.locator('[data-smart-cell-selected="true"]')).toHaveCount(2); await expect.poll(() => currentPage.evaluate(() => window.__smartProductCanonical?.editor.selection.type)).toBe("cell"); await openToolbarDropdown(currentPage, "Table tools"); await expect(toolbarMenuItem(currentPage, "Merge cells")).toBeEnabled(); await button("Merge cells")(currentPage); await expect(table.locator("tr").first().locator("td,th").first()).toHaveAttribute("colspan", "2"); } },
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
      { name: "atom.resize", run: async (currentPage) => { const image = currentPage.locator('[data-smart-type="block_image"]'); await image.click({ button: "right" }); await currentPage.keyboard.press("Escape"); await button("Grow selected atom")(currentPage); await button("Shrink selected atom")(currentPage); } },
      { name: "atom.update", run: async (currentPage) => { await button("Edit selected atom")(currentPage); } },
      { name: "atom.delete", run: button("Delete selected atom") },
      { name: "atom.insert.video", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true); await button("Insert video")(currentPage); await chooseMedia(currentPage, "video", "generated.mp4", "video/mp4"); } },
      { name: "atom.insert.audio", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true); await button("Insert audio")(currentPage); await chooseMedia(currentPage, "audio", "generated.mp3", "audio/mpeg"); } },
      { name: "atom.insert.formula", run: async (currentPage) => { await placeCaret(currentPage, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true); await button("Insert formula")(currentPage); await currentPage.locator('[data-srte-formula-entry="algebra-quadratic"]').click(); } },
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
      // Link URL and Text/Background colour previously went through
      // window.prompt here; Phase 11.5 wired LinkEditorPopover and
      // ColorPickerPopover instead (see the mark.link/mark.textColor/
      // mark.backgroundColor intents above), so this dialog handler no
      // longer needs those branches.
      const answer = message.includes("Font size") ? "18"
        : message.includes("Font family") ? "Inter"
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

  /**
   * Report: "select-all + Down arrow doesn't reach document end with
   * nested-list content". Two independent, stacked bugs were found chasing
   * this down, both fixed:
   *
   * 1. `surface/input.ts`'s ArrowUp/ArrowDown handler only ever intercepted
   *    a `type: "node"` selection - for the `type: "text"`, non-collapsed
   *    selection Ctrl/Cmd+A produces, it did nothing at all (no
   *    preventDefault), leaving the collapse entirely to native vertical-
   *    arrow behavior. Confirmed unreliable directly: Firefox's native
   *    ArrowUp-after-select-all collapses to the wrong position for *any*
   *    document content, not just lists (see the parameterized test below).
   *    Fixed by explicitly collapsing a genuine whole-document selection
   *    (detected via the same `isWholeDocumentRange` helper the
   *    select-all-delete fix already uses) to the true first/last editable
   *    position, via the same document-order `editableOwners` walk
   *    `moveCaret` already uses for cross-container navigation.
   *
   * 2. The actual proximate cause of the *reported* symptom in Chromium/
   *    WebKit turned out to be one level upstream of (1) entirely: native
   *    Ctrl/Cmd+A itself silently selected nothing (collapsed to the
   *    document start) as soon as the document contained a list - not
   *    nesting specifically, any list item, confirmed by bisection. Traced
   *    to `announceSelectedLevel` in `surface/renderer.ts`, which appends a
   *    visually-hidden `contenteditable="false"` ARIA live-region
   *    announcer as a *child of the contenteditable root itself* the first
   *    time any list item's depth changes (i.e. as soon as a list exists).
   *    A contenteditable="false" island inside a contenteditable="true"
   *    root is a known trigger for exactly this kind of native select-all
   *    misbehavior in Chromium/WebKit (shared engine ancestry - Firefox,
   *    independently implemented, was unaffected). Fixed by appending the
   *    live region to the root's *parent* instead - it never needed DOM
   *    proximity to the editable content to be announced correctly.
   *
   * The parameterized test directly below exercises fix (1) in isolation,
   * via a real native Ctrl/Cmd+A across plain content, a flat list, and a
   * nested list, confirming nesting depth is not what mattered for this
   * layer (all three collapse correctly with fix (1) alone). The test after
   * it ("reproduces via real typing...") is the literal reported repro -
   * type, create a list, Tab to nest, select-all, arrow - and is the one
   * that actually depends on fix (2): it fails in Chromium/WebKit without
   * it even with fix (1) present, because Ctrl+A never produces a
   * non-collapsed selection for fix (1) to act on in the first place.
   */
  for (const shape of ["plain content", "a flat (non-nested) list", "a nested list"] as const) {
    test(`select-all + ArrowDown/ArrowUp collapses to the true document end/start with ${shape}`, async ({ page }) => {
      await page.goto("/?canonicalAuthority=1&blocks=1");
      await page.evaluate((shape) => {
        const runtime = (window as typeof window & {
          __smartProductCanonical?: {
            editor: { schema: { version: number }; state: { revision: number } };
            replaceValue: (value: unknown) => void;
          };
        }).__smartProductCanonical!;
        const documents: Record<typeof shape, unknown> = {
          "plain content": {
            type: "doc", id: "arrow-plain-doc", children: [
              { type: "paragraph", id: "arrow-plain-p0", children: [{ type: "text", text: "first line" }] },
              { type: "paragraph", id: "arrow-plain-p1", children: [{ type: "text", text: "second line" }] },
            ],
          },
          "a flat (non-nested) list": {
            type: "doc", id: "arrow-flat-doc", children: [
              { type: "paragraph", id: "arrow-flat-p0", children: [{ type: "text", text: "first line" }] },
              { type: "list", id: "arrow-flat-list", attrs: { style: "disc" }, children: [
                { type: "list_item", id: "arrow-flat-item0", children: [{ type: "paragraph", id: "arrow-flat-item0-p", children: [{ type: "text", text: "one" }] }] },
                { type: "list_item", id: "arrow-flat-item1", children: [{ type: "paragraph", id: "arrow-flat-item1-p", children: [{ type: "text", text: "two" }] }] },
              ] },
            ],
          },
          "a nested list": {
            type: "doc", id: "arrow-nested-doc", children: [
              { type: "paragraph", id: "arrow-nested-p0", children: [{ type: "text", text: "first line" }] },
              { type: "list", id: "arrow-nested-list", attrs: { style: "disc" }, children: [
                { type: "list_item", id: "arrow-nested-item0", children: [
                  { type: "paragraph", id: "arrow-nested-item0-p", children: [{ type: "text", text: "one" }] },
                  { type: "list", id: "arrow-nested-inner", attrs: { style: "disc" }, children: [
                    { type: "list_item", id: "arrow-nested-inner-item", children: [{ type: "paragraph", id: "arrow-nested-inner-p", children: [{ type: "text", text: "nested one" }] }] },
                  ] },
                ] },
              ] },
            ],
          },
        };
        runtime.replaceValue({
          schemaVersion: runtime.editor.schema.version,
          revision: runtime.editor.state.revision + 1,
          document: documents[shape],
        });
      }, shape);

      const root = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
      await root.focus();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(25);
      const down = await page.evaluate(() => {
        const runtime = (window as typeof window & { __smartProductCanonical?: {
          editor: { document: { children: Array<{ type: string }> }; selection: { type: string; head: { path: number[]; offset: number } } };
        } }).__smartProductCanonical!;
        return { children: runtime.editor.document.children, selection: runtime.editor.selection };
      });
      expect(down.selection.type).toBe("text");
      // The true last editable position: for "plain content" that's the
      // last top-level paragraph's own text length; for both list shapes
      // it's the last paragraph in *document order* reached by walking
      // into the (possibly nested) list, not a paragraph at the top level.
      const lastTopLevel = down.children.length - 1;
      if (shape === "plain content") {
        expect(down.selection.head).toEqual({ path: [lastTopLevel], offset: "second line".length });
      } else if (shape === "a flat (non-nested) list") {
        expect(down.selection.head).toEqual({ path: [lastTopLevel, 1, 0], offset: "two".length });
      } else {
        expect(down.selection.head).toEqual({ path: [lastTopLevel, 0, 1, 0, 0], offset: "nested one".length });
      }

      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(25);
      const up = await page.evaluate(() => (window as typeof window & {
        __smartProductCanonical?: { editor: { selection: { type: string; head: { path: number[]; offset: number } } } };
      }).__smartProductCanonical!.editor.selection);
      expect(up.type).toBe("text");
      expect(up.head).toEqual({ path: [0], offset: 0 });
    });
  }

  test("reproduces via real typing: select-all + ArrowDown reaches the true end after creating and nesting a list", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const root = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await root.click();
    // Start from a genuinely empty document - the route's default seed
    // content would otherwise confound the repro.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("first line");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second line");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await page.keyboard.type("one");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("nested one");
    await page.waitForTimeout(30);

    // The bug (fix 2, above): without it, this Ctrl/Cmd+A silently selects
    // nothing at all in Chromium/WebKit, as soon as any list exists.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.waitForTimeout(30);
    const nativeSelection = await page.evaluate(() => {
      const selection = window.getSelection();
      return { isCollapsed: selection?.isCollapsed, length: selection?.toString().length ?? 0 };
    });
    expect(nativeSelection.isCollapsed).toBe(false);
    expect(nativeSelection.length).toBeGreaterThan(0);

    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(50);
    const afterDown = await page.evaluate(() => (window as typeof window & {
      __smartProductCanonical?: { editor: { selection: { type: string; head: { path: number[]; offset: number } } } };
    }).__smartProductCanonical!.editor.selection);
    expect(afterDown.type).toBe("text");
    // True document end: inside the nested list item's own paragraph, not
    // "a couple of lines from the top" as originally reported.
    expect(afterDown.head).toEqual({ path: [2, 0, 1, 0, 0], offset: "nested one".length });

    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.waitForTimeout(30);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(50);
    const afterUp = await page.evaluate(() => (window as typeof window & {
      __smartProductCanonical?: { editor: { selection: { type: string; head: { path: number[]; offset: number } } } };
    }).__smartProductCanonical!.editor.selection);
    expect(afterUp.type).toBe("text");
    expect(afterUp.head).toEqual({ path: [0], offset: 0 });
  });

  test("reproduces via real typing: creating even a flat, non-nested list breaks native select-all in Chromium/WebKit", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const root = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await root.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("first line");
    await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await page.waitForTimeout(30);

    // Bisected directly: nesting is not what mattered - the live-region
    // announcer is appended on the *first* list-depth change, which fires
    // the moment any list item exists, flat or nested.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.waitForTimeout(30);
    const nativeSelection = await page.evaluate(() => {
      const selection = window.getSelection();
      return { isCollapsed: selection?.isCollapsed, length: selection?.toString().length ?? 0 };
    });
    expect(nativeSelection.isCollapsed).toBe(false);
    expect(nativeSelection.length).toBeGreaterThan(0);
  });

  test("keeps the list-level-announcement live region outside the contenteditable root", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const root = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await root.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("one");
    await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(30);
    const location = await page.evaluate(() => {
      const editable = document.querySelector('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      const region = document.querySelector('[data-smart-ui="list-level-announcement"]');
      return { insideEditable: region ? editable.contains(region) : null, text: region?.textContent };
    });
    expect(location.text).toBe("List level 2");
    expect(location.insideEditable).toBe(false);
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

  /**
   * "Don't you think if blockquote is applied then it should show as active
   * if cursor is there?" - the Blockquote button never wired up a `pressed`
   * prop at all, so it never reflected caret/selection state, unlike every
   * other toggle button (Bold, Bulleted list, etc.). The detection logic
   * already existed inside toggleBlockquote itself (walk the caret's
   * ancestors for the nearest blockquote) - it just was never surfaced to
   * the button's own display state.
   */
  test("the Blockquote button shows pressed when the caret is inside a blockquote, and un-pressed once it isn't", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const quote = page.getByRole("button", { name: "Blockquote", exact: true });
    await expect(quote).toHaveAttribute("aria-pressed", "false");

    await selectFirstText(page);
    await quote.click();
    await expect(quote).toHaveAttribute("aria-pressed", "true");

    // Moving the caret into a different, non-quoted paragraph un-presses it.
    const root = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await root.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("ArrowDown");
    await expect(quote).toHaveAttribute("aria-pressed", "false");

    // Moving the caret back into the quoted first block re-presses it.
    await selectFirstText(page);
    await expect(quote).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * "Should we conditionally disable not-allowed tools to make it clear in
   * the first place for users?" - code_block declares `marks: ""` (no marks
   * allowed at all), so clicking Bold/Italic/etc. with the caret inside one
   * was previously a fully-clickable, silent no-op. Reuses
   * reportMarkApplication (already built, previously exercised only by
   * core unit tests) to disable each mark tool whenever nothing in the
   * current selection would actually accept it - deliberately "nothing",
   * not "not everything", so a selection spanning both a normal paragraph
   * and a code block still leaves the tool enabled for its allowed half.
   */
  test("mark toolbar tools disable inside a code block (which allows no marks) and re-enable back in a normal paragraph", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const bold = page.getByRole("button", { name: "Bold", exact: true });
    const italic = page.getByRole("button", { name: "Italic", exact: true });
    const link = page.getByRole("button", { name: "Insert or edit link" });

    await selectFirstText(page);
    await expect(bold).toBeEnabled();
    await expect(italic).toBeEnabled();
    await expect(link).toBeEnabled();

    // Convert the first block to a code block via the Block type dropdown.
    await page.getByRole("combobox", { name: "Block type" }).selectOption("code_block");
    await selectFirstText(page);
    await expect(bold).toBeDisabled();
    await expect(italic).toBeDisabled();
    await expect(link).toBeDisabled();

    // Convert back to a paragraph - the tools come back.
    await page.getByRole("combobox", { name: "Block type" }).selectOption("paragraph");
    await selectFirstText(page);
    await expect(bold).toBeEnabled();
    await expect(italic).toBeEnabled();
    await expect(link).toBeEnabled();
  });

  /**
   * Regression (2026-09-11, live report): "I create a number list and press
   * enter twice to takes cursor out from list then again type something
   * there and clicked on number list tool which create new list again
   * instead of becoming one with previous." Expected: typing right after an
   * existing list and re-applying the same list type joins that list as a
   * new trailing item (continuing the numbering), not a second,
   * independently-numbered list sitting right next to the first.
   */
  test("re-applying Numbered list to a paragraph right after an existing numbered list joins it instead of starting a second one", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await surface.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");

    await page.getByRole("button", { name: "Numbered list", exact: true }).click();
    await page.keyboard.type("abcd");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // second Enter exits the list
    await page.waitForTimeout(30);
    await page.keyboard.type("efgh");

    await page.getByRole("button", { name: "Numbered list", exact: true }).click();

    // One list, two items - not two separate single-item lists.
    await expect(surface.locator("ol")).toHaveCount(1);
    await expect(surface.locator("ol > li")).toHaveCount(2);
    await expect(surface.locator("ol > li").nth(0)).toContainText("abcd");
    await expect(surface.locator("ol > li").nth(1)).toContainText("efgh");
  });

  /**
   * Regression (2026-09-11, live report + screenshot): "inside Blockquote I
   * am trying to adding new list item after 4 which is inside code-block.
   * But enter only creating new lines inside of code-block." Pressing Enter
   * at the end of a code-block list item's content should still create a
   * new sibling list item (via the same "type, Enter, Enter" rhythm the
   * editor already uses to exit an empty list item elsewhere) rather than
   * only ever adding lines inside the current item's own code block.
   */
  test("pressing Enter twice at the end of a code-block list item (inside a blockquote) creates a new sibling list item", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await surface.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");

    await page.getByRole("button", { name: "Numbered list", exact: true }).click();
    await page.keyboard.type("item one");
    await page.getByRole("combobox", { name: "Block type" }).selectOption("code_block");
    await page.waitForTimeout(30);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.getByRole("button", { name: "Blockquote", exact: true }).click();
    // Clicking a toolbar button doesn't refocus the editor - click back into
    // the code block's own text and move to its true end before typing.
    await surface.locator("pre").click();
    await page.keyboard.press("End");
    await page.waitForTimeout(30);

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(30);
    await page.keyboard.type("item two");

    await expect(surface.locator("blockquote ol")).toHaveCount(1);
    await expect(surface.locator("blockquote ol > li")).toHaveCount(2);
    // Item 1 stays a clean, single code block - no stray leftover paragraph.
    await expect(surface.locator("blockquote ol > li").nth(0).locator("> *")).toHaveCount(1);
    await expect(surface.locator("blockquote ol > li").nth(0).locator("pre")).toContainText("item one");
    await expect(surface.locator("blockquote ol > li").nth(1)).toContainText("item two");
  });

  /**
   * Regression (2026-09-12, live report): "single enter not adding new
   * line." A code block stores line breaks as literal "\n" characters in
   * its text (unlike a paragraph's explicit hard_break nodes) - a trailing
   * "\n" with nothing rendered after it took up zero extra height under
   * white-space:pre-wrap, so the model was correct but the box never grew
   * and a single Enter looked like a no-op.
   */
  test("pressing Enter once at the end of a code block's content grows the visible box, even though it stays in the code block", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await surface.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");

    await page.keyboard.type("some code");
    await page.getByRole("combobox", { name: "Block type" }).selectOption("code_block");
    await page.waitForTimeout(30);
    await page.keyboard.press("End");

    const pre = surface.locator("pre");
    const before = await pre.evaluate((el) => el.getBoundingClientRect().height);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(30);
    const after = await pre.evaluate((el) => el.getBoundingClientRect().height);

    expect(after).toBeGreaterThan(before);
    await expect(pre).toContainText("some code");
  });

  /**
   * Regression (2026-09-11, live report): "I tried but still it's add new
   * lines every time." Investigation showed the fix above works exactly as
   * designed (a real item 2 is created after two Enters), but that item is
   * necessarily empty, and a bare third Enter (nothing typed yet) looked
   * identical to the editor's own separate, pre-existing "empty item + Enter
   * exits the list" convention - immediately undoing the escape and leaving
   * only plain paragraphs from then on, matching the reported symptom. A
   * third Enter on that still-empty escaped item must now do nothing, so it
   * survives long enough to type into.
   */
  test("a third Enter on the item just escaped from a code block does not exit the list", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await surface.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");

    await page.getByRole("button", { name: "Numbered list", exact: true }).click();
    await page.keyboard.type("item one");
    await page.getByRole("combobox", { name: "Block type" }).selectOption("code_block");
    await page.waitForTimeout(30);
    await page.keyboard.press("End");

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(30);
    await expect(surface.locator("ol > li")).toHaveCount(2);

    await page.keyboard.press("Enter"); // the one-too-many press that used to exit the list
    await page.waitForTimeout(30);
    await expect(surface.locator("ol > li")).toHaveCount(2);
    await expect(surface.locator("ol")).toHaveCount(1);

    await page.keyboard.type("item two");
    await expect(surface.locator("ol > li").nth(1)).toContainText("item two");
  });

  /**
   * Regression (2026-09-10, live report + screenshot): a selection spanning
   * partway into a top-level list item's own paragraph through partway into
   * a *nested sub-list item*, then clicking Blockquote, threw "replaceNode
   * before payload does not match document node." and did nothing - the
   * selection's two ends resolved to two different "nearest list" targets
   * (the outer list and its own nested sub-list), and treating both as
   * independent replacements corrupted the document. Fixed in
   * packages/core's wrapBlocks/unwrapBlocks (dropNestedTargets) - this is
   * the real-browser confirmation that the actual toolbar path (not just
   * the core unit test) no longer throws and produces the correct result.
   */
  test("applies Blockquote to a selection spanning a list item and its own nested sub-list item without throwing", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const root = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await root.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("top item");
    await page.getByRole("button", { name: "Numbered list", exact: true }).click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("nested item");
    await page.waitForTimeout(30);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Select from partway into "top item" through partway into "nested item".
    await page.evaluate(() => {
      const surface = document.querySelector('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) texts.push(node as Text);
      const fromText = texts.find((t) => t.textContent === "top item")!;
      const toText = texts.find((t) => t.textContent === "nested item")!;
      const range = document.createRange();
      range.setStart(fromText, "top ".length);
      range.setEnd(toText, "nested ".length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await page.getByRole("button", { name: "Blockquote", exact: true }).click();
    await page.waitForTimeout(30);

    expect(pageErrors).toEqual([]);
    await expect(root.locator("blockquote")).toHaveCount(1);
    // No data loss - the whole list (both items, full text) survives inside
    // the one blockquote, exactly as the existing "wraps a whole list once"
    // policy already guarantees for a fully-selected list.
    await expect(root.locator("blockquote li")).toHaveCount(2);
    await expect(root.locator("blockquote")).toContainText("top item");
    await expect(root.locator("blockquote")).toContainText("nested item");
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
    await openToolbarDropdown(page, "More paragraph tools");
    await toolbarMenuItem(page, "Move block down").click();
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
      await openToolbarDropdown(page, "More paragraph tools");
      await toolbarMenuItem(page, direction === "down" ? "Move block down" : "Move block up").click();
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
      await openToolbarDropdown(page, "More paragraph tools");
      await toolbarMenuItem(page, index % 2 === 0 ? "Move block down" : "Move block up").click();
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

  /**
   * Post-batch-2 follow-up (user report: "block up and down is working
   * fine unless I select whole line and then do block up and down").
   * Root cause found in surface/input.ts's Home/End key handler: it built
   * a collapsed {anchor: next, head: next} selection unconditionally,
   * completely ignoring event.shiftKey - Shift+Home and Shift+End (the
   * standard "select to line start/end" keyboard gesture) could never
   * actually select anything; every Shift+End just moved the caret to the
   * end exactly like a bare End press, discarding whatever the user had
   * selected. Once nothing was ever really selected via keyboard,
   * "select the whole line, then Block up/down" wasn't operating on the
   * scope the user intended - though the moves themselves, once given an
   * actually-correct selection, already worked (see the "keeps the moved
   * block owner aligned" test above, and the reproduction attempts logged
   * in docs/POST_PHASE_11_5_BUG_BATCH_2_REPORT.md item 7).
   */
  test("Shift+Home and Shift+End actually extend the selection instead of collapsing it", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await placeCaretAtEnd(page);
    const before = await page.evaluate(() => (window as typeof window & {
      __smartProductCanonical?: { editor: { selection: { anchor: { offset: number }; head: { offset: number } } } };
    }).__smartProductCanonical!.editor.selection);
    expect(before.anchor.offset).toBe(before.head.offset);

    await page.keyboard.press("Shift+Home");
    const afterShiftHome = await page.evaluate(() => (window as typeof window & {
      __smartProductCanonical?: { editor: { selection: { anchor: { offset: number }; head: { offset: number } } } };
    }).__smartProductCanonical!.editor.selection);
    // Shift+Home must move only head to the line start, keeping anchor
    // where the caret already was - a real, non-collapsed range.
    expect(afterShiftHome.head.offset).toBe(0);
    expect(afterShiftHome.anchor.offset).toBe(before.anchor.offset);
    expect(afterShiftHome.anchor.offset).not.toBe(afterShiftHome.head.offset);

    await page.keyboard.press("Shift+End");
    const afterShiftEnd = await page.evaluate(() => (window as typeof window & {
      __smartProductCanonical?: { editor: { selection: { anchor: { offset: number }; head: { offset: number } } } };
    }).__smartProductCanonical!.editor.selection);
    // Shift+End must move only head to the line end, still keeping the
    // same anchor from the Shift+Home above (not the original one).
    expect(afterShiftEnd.anchor.offset).toBe(afterShiftHome.anchor.offset);
    expect(afterShiftEnd.head.offset).toBe(before.anchor.offset);

    // Bare (non-Shift) Home/End still collapse, unchanged.
    await page.keyboard.press("End");
    const afterEnd = await page.evaluate(() => (window as typeof window & {
      __smartProductCanonical?: { editor: { selection: { anchor: { offset: number }; head: { offset: number } } } };
    }).__smartProductCanonical!.editor.selection);
    expect(afterEnd.anchor.offset).toBe(afterEnd.head.offset);
  });

  /**
   * Regression (2026-09-15, live report): "Should I expect shift+left arrow
   * and shift+right arrow to select text before and after of the cursor?"
   * moveCaret always collapsed to a fresh caret regardless of Shift - the
   * same bug class as Shift+Home/End above, just never threaded through
   * for plain arrows.
   */
  test("Shift+ArrowLeft and Shift+ArrowRight actually extend the selection instead of moving a collapsed caret", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("hello world");
    await page.keyboard.press("Home");
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight"); // caret after "hello"

    const selectionOf = () => page.evaluate(() => (window as typeof window & {
      __smartProductCanonical?: { editor: { selection: { anchor: { offset: number }; head: { offset: number } } } };
    }).__smartProductCanonical!.editor.selection);

    await page.keyboard.press("Shift+ArrowLeft");
    let selection = await selectionOf();
    expect(selection.anchor.offset).toBe(5);
    expect(selection.head.offset).toBe(4);

    await page.keyboard.press("Shift+ArrowLeft");
    selection = await selectionOf();
    expect(selection.anchor.offset).toBe(5);
    expect(selection.head.offset).toBe(3);

    // Bare (non-Shift) arrow still collapses, unchanged.
    await page.keyboard.press("ArrowRight");
    selection = await selectionOf();
    expect(selection.anchor.offset).toBe(selection.head.offset);

    // Shift+ArrowRight extends forward the same way.
    await page.keyboard.press("Shift+ArrowRight");
    selection = await selectionOf();
    expect(selection.anchor.offset).toBe(5);
    expect(selection.head.offset).toBe(6);
  });

  test("selecting a whole line with Home/Shift+End then repeated Block up moves it correctly", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=3");
    await placeCaretInTopLevelBlock(page, 2, true);
    await page.waitForTimeout(50);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const selected = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ id: string }> }; selection: { anchor: { path: number[]; offset: number }; head: { path: number[]; offset: number } } };
      } }).__smartProductCanonical!;
      return { id: runtime.editor.document.children[runtime.editor.selection.head.path[0]]?.id, selection: runtime.editor.selection };
    });
    expect(selected.selection.anchor.offset).toBe(0);
    expect(selected.selection.anchor.offset).not.toBe(selected.selection.head.offset);

    // First move: correct single-block swap with the preceding sibling,
    // and the selection (still a real range, not just a caret) follows
    // the moved block's identity, matching the moved-owner-alignment test
    // above.
    await openToolbarDropdown(page, "More paragraph tools");
    await toolbarMenuItem(page, "Move block up").click();
    await page.waitForTimeout(50);
    const afterFirstMove = await page.evaluate((id) => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ id: string }> }; selection: { anchor: { path: number[]; offset: number }; head: { path: number[]; offset: number } } };
      } }).__smartProductCanonical!;
      return {
        order: runtime.editor.document.children.map((node) => node.id),
        ownerAtHead: runtime.editor.document.children[runtime.editor.selection.head.path[0]]?.id,
        collapsed: runtime.editor.selection.anchor.offset === runtime.editor.selection.head.offset,
      };
    }, selected.id);
    expect(afterFirstMove.ownerAtHead).toBe(selected.id);
    expect(afterFirstMove.collapsed).toBe(false);
    // Started at index 2 (the last of 3 blocks); one "up" swaps it with
    // its immediate predecessor, landing at index 1 - not scrambled
    // further, matching the originally-reported "1->3->2" (correct) step.
    expect(afterFirstMove.order.indexOf(selected.id)).toBe(1);

    // Second move: the same block keeps moving up by identity, not
    // producing the scrambled order originally reported.
    await openToolbarDropdown(page, "More paragraph tools");
    await toolbarMenuItem(page, "Move block up").click();
    await page.waitForTimeout(50);
    const afterSecondMove = await page.evaluate((id) => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ id: string }> }; selection: { head: { path: number[] } } };
      } }).__smartProductCanonical!;
      return { order: runtime.editor.document.children.map((node) => node.id), ownerAtHead: runtime.editor.document.children[runtime.editor.selection.head.path[0]]?.id };
    }, selected.id);
    expect(afterSecondMove.ownerAtHead).toBe(selected.id);
    expect(afterSecondMove.order[0]).toBe(selected.id);
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
    await openToolbarDropdown(page, "More list tools");
    await toolbarMenuItem(page, "Move item up").click();
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
    await insertDefaultTable(page);
    const table = page.locator('[data-smart-authority="canonical"] [contenteditable="true"] table');
    await expect(table.locator("tr")).toHaveCount(2);

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] table tr:first-of-type td:first-child p', true);
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
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Move row down").click();
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

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] table tr:first-of-type td:first-child p', true);
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
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Move column right").click();
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
    await openToolbarDropdown(page, "More list tools");
    // getByRole's own accessibility-tree computation can lag a tick behind
    // the DOM/CSS state right after a <details> "toggle" event fires (a raw
    // DOM query already sees the select; role-based queries occasionally
    // don't yet) - toBeVisible() auto-retries until it does, unlike the
    // bare .count()/.evaluateAll() below, which resolve once against
    // whatever the accessibility tree currently reports and don't retry.
    // See docs/bugs/list-preset-select-role-query-race-after-dropdown-open.md.
    const listPresetCombobox = page.getByRole("combobox", { name: "List preset" });
    await expect(listPresetCombobox).toBeVisible();
    const optionValues = await listPresetCombobox.locator("option").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).filter(Boolean));
    expect(optionValues).toEqual(presets.map(([preset]) => preset));
    for (const [preset, tag] of presets) {
      await listPresetCombobox.selectOption(preset);
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
    await openToolbarDropdown(page, "More list tools");
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
    await openToolbarDropdown(page, "More list tools");
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

  /**
   * Phase 11 Tier 2: table Tab/Shift+Tab cell-to-cell navigation - a
   * genuinely missing feature before this pass, not just a missing test
   * (surface/input.ts's Tab handler previously fell through to a bare
   * `return` for tables, per the "Tables own Tab navigation" comment that
   * was never backed by any actual navigation code).
   */
  test("Tab and Shift+Tab move cell-to-cell in a table, and Tab past the last cell appends a row", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const placeCaretInCell = async (paragraphId: string) => page.evaluate((id) => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const position = runtime.editor.positions.positionOf(id);
      const point = { path: [...position.pos.path, 0], offset: 0 };
      const selection = { type: "text", anchor: point, head: point };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    }, paragraphId);
    const caretOwner = () => page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const head = runtime.editor.selection.head;
      const node = head.path.reduce((current: any, index: number) => current.children[index], runtime.editor.document);
      return node.id;
    });
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "tab-table-doc", children: [
          { type: "table", id: "tab-table", attrs: { columnWidths: [100, 100] }, children: [
            { type: "table_row", id: "tab-row", children: [
              { type: "table_cell", id: "tab-cell-a", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "tab-cell-a-p", children: [{ type: "text", text: "one" }] }] },
              { type: "table_cell", id: "tab-cell-b", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "tab-cell-b-p", children: [{ type: "text", text: "two" }] }] },
            ] },
          ] },
        ] },
      });
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await editor.focus();

    await placeCaretInCell("tab-cell-a-p");
    await page.keyboard.press("Tab");
    expect(await caretOwner()).toBe("tab-cell-b-p");

    // Tab past the last cell appends a row and lands in its first cell.
    await page.keyboard.press("Tab");
    await expect(editor.locator('[data-smart-type="table_row"]')).toHaveCount(2);
    const newRowOwner = await caretOwner();
    expect(newRowOwner).not.toBe("tab-cell-a-p");
    expect(newRowOwner).not.toBe("tab-cell-b-p");

    await page.keyboard.press("Shift+Tab");
    expect(await caretOwner()).toBe("tab-cell-b-p");
    await page.keyboard.press("Shift+Tab");
    expect(await caretOwner()).toBe("tab-cell-a-p");

    // Shift+Tab at the very first cell is a claimed no-op: focus stays put,
    // no document change, matching the list-item "claim Tab with nothing to
    // do" precedent.
    const beforeShiftTab = await page.evaluate(() => JSON.stringify((window as any).__smartProductCanonical.editor.document));
    await page.keyboard.press("Shift+Tab");
    expect(await caretOwner()).toBe("tab-cell-a-p");
    expect(await page.evaluate(() => JSON.stringify((window as any).__smartProductCanonical.editor.document))).toBe(beforeShiftTab);
  });

  /**
   * A nested list inside a table cell puts two Tab contributions in
   * conflict: list.indent (nest the item deeper) and table cell-to-cell
   * navigation. `input.ts`'s Tab handler deliberately has `inTable`
   * short-circuit list.indent/outdent whenever the caret's scope reports
   * it's inside a table cell, "even when a list is nested inside that
   * cell" (see the handler's own comment) - table navigation always wins.
   * This exact combination (nested list + Tab, not just a plain cell, and
   * not just list indent outside a table) had no dedicated regression
   * test before this one.
   */
  test("Tab on a nested list item inside a table cell moves to the next cell instead of indenting", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "nested-list-tab-doc", children: [
          { type: "table", id: "nested-list-tab-table", attrs: { columnWidths: [150, 150] }, children: [
            { type: "table_row", id: "nested-list-tab-row", children: [
              { type: "table_cell", id: "nested-list-tab-cell-a", attrs: { rowspan: 1, colspan: 1, header: false }, children: [
                { type: "list", id: "nested-list-tab-list", attrs: { style: "disc", checkable: false }, children: [
                  { type: "list_item", id: "nested-list-tab-outer-item", attrs: { checked: false }, children: [
                    { type: "paragraph", id: "nested-list-tab-outer-p", children: [{ type: "text", text: "first item" }] },
                    { type: "list", id: "nested-list-tab-inner-list", attrs: { style: "disc", checkable: false }, children: [
                      { type: "list_item", id: "nested-list-tab-inner-item", attrs: { checked: false }, children: [
                        { type: "paragraph", id: "nested-list-tab-inner-p", children: [{ type: "text", text: "second item" }] },
                      ] },
                    ] },
                  ] },
                ] },
              ] },
              { type: "table_cell", id: "nested-list-tab-cell-b", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "nested-list-tab-cell-b-p", children: [{ type: "text", text: "other cell" }] }] },
            ] },
          ] },
        ] },
      });
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await editor.focus();

    const nestedParagraph = editor.locator('[data-smart-id="nested-list-tab-inner-p"]');
    await nestedParagraph.click();
    await page.keyboard.press("End");

    const documentBefore = await page.evaluate(() => JSON.stringify((window as any).__smartProductCanonical.editor.document));
    await page.keyboard.press("Tab");

    // No indent happened - the list structure (nesting depth) is byte-for-byte unchanged.
    expect(await page.evaluate(() => JSON.stringify((window as any).__smartProductCanonical.editor.document))).toBe(documentBefore);

    // The caret moved to the adjacent cell, not staying in the list.
    const caretOwnerId = await page.evaluate(() => {
      const runtime = (window as any).__smartProductCanonical;
      const head = runtime.editor.selection.head;
      const node = head.path.reduce((current: any, index: number) => current.children[index], runtime.editor.document);
      return node.id;
    });
    expect(caretOwnerId).toBe("nested-list-tab-cell-b-p");

    // Focus never left the editor (the pre-existing "Tab must not escape to
    // page navigation" contract, still honored here).
    const activeElementIsEditor = await page.evaluate(() => document.activeElement?.getAttribute("contenteditable") === "true");
    expect(activeElementIsEditor).toBe(true);
  });

  /**
   * Phase 11 Tier 2: Shift+Arrow rectangular cell-selection expansion - a
   * genuinely missing feature before this pass (no table-grid branch
   * existed anywhere in arrow-key handling). Starting from a collapsed
   * caret in one cell of a 2x2 table, Shift+Right then Shift+Down should
   * grow the selection one row/column at a time; the renderer's existing
   * syncCellSelectionProjection (unchanged by this pass) paints the result
   * via `data-smart-cell-selected`.
   */
  test("expands a rectangular cell selection with Shift+Arrow", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "shift-arrow-doc", children: [
          { type: "table", id: "shift-arrow-table", attrs: { columnWidths: [100, 100] }, children: [
            { type: "table_row", id: "shift-arrow-row-1", children: [
              { type: "table_cell", id: "cell-aa", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "cell-aa-p", children: [{ type: "text", text: "aa" }] }] },
              { type: "table_cell", id: "cell-ab", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "cell-ab-p", children: [{ type: "text", text: "ab" }] }] },
            ] },
            { type: "table_row", id: "shift-arrow-row-2", children: [
              { type: "table_cell", id: "cell-ba", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "cell-ba-p", children: [{ type: "text", text: "ba" }] }] },
              { type: "table_cell", id: "cell-bb", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "cell-bb-p", children: [{ type: "text", text: "bb" }] }] },
            ] },
          ] },
        ] },
      });
      const position = runtime.editor.positions.positionOf("cell-aa-p");
      const point = { path: [...position.pos.path, 0], offset: 0 };
      const selection = { type: "text", anchor: point, head: point };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await editor.focus();

    await page.keyboard.press("Shift+ArrowRight");
    await expect(page.locator('[data-smart-cell-selected="true"]')).toHaveCount(2);
    expect(await page.evaluate(() => (window as any).__smartProductCanonical.editor.selection.type)).toBe("cell");

    await page.keyboard.press("Shift+ArrowDown");
    await expect(page.locator('[data-smart-cell-selected="true"]')).toHaveCount(4);

    await page.keyboard.press("Shift+ArrowUp");
    await expect(page.locator('[data-smart-cell-selected="true"]')).toHaveCount(2);
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
    const indent = toolbarMenuItem(page, "Indent list item");
    const outdent = toolbarMenuItem(page, "Outdent list item");
    await openToolbarDropdown(page, "More list tools");
    await expect(indent).toBeEnabled();
    await indent.click();
    await openToolbarDropdown(page, "More list tools");
    await expect(indent).toBeDisabled();
    await expect(outdent).toBeEnabled();
    await outdent.click();
    // At depth zero the command remains legal because Phase 3 defines it as
    // the list-unwrapping action. A second click performs that unwrap.
    await openToolbarDropdown(page, "More list tools");
    await expect(outdent).toBeEnabled();
    await outdent.click();
    await openToolbarDropdown(page, "More list tools");
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
    const indent = toolbarMenuItem(page, "Indent list item");
    const outdent = toolbarMenuItem(page, "Outdent list item");
    await openToolbarDropdown(page, "More list tools");
    await expect(indent).toBeEnabled();
    await indent.click();
    await openToolbarDropdown(page, "More list tools");
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
    const indent = toolbarMenuItem(page, "Indent list item");
    const outdent = toolbarMenuItem(page, "Outdent list item");
    await openToolbarDropdown(page, "More list tools");
    await expect(indent).toBeDisabled();
    await expect(outdent).toBeEnabled();
    await outdent.click();
    await openToolbarDropdown(page, "More list tools");
    await expect(outdent).toBeEnabled();
    await expect(indent).toBeEnabled();
    await outdent.click();
    await openToolbarDropdown(page, "More list tools");
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
    const indent = toolbarMenuItem(page, "Indent list item");
    const outdent = toolbarMenuItem(page, "Outdent list item");
    await openToolbarDropdown(page, "More list tools");
    await expect(outdent).toBeEnabled();
    await outdent.click();
    await openToolbarDropdown(page, "More list tools");
    await expect(outdent).toBeEnabled();
    await outdent.click();
    await openToolbarDropdown(page, "More list tools");
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

  /**
   * Regression for a real, highly-reproducible (measured ~90%+) race: a
   * real mouse click correctly places the native caret inside a code block,
   * but the resulting `selectionchange` is delivered asynchronously in
   * Chromium (the same class of race `handleKeyDown`'s own comment already
   * documents for Ctrl/Cmd+A followed by an arrow key). End's handler read
   * `this.editor.selection.head` synchronously without first importing the
   * just-clicked native range, so it silently computed "end of whatever the
   * *previous* (stale) owner was" - here, the document's first paragraph -
   * and explicitly committed and rendered that wrong position, physically
   * moving the real caret out of the code block and out of the blockquote
   * entirely. A following Enter then genuinely (not just apparently) landed
   * outside the blockquote, matching the report precisely: "no way to
   * create a new line... Enter kicks the cursor outside the blockquote
   * entirely." Nesting inside a blockquote isn't actually load-bearing here
   * (a top-level code block right after a click+End is equally exposed);
   * it's the reported repro shape, kept as-is.
   */
  test("a real click into a code block nested in a blockquote, then End, then Enter, inserts a literal newline and stays inside", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "click-race-doc", children: [
          { type: "paragraph", id: "click-race-p", children: [{ type: "text", text: "Canonical product editor" }] },
          { type: "blockquote", id: "click-race-quote", children: [
            { type: "code_block", id: "click-race-code", children: [{ type: "text", text: "line one" }] },
          ] },
        ] },
      });
    });
    const codeBlock = page.locator('[data-smart-id="click-race-code"]');
    await codeBlock.click({ position: { x: 60, y: 8 } });
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("line two");
    const codeText = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      const quote = runtime.editor.document.children.find((node: { type: string }) => node.type === "blockquote");
      return quote?.children?.[0]?.children?.map((child: { text?: string }) => child.text || "").join("");
    });
    expect(codeText).toBe("line one\nline two");
    // Exactly one blockquote exists (unchanged) - the bug's telltale symptom
    // was a *new sibling paragraph* appearing before the blockquote instead.
    await expect(page.locator('[data-smart-authority="canonical"] [contenteditable="true"] > blockquote')).toHaveCount(1);
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
    await openToolbarDropdown(page, "More list tools");
    const outdent = toolbarMenuItem(page, "Outdent list item");
    await expect(outdent).toBeEnabled();
    await outdent.click();
    await openToolbarDropdown(page, "More list tools");
    await expect(outdent).toBeEnabled();
    await outdent.click();
    await openToolbarDropdown(page, "More list tools");

    const indent = toolbarMenuItem(page, "Indent list item");
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

  /**
   * Phase 11 Tier 3: the renderer-integrated content-visibility design
   * (surface/renderer.ts's syncContentVisibility, opt-in via
   * CanonicalEditorRuntimeOptions.contentVisibility) - unlike the naive
   * experiment above, it only applies content-visibility to a top-level
   * block the renderer's diff already proved untouched this render pass
   * and that isn't the actively-selected block, so the block being typed
   * into never carries the extra containment cost. Constructs a second
   * runtime (same public CanonicalEditorRuntime class the production page
   * already uses) with the option enabled, mounted into a hidden root
   * seeded with the same 10k-block document, and samples the same typing
   * latency the baseline test above does.
   */
  test("benchmarks the renderer-integrated content-visibility design against production", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "One headed Chromium trace is the requested decision input.");
    await page.goto("/?canonicalAuthority=1&blocks=10000");
    const result = await page.evaluate(async () => {
      const runtime = (window as typeof window & { __smartProductCanonical: any }).__smartProductCanonical;
      const RuntimeClass = Object.getPrototypeOf(runtime).constructor;
      const html = Array.from({ length: 10_000 }, (_, index) => `<p>${index === 0 ? "Canonical product editor" : `block ${index}`}</p>`).join("");
      const hiddenRoot = document.createElement("div");
      hiddenRoot.style.position = "fixed";
      hiddenRoot.style.top = "0";
      hiddenRoot.style.left = "0";
      hiddenRoot.style.opacity = "0";
      hiddenRoot.style.pointerEvents = "none";
      document.body.appendChild(hiddenRoot);
      const candidateRuntime = new RuntimeClass({ initialValue: html, contentVisibility: true });
      candidateRuntime.mount(hiddenRoot);
      const sample = async (target: any) => {
        const values: number[] = [];
        for (let index = 0; index < 5; index += 1) {
          const started = performance.now();
          target.editor.typeText("z", { timestamp: 100_000 + index * 1_000 });
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          values.push(performance.now() - started);
        }
        return values;
      };
      const baseline = await sample(runtime);
      const candidate = await sample(candidateRuntime);
      const untouchedBlock = hiddenRoot.children[9999] as HTMLElement;
      const activeBlock = hiddenRoot.children[0] as HTMLElement;
      const result = {
        baseline, candidate,
        untouchedHasContentVisibility: getComputedStyle(untouchedBlock).contentVisibility === "auto",
        activeHasContentVisibility: getComputedStyle(activeBlock).contentVisibility === "auto",
      };
      candidateRuntime.unmount();
      hiddenRoot.remove();
      return result;
    });
    console.log("Phase 11 Tier 3 renderer-integrated content-visibility benchmark", { baseline: result.baseline, candidate: result.candidate });
    // The correctness property this design is actually for: an untouched
    // off-screen block gets content-visibility, the block being typed into
    // never does - independent of whether this run happens to be faster.
    expect(result.untouchedHasContentVisibility).toBe(true);
    expect(result.activeHasContentVisibility).toBe(false);
  });

  /**
   * Phase 11 Tier 2: per the Phase 8b closeout, Undo/Redo buttons were never
   * clicked anywhere in the canonical e2e suite - a systemic gap, not an
   * isolated miss (docs/PHASE_8B_FINAL_CLOSEOUT.md #8/#14/#23). This closes
   * that gap for the representative multi-operation-as-one-history-step
   * case: converting a multi-paragraph selection into a list produces
   * several operations (wrap each paragraph in a list_item, wrap the whole
   * thing in a list) in one transaction, so one Undo must revert all of it,
   * not partially unwind it.
   */
  test("undoes and redoes a multi-paragraph list conversion as one history step", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { schema: any; state: any }; replaceValue: (value: unknown) => void } }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "undo-list-doc", children: [
          { type: "paragraph", id: "undo-list-p1", children: [{ type: "text", text: "alpha" }] },
          { type: "paragraph", id: "undo-list-p2", children: [{ type: "text", text: "beta" }] },
          { type: "paragraph", id: "undo-list-p3", children: [{ type: "text", text: "gamma" }] },
        ] },
      });
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
      const range = document.createRange();
      range.selectNodeContents(root);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await expect(editor.locator("ul")).toHaveCount(1);
    await expect(editor.locator("li")).toHaveCount(3);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(editor.locator("ul")).toHaveCount(0);
    await expect(editor.locator("li")).toHaveCount(0);
    await expect(editor.locator("p")).toHaveCount(3);
    await expect(editor).toContainText("alpha");
    await expect(editor).toContainText("beta");
    await expect(editor).toContainText("gamma");

    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(editor.locator("ul")).toHaveCount(1);
    await expect(editor.locator("li")).toHaveCount(3);
  });

  /**
   * The other half of the same systemic gap: successive discrete resize
   * clicks on one atom coalesce into a single history step via
   * editSelectedAtom's `historyGroup: resize-<nodeId>` (CanonicalAuthorityEditor.tsx),
   * within the default 400ms coalescence window
   * (history.ts's DEFAULT_COALESCENCE_WINDOW_MS) - matching the closeout's
   * #30 ("coalesces image resize drag into one undo step"), adapted to the
   * canonical editor's real discrete grow/shrink controls rather than a
   * literal drag gesture, which canonical does not implement.
   */
  test("coalesces two successive atom-resize clicks into one undo step", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { schema: any; state: any }; replaceValue: (value: unknown) => void } }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "undo-resize-doc", children: [
          { type: "block_image", id: "undo-resize-img", attrs: { src: "https://media.playground.test/fixture.png", alt: "fixture", decorative: false, status: "ready", width: 200, height: 150 }, children: [] },
          { type: "paragraph", id: "undo-resize-p", children: [{ type: "text", text: "after" }] },
        ] },
      });
    });
    const image = page.locator('[data-smart-type="block_image"]');
    await image.click();
    const widthOf = () => image.evaluate((element) => Number(element.getAttribute("width")));
    const originalWidth = await widthOf();
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Enlarge selected media").click();
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Enlarge selected media").click();
    const grownWidth = await widthOf();
    expect(grownWidth).toBeGreaterThan(originalWidth);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const revertedWidth = await widthOf();
    expect(revertedWidth).toBe(originalWidth);
  });

  /**
   * Phase 11 Tier 3: axe-core coverage expansion. canonical-authority.spec.ts
   * (the real product surface) had zero axe scans before this pass -
   * canonical-surface.spec.ts's scans only ever exercise the lower-level
   * harness. Covers checklist controls and a formula atom together, the
   * combination most likely to interact badly (custom checkbox role plus
   * aria-label'd math).
   */
  test("has no axe violations with checklist controls and a formula atom together", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "axe-authority-doc", children: [
          { type: "list", id: "axe-check-list", attrs: { style: "disc", checkable: true }, children: [
            { type: "list_item", id: "axe-check-a", attrs: { checked: true }, children: [{ type: "paragraph", id: "axe-check-a-p", children: [{ type: "text", text: "Done task" }] }] },
            { type: "list_item", id: "axe-check-b", attrs: { checked: false }, children: [{ type: "paragraph", id: "axe-check-b-p", children: [{ type: "text", text: "Open task" }] }] },
          ] },
          { type: "block_formula", id: "axe-formula", attrs: { source: "x^2+1", notation: "latex" }, children: [] },
        ] },
      });
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await expect(editor.locator('[data-smart-ui="check-control"]')).toHaveCount(2);
    const results = await new AxeBuilder({ page }).include('[data-smart-authority="canonical"]').analyze();
    expect(results.violations).toEqual([]);
  });

  /**
   * Phase 11 Tier 2 (from the remaining deferred e2e batch,
   * docs/PHASE_8B_FINAL_CLOSEOUT.md #6): "removes an existing ordered list
   * without losing its items" was flagged with a concerning note - the
   * existing coverage showed only single-item unwrap, not a multi-item
   * range unwrap. Verifies a 3-item flat list, selected end-to-end and
   * unwrapped in one toggle, keeps all three items as plain paragraphs
   * with their text intact - not just the item under the caret.
   */
  test("unwraps a multi-item selected list without losing any items", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "unwrap-multi-doc", children: [{
          type: "list", id: "unwrap-multi-list", attrs: { style: "decimal" }, children: [
            { type: "list_item", id: "unwrap-multi-a", children: [{ type: "paragraph", id: "unwrap-multi-a-p", children: [{ type: "text", text: "first" }] }] },
            { type: "list_item", id: "unwrap-multi-b", children: [{ type: "paragraph", id: "unwrap-multi-b-p", children: [{ type: "text", text: "second" }] }] },
            { type: "list_item", id: "unwrap-multi-c", children: [{ type: "paragraph", id: "unwrap-multi-c-p", children: [{ type: "text", text: "third" }] }] },
          ],
        }] },
      });
      const anchor = { path: [0, 0, 0], offset: 0 };
      const head = { path: [0, 2, 0], offset: 5 };
      const selection = { type: "text", anchor, head };
      runtime.editor.setSelection(selection, { source: "api" });
      runtime.renderer.render(runtime.editor.document, selection);
    });
    const numbering = page.getByRole("button", { name: "Numbered list", exact: true });
    await expect(numbering).toHaveAttribute("aria-pressed", "true");
    await numbering.click();
    const after = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      return {
        types: runtime.editor.document.children.map((node: any) => node.type),
        texts: runtime.editor.document.children.map((node: any) => (node.children || []).map((child: any) => child.text || "").join("")),
      };
    });
    expect(after.types).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(after.texts).toEqual(["first", "second", "third"]);
  });

  /**
   * Phase 11.5 §2.5: LinkEditorPopover (previously built, unit-tested in
   * isolation, never wired anywhere) is now wired to the Link toolbar
   * button. This is the case with no prior e2e coverage even after the
   * toolbar-routing fix: a collapsed caret with nothing selected has no
   * text to become the link label, so the popover's "Display text" field
   * must actually insert new linked text, not just arm a mark for future
   * typing (which would insert nothing visible).
   */
  test("inserts a brand-new link with typed display text at a collapsed cursor", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await editor.click();
    await page.getByRole("button", { name: "Insert or edit link", exact: true }).click();
    const popover = page.locator('[data-srte-link-popover="true"]');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("Insert link");
    await expect(page.locator("[data-srte-link-text-input]")).toBeVisible();
    await page.locator("[data-srte-link-text-input]").fill("Example");
    await page.locator("[data-srte-link-href-input]").fill("https://example.test");
    await page.locator('[data-srte-link-new-tab-input]').check();
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(popover).not.toBeVisible();
    const link = editor.locator("a");
    await expect(link).toHaveText("Example");
    await expect(link).toHaveAttribute("href", "https://example.test");
    await expect(link).toHaveAttribute("target", "_blank");
  });

  /**
   * Context menu scope reduction: link no longer has a right-click menu -
   * LinkEditorPopover auto-appears, anchored to the link's own DOM bounds,
   * whenever the caret is inside an existing link (reusing the exact
   * component/apply logic the toolbar's Link button already drives, per
   * §1's investigation - only the trigger mechanism and anchor point are
   * new). Covers: auto-appear, editing the href through it, dismiss via
   * Escape without reopening at the same caret position, and dismiss when
   * the selection moves off the link entirely.
   */
  test("link overlay auto-appears when the caret enters a link, edits it, and dismisses correctly", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: unknown[] }; schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const doc = runtime.editor.document;
      (doc.children as unknown[]).push({
        type: "paragraph", id: "overlay-link-p",
        children: [{ type: "text", text: "visit example now", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }],
      });
      runtime.replaceValue({ schemaVersion: runtime.editor.schema.version, revision: runtime.editor.state.revision + 1, document: doc });
    });
    const link = editor.locator('[data-smart-id="overlay-link-p"] a');
    const popover = page.locator('[data-srte-link-popover="true"]');
    // Programmatic selection, not a real click - a click's exact character
    // offset depends on pixel geometry the test shouldn't need to know;
    // setSelection lets each step target a precise, known offset instead
    // (offset 3 and offset 4 are both safely inside the 18-character link
    // text, "visit example now").
    const setCaret = (offset: number) => page.evaluate((offset) => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: unknown; selection: unknown; setSelection: (selection: unknown, options?: unknown) => void };
        surface: { renderer: { render: (document: unknown, selection: unknown) => void } };
      } }).__smartProductCanonical!;
      const pos = { path: [1], offset };
      runtime.editor.setSelection({ type: "text", anchor: pos, head: pos }, { source: "api" });
      runtime.surface.renderer.render(runtime.editor.document, runtime.editor.selection);
    }, offset);

    // Entering the link (no toolbar/menu action) auto-opens the overlay,
    // pre-filled with the existing href, positioned by the link's own
    // bounds rather than any click point.
    await setCaret(3);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("Edit link");
    await expect(page.locator("[data-srte-link-href-input]")).toHaveValue("https://example.com");

    // Escape dismisses without applying, and does not instantly reopen
    // while the caret is still at the same position inside the link.
    await page.keyboard.press("Escape");
    await expect(popover).not.toBeVisible();
    await page.waitForTimeout(150);
    await expect(popover).not.toBeVisible();

    // A genuine caret move (not the same offset the dismissal was
    // recorded at) clears the dismissal and reopens the overlay; editing
    // the href and applying updates the real link.
    await setCaret(4);
    await expect(popover).toBeVisible();
    await page.locator("[data-srte-link-href-input]").fill("https://updated.example");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(popover).not.toBeVisible();
    await expect(link).toHaveAttribute("href", "https://updated.example");

    // Moving the selection off the link dismisses an overlay left open -
    // not just suppresses future auto-opens. Click the *first* paragraph
    // (the route's own seed content, no link) - the link paragraph is
    // still the last child, so clicking within it would only move the
    // caret to a different offset of the same link, not off it.
    await setCaret(5);
    await expect(popover).toBeVisible();
    await editor.locator("p").first().click();
    await page.waitForTimeout(100);
    await expect(popover).not.toBeVisible();
  });

  /**
   * Regression: the auto-triggered overlay above reused LinkEditorPopover's
   * `useEffect(() => hrefRef.current?.focus(), [])` verbatim from its
   * original toolbar-button-only design, where autofocusing the href field
   * on open is correct (the user explicitly asked to edit the link). Once
   * reused for the *auto*-trigger, that same autofocus fired on every
   * ordinary click that merely placed the caret inside a link - moving
   * focus off the editor into the popover's URL field before the user's own
   * click could do anything, so a real click-driven caret placement (not
   * the programmatic setSelection the test above uses) silently lost the
   * editor's focus and any subsequent keystroke went into the href input
   * instead of the document. This defeated the overlay's whole reason for
   * existing - "clicking into a link doesn't trap the cursor."
   */
  test("a real click into link text keeps editor focus - the auto-triggered overlay must not steal it", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: unknown[] }; schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const doc = runtime.editor.document;
      (doc.children as unknown[]).push({
        type: "paragraph", id: "focus-link-p",
        children: [{ type: "text", text: "visit example now please", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }],
      });
      runtime.replaceValue({ schemaVersion: runtime.editor.schema.version, revision: runtime.editor.state.revision + 1, document: doc });
    });
    const link = editor.locator('[data-smart-id="focus-link-p"] a');
    const popover = page.locator('[data-srte-link-popover="true"]');
    await link.click({ position: { x: 40, y: 8 } });
    await expect(popover).toBeVisible();
    // The overlay still opens (unchanged) - it just must not have moved
    // focus off the editor to get there.
    await expect(page.locator("[data-srte-link-href-input]")).not.toBeFocused();
    await expect(editor).toBeFocused();
    await page.keyboard.type("XYZ");
    await expect(editor).toContainText("XYZ");
    await expect(page.locator("[data-srte-link-href-input]")).toHaveValue("https://example.com");

    // The toolbar's own Link button is an explicit "I want to edit this"
    // action, so it must keep autofocusing the href input exactly as before.
    await editor.locator("p").first().click();
    await page.getByRole("button", { name: "Insert or edit link", exact: true }).click();
    await expect(page.locator("[data-srte-link-href-input]")).toBeFocused();
  });

  /**
   * Post-batch follow-up ("clicking link not opening link. Even with ctrl
   * or cmd. It's only open overlay."): Ctrl/Cmd+click's window.open call
   * was never actually broken - it opens a real new tab. The auto link
   * overlay (added above) also popped open in the *current* tab from the
   * same click (which also moves the caret into the link), since a
   * background tab doesn't steal focus - reading, from the user's seat,
   * as "the link didn't open, I only got this box."
   */
  test("Ctrl/Cmd+click on a link opens it without the edit overlay also popping open", async ({ page, context }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const runtime = (window as typeof window & {
        __smartProductCanonical?: { editor: { document: { children: unknown[] }; schema: { version: number }; state: { revision: number } }; replaceValue: (value: unknown) => void };
      }).__smartProductCanonical!;
      const doc = runtime.editor.document;
      (doc.children as unknown[]).push({
        type: "paragraph", id: "ctrl-click-link-p",
        children: [{ type: "text", text: "visit example now", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }],
      });
      runtime.replaceValue({ schemaVersion: runtime.editor.schema.version, revision: runtime.editor.state.revision + 1, document: doc });
    });
    // Start with the caret outside the link - a realistic starting point,
    // and confirms the overlay isn't already open before the click.
    await editor.locator("p").first().click();
    const popover = page.locator('[data-srte-link-popover="true"]');
    await expect(popover).not.toBeVisible();

    const link = editor.locator('[data-smart-id="ctrl-click-link-p"] a');
    const pagePromise = context.waitForEvent("page");
    await link.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    const newPage = await pagePromise;
    expect(newPage.url()).toContain("example.com");
    await page.waitForTimeout(150);
    await expect(popover).not.toBeVisible();

    // The suppression is one-shot, not a standing change - a plain click
    // right after must still auto-open the overlay normally.
    await editor.locator("p").first().click();
    await link.click();
    await expect(popover).toBeVisible();
  });

  /**
   * Phase 11.5 §2.4: ColorPickerPopover replaces window.prompt("#000000")
   * for Text/Background colour. Covers both entry points: the native
   * color-picker input, and a typed custom hex value.
   */
  test("applies text color via the saturation/hue picker and background color via a custom hex value", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode() as Text;
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    const colorPopover = page.locator('[data-srte-color-popover="true"]');
    await expect(colorPopover).toBeVisible();
    // The popover must stay open while a value is being staged - only
    // dismissing it (Escape, outside click, ×) commits and closes it; there
    // is no separate Apply button (see pickColor's own comment for why).
    await pickColor(page, "#e03131");
    await expect(colorPopover).not.toBeVisible();
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCount(1);

    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Background colour").click();
    await page.locator("[data-srte-color-hex-input]").fill("#abc");
    await page.keyboard.press("Escape");
    await expect(editor.locator('[data-smart-mark="backgroundColor"]')).toHaveCount(1);

    // An invalid hex is rejected with a visible error, not silently applied
    // (or silently committed on dismissal - since it was never staged as a
    // valid preview, the popover just closes without changing anything).
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    await page.locator("[data-srte-color-hex-input]").fill("not-a-color");
    await expect(page.locator('[data-srte-color-error="true"]')).toBeVisible();
  });

  /**
   * Live preview while dragging the saturation/hue picker: mirrors
   * TableResizeHandles' own live-preview-then-commit-once pattern
   * (CanonicalAuthorityEditor.tsx's previewColor/applyColor). Each staged
   * frame must visibly update the selection's color in real time without
   * creating an undo step, and exactly one real, undoable transaction must
   * exist once the popover is actually dismissed - regardless of how many
   * preview frames preceded it. Staged via the hex input rather than a real
   * pointer drag on the SV square/hue slider - both paths call the same
   * `stage()` function in ColorPickerPopover, so the hex input exercises
   * the identical preview/commit code path without needing real drag
   * coordinates.
   */
  test("live-previews the color picker while staging, without creating an undo step, and commits exactly once on dismiss", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await selectFirstText(page);

    const undoCount = () => page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical: import("../src/canonicalEditorRuntime.js").CanonicalEditorRuntime }).__smartProductCanonical;
      return runtime.editor.history.undo.length;
    });
    const stageHex = (hex: string) => page.locator("[data-srte-color-hex-input]").fill(hex);

    const before = await undoCount();
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    const colorPopover = page.locator('[data-srte-color-popover="true"]');
    await expect(colorPopover).toBeVisible();

    await stageHex("#1a2b3c");
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCount(1);
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCSS("color", "rgb(26, 43, 60)");
    expect(await undoCount()).toBe(before);

    // A later frame supersedes the earlier one rather than compounding.
    await stageHex("#4c5c6c");
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCount(1);
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCSS("color", "rgb(76, 92, 108)");
    expect(await undoCount()).toBe(before);
    await expect(colorPopover).toBeVisible();

    // There is no separate Apply button - dismissing (Escape here) commits
    // whatever was last staged.
    await page.keyboard.press("Escape");
    await expect(colorPopover).not.toBeVisible();
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCSS("color", "rgb(76, 92, 108)");
    expect(await undoCount()).toBe(before + 1);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCount(0);
  });

  test("Discard after a live preview reverts to the original (uncolored) state - the only way other dismissals (Escape, outside click) commit instead", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await selectFirstText(page);
    const undoCount = () => page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical: import("../src/canonicalEditorRuntime.js").CanonicalEditorRuntime }).__smartProductCanonical;
      return runtime.editor.history.undo.length;
    });
    const before = await undoCount();

    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    const colorPopover = page.locator('[data-srte-color-popover="true"]');
    await expect(colorPopover).toBeVisible();
    await page.locator("[data-srte-color-hex-input]").fill("#1a2b3c");
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCount(1);

    await page.locator('[data-srte-color-discard="true"]').click();
    await expect(colorPopover).not.toBeVisible();
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCount(0);
    expect(await undoCount()).toBe(before);

    // Escape, unlike Discard, commits the staged value - it is not a
    // second way to cancel.
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    await page.locator("[data-srte-color-hex-input]").fill("#1a2b3c");
    await page.keyboard.press("Escape");
    await expect(colorPopover).not.toBeVisible();
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCount(1);
  });

  test("recently-used colors: appears after commit, oldest drops off past the retention limit, and clicking one applies it directly", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const colorPopover = page.locator('[data-srte-color-popover="true"]');
    const recentRow = page.locator('[data-srte-recent-colors="true"]');

    await selectFirstText(page);
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    await expect(colorPopover).toBeVisible();
    // No commit has happened yet for this bucket - no recent-colors row at all.
    await expect(recentRow).toHaveCount(0);
    await page.locator("[data-srte-color-hex-input]").fill("#111111");
    await page.keyboard.press("Escape");

    await selectFirstText(page);
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    await expect(recentRow).toBeVisible();
    await expect(page.locator('[data-srte-recent-color="#111111"]')).toHaveCount(1);
    await page.keyboard.press("Escape");

    // 4 more distinct commits (retention limit, reduced to 4 per the
    // owner's explicit "4 last used colors" request) - #111111 should fall
    // off the end once a 5th distinct value has been committed.
    const hexes = ["#222222", "#333333", "#444444", "#555555"];
    for (const hex of hexes) {
      await selectFirstText(page);
      await openToolbarDropdown(page, "More text styles");
      await toolbarMenuItem(page, "Text colour").click();
      await page.locator("[data-srte-color-hex-input]").fill(hex);
      await page.keyboard.press("Escape");
    }
    await selectFirstText(page);
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    await expect(page.locator('[data-srte-recent-color="#111111"]')).toHaveCount(0);
    for (const hex of hexes) await expect(page.locator(`[data-srte-recent-color="${hex}"]`)).toHaveCount(1);

    // Clicking a recent swatch stages it (like a drag frame or a typed hex)
    // rather than committing immediately - the popover stays open so the
    // user can keep adjusting; dismissing commits it, same as any other
    // staged value.
    await page.locator('[data-srte-recent-color="#333333"]').click();
    await expect(colorPopover).toBeVisible();
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCSS("color", "rgb(51, 51, 51)");
    await page.keyboard.press("Escape");
    await expect(colorPopover).not.toBeVisible();
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCSS("color", "rgb(51, 51, 51)");

    // Background colors are tracked in a separate bucket from text colors.
    await selectFirstText(page);
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Background colour").click();
    await expect(page.locator('[data-srte-recent-colors="true"]')).toHaveCount(0);
  });

  /**
   * Phase 11.5 §2.1: MediaManager.tsx (previously built, zero test
   * coverage, never wired) is now the default image picker. Covers the
   * full upload -> library search -> select flow, plus its client-side
   * duplicate detection (search({hashHex}) before every upload).
   */
  test("uploads an image, finds it again via library search, and recognizes a re-upload as a duplicate", async ({ page }) => {
    // The reference provider's URLs (https://media.playground.test/...)
    // have no real backend; without a real image response the library
    // grid's thumbnail has no intrinsic size and is never actionable.
    // Serve a real 1x1 PNG so the thumbnail renders and can be clicked,
    // the same way a real host's actual media URLs would.
    const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await page.route("https://media.playground.test/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: onePixelPng }));
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const manager = page.getByRole("dialog", { name: "Media library" });

    await page.getByRole("button", { name: "Insert image", exact: true }).click();
    await expect(manager).toBeVisible();
    await manager.locator('input[type="file"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("photo-bytes") });
    await expect(manager).not.toBeVisible();
    await expect(editor.locator('img[data-smart-type="block_image"]')).toHaveCount(1);
    const firstSrc = await editor.locator('img[data-smart-type="block_image"]').getAttribute("src");

    // Library search finds the just-uploaded item.
    await page.getByRole("button", { name: "Insert image", exact: true }).click();
    await expect(manager).toBeVisible();
    await manager.getByRole("button", { name: "Library", exact: true }).click();
    await expect(manager.locator("img").first()).toBeVisible();
    await expect(manager.locator("img").first()).toHaveAttribute("src", firstSrc!);
    await manager.locator("img").first().click();
    await expect(manager).not.toBeVisible();
    await expect(editor.locator('img[data-smart-type="block_image"]')).toHaveCount(2);
    const secondSrc = await editor.locator('img[data-smart-type="block_image"]').nth(1).getAttribute("src");
    expect(secondSrc).toBe(firstSrc);

    // Re-uploading identical bytes is recognized as a duplicate (same
    // content hash) and reuses the existing item rather than creating a
    // second library entry.
    await page.getByRole("button", { name: "Insert image", exact: true }).click();
    await expect(manager).toBeVisible();
    await manager.locator('input[type="file"]').setInputFiles({ name: "photo-again.png", mimeType: "image/png", buffer: Buffer.from("photo-bytes") });
    await expect(manager).not.toBeVisible();
    await expect(editor.locator('img[data-smart-type="block_image"]')).toHaveCount(3);
    const thirdSrc = await editor.locator('img[data-smart-type="block_image"]').nth(2).getAttribute("src");
    expect(thirdSrc).toBe(firstSrc);
  });

  /**
   * Phase 11.5 §2.2: column-width/row-height drag handles. Investigation
   * found row/column move already had toolbar buttons; resize had neither
   * UI nor (until this pass) a renderer that projected columnWidths at
   * all (docs/bugs/table-column-width-not-rendered.md) - this exercises
   * the whole path: drag -> setTableColumnWidthCommand -> real <col> width.
   */
  test("resizes a table column via drag handle, producing a real rendered width change", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "resize-doc", children: [
          { type: "table", id: "resize-table", attrs: {}, children: [
            { type: "table_row", id: "resize-row", children: [
              { type: "table_cell", id: "resize-cell-a", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "resize-cell-a-p", children: [{ type: "text", text: "a" }] }] },
              { type: "table_cell", id: "resize-cell-b", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "resize-cell-b-p", children: [{ type: "text", text: "b" }] }] },
            ] },
          ] },
        ] },
      });
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const cellA = editor.locator('[data-smart-id="resize-cell-a"]');
    await selectCellRange(page, cellA, cellA);
    const handle = page.locator('[data-srte-column-resize-handle="0"]');
    await expect(handle).toBeVisible();
    const handleBox = (await handle.boundingBox())!;
    const startWidth = (await cellA.boundingBox())!.width;

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 60, handleBox.y + handleBox.height / 2, { steps: 5 });
    await page.mouse.up();

    const table = editor.locator('[data-smart-type="table"]');
    await expect(table.locator("colgroup col")).toHaveCount(2);
    const newWidth = await table.locator("colgroup col").first().evaluate((col) => parseFloat((col as HTMLElement).style.width));
    expect(newWidth).toBeGreaterThan(startWidth + 40);
    const modelWidths = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: any }).__smartProductCanonical!;
      // A table with no surrounding paragraph gets an automatic editable-
      // boundary paragraph inserted, so the table isn't necessarily
      // children[0].
      const table = runtime.editor.document.children.find((child: any) => child.type === "table");
      return table.attrs.columnWidths;
    });
    expect(modelWidths[0]).toBeCloseTo(newWidth, 0);
  });

  /**
   * Phase 11.5 §2.3: right-click dispatches to the plugin registry's
   * contextMenu contributions (previously a manifest field with zero
   * built-in plugins populating it) via ContextMenu.tsx - not a hardcoded
   * per-button handler, so this exercises the actual dynamic-dispatch path
   * (scope resolution -> matching contribution -> command.run), including
   * table.insertRow's caller-generated ids being filled in at click time.
   */
  test("inserts a table row and deletes the table via the right-click context menu", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true);
    await insertDefaultTable(page);
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const table = editor.locator('[data-smart-type="table"]');
    await expect(table.locator("tr")).toHaveCount(2);

    const firstCell = table.locator("tr").first().locator("td").first();
    await firstCell.click({ button: "right" });
    const menu = page.locator('[data-srte-context-menu="true"]');
    await expect(menu).toBeVisible();
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.insertRowBelow"]').click();
    await expect(menu).not.toBeVisible();
    await expect(table.locator("tr")).toHaveCount(3);

    await firstCell.click({ button: "right" });
    await expect(menu).toBeVisible();
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.removeTable"]').click();
    await expect(table).toHaveCount(0);
  });

  /**
   * Post-batch follow-up ("table delete row, delete column not working"):
   * resolveContextMenuItems's generic dispatch loop passed
   * contribution.params straight through - undefined for any static
   * contribution with no params field (removeRow/removeColumn/mergeCells/
   * removeTable), where the toolbar's equivalent buttons already passed
   * {} for exactly this reason. removeTableRowCommand/
   * removeTableColumnCommand's `params.rowIndex ?? ...` threw on that
   * undefined, which also left the menu stuck open (the thrown exception
   * aborted ContextMenu.tsx's onClick before it reached onDismiss()) -
   * this test's own repro is what surfaced that second symptom too.
   */
  test("deletes a row, deletes a column, and merges cells via the right-click context menu", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    await expect(table.locator("tr")).toHaveCount(2);
    const cell = table.locator("td").first();
    const menu = page.locator('[data-srte-context-menu="true"]');

    await cell.click({ button: "right" });
    await expect(menu).toBeVisible();
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.removeRow"]').click();
    await expect(menu).not.toBeVisible();
    await expect(table.locator("tr")).toHaveCount(1);

    await cell.click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(table.locator("tr").first().locator("td")).toHaveCount(2);
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.removeColumn"]').click();
    await expect(menu).not.toBeVisible();
    await expect(table.locator("tr").first().locator("td")).toHaveCount(1);

    await insertDefaultTable(page);
    const secondTable = editor.locator('[data-smart-type="table"]').last();
    await secondTable.locator("td").first().click({ button: "right" });
    await expect(menu).toBeVisible();
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.mergeCells"]').click();
    await expect(menu).not.toBeVisible();
  });

  /**
   * Image right-click opens the full details editor; deletion remains
   * available through the selected-media toolbar command.
   */
  test("deletes an inserted image atom after opening its details editor", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] > p', true);
    await page.getByRole("button", { name: "Insert image", exact: true }).click();
    await chooseMedia(page, "image", "context-menu.png", "image/png");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const image = editor.locator('[data-smart-type="block_image"]');
    await expect(image).toHaveCount(1);
    await image.click({ button: "right" });

    const details = page.locator('[data-srte-media-details-popover="true"]');
    await expect(details).toBeVisible();
    await page.keyboard.press("Escape");
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Delete selected media").click();
    await expect(image).toHaveCount(0);
  });

  /**
   * Context menu scope reduction: Bold is toolbar-only now (it already
   * was, per marks/plugin.ts - the context menu item was a second route to
   * the same command). Rewritten from "applies bold and then clears
   * formatting on selected text via the right-click context menu" to use
   * the toolbar button directly.
   *
   * The "clears formatting" half of the original test is NOT carried
   * forward: mark.clearAll ("Clear formatting") was only ever reachable
   * via the now-removed context-menu item - there is no toolbar button for
   * it (labels in CanonicalAuthorityEditor.tsx has no "clearAll" entry).
   * Removing marks from the context menu leaves mark.clearAll with no UI
   * path at all; flagged in the work order's report rather than silently
   * dropped.
   */
  test("applies bold to selected text via the toolbar", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await selectFirstText(page);
    await page.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(editor.locator("strong")).toHaveCount(1);
  });

  /**
   * "Line height support" (2026-09-07) - a genuinely new capability, built
   * the same way alignment/indent-level already are: schema attribute ->
   * command (reused setBlockAttributes directly, no new command needed) ->
   * renderer -> UI. Covers the full interaction: applying a preset shows a
   * real rendered line-height and a checkmark, applying a custom value
   * works the same way, and switching back to "Default" clears the
   * override entirely (not a forced "1").
   */
  test("applies a line-height preset via the toolbar, showing a checkmark on the active value, and 'Default' clears it", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const paragraph = editor.locator("p").first();
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p');

    await openToolbarDropdown(page, "Line spacing");
    await toolbarMenuItem(page, "1.5").click();
    await expect(paragraph).toHaveCSS("line-height", /.+/);
    const appliedHeight = await paragraph.evaluate((el) => getComputedStyle(el).lineHeight);

    // Re-derive the expected pixel line-height from the element's own font
    // size (1.5x) instead of hardcoding a pixel value, so this doesn't
    // depend on the exact base font-size this playground happens to use.
    const fontSize = await paragraph.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(Number.parseFloat(appliedHeight)).toBeCloseTo(fontSize * 1.5, 0);

    await openToolbarDropdown(page, "Line spacing");
    await expect(toolbarMenuItem(page, "1.5")).toHaveAttribute("aria-pressed", "true");
    await expect(toolbarMenuItem(page, "Default")).toHaveAttribute("aria-pressed", "false");

    await toolbarMenuItem(page, "Default").click();
    // "Default" removes the override entirely - the element's line-height
    // goes back to the browser/font's own natural value (whatever that
    // computes to here), not a forced "1"/"normal" this test would need to
    // hardcode. Confirmed by re-reading the live model's own attrs instead.
    const lineHeightAttr = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ attrs?: Record<string, unknown> }> } } } }).__smartProductCanonical!;
      return runtime.editor.document.children[0]?.attrs?.lineHeight;
    });
    expect(lineHeightAttr).toBeUndefined();
    await openToolbarDropdown(page, "Line spacing");
    await expect(toolbarMenuItem(page, "Default")).toHaveAttribute("aria-pressed", "true");
  });

  test("applies a custom line-height value via the toolbar's numeric input", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p');
    await openToolbarDropdown(page, "Line spacing");
    const customInput = page.getByRole("spinbutton", { name: "Custom line spacing" });
    await customInput.fill("1.75");
    await customInput.press("Enter");

    const lineHeightAttr = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: Array<{ attrs?: Record<string, unknown> }> } } } }).__smartProductCanonical!;
      return runtime.editor.document.children[0]?.attrs?.lineHeight;
    });
    expect(lineHeightAttr).toBe(1.75);

    // Reopening shows the custom value pre-filled (not one of the fixed
    // presets, so no preset item is checked, but the input itself reflects
    // the real current value rather than always resetting blank).
    await openToolbarDropdown(page, "Line spacing");
    await expect(page.getByRole("spinbutton", { name: "Custom line spacing" })).toHaveValue("1.75");
    for (const preset of ["1", "1.15", "1.5", "2", "2.5", "Default"]) {
      await expect(toolbarMenuItem(page, preset)).toHaveAttribute("aria-pressed", "false");
    }
  });

  /**
   * Regression (2026-09-12, live report): "Line spacing custom not
   * changing when cursor move to something else." The custom input used
   * React's `defaultValue`, which is only ever applied on initial mount -
   * and this control never unmounts on its own (ToolbarDropdown always
   * renders its menu content; only CSS visibility toggles when closed), so
   * once a custom value was typed once, the field kept showing it forever
   * regardless of where the caret moved afterward, even to a block with a
   * completely different (or no) line-height override.
   */
  test("the custom line-spacing input updates to reflect a different block once the caret moves there", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=2");
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p', false);
    await openToolbarDropdown(page, "Line spacing");
    const customInput = page.getByRole("spinbutton", { name: "Custom line spacing" });
    await customInput.fill("1.75");
    await customInput.press("Enter");

    // Move the caret to the second, untouched paragraph - no override there.
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p', true);
    await openToolbarDropdown(page, "Line spacing");
    await expect(page.getByRole("spinbutton", { name: "Custom line spacing" })).toHaveValue("");

    // And a preset value on that second paragraph is reflected too, not
    // the first paragraph's stale custom "1.75".
    await toolbarMenuItem(page, "1.5").click();
    await openToolbarDropdown(page, "Line spacing");
    await expect(page.getByRole("spinbutton", { name: "Custom line spacing" })).toHaveValue("");
    await expect(toolbarMenuItem(page, "1.5")).toHaveAttribute("aria-pressed", "true");

    // Moving back to the first paragraph still shows its own real value.
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p', false);
    await openToolbarDropdown(page, "Line spacing");
    await expect(page.getByRole("spinbutton", { name: "Custom line spacing" })).toHaveValue("1.75");
  });

  test("shows no checkmark (mixed state) when the selection spans blocks with different line-heights", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=2");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p', false);
    await openToolbarDropdown(page, "Line spacing");
    await toolbarMenuItem(page, "1.5").click();

    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p', true);
    await openToolbarDropdown(page, "Line spacing");
    await toolbarMenuItem(page, "2").click();

    // Select across both paragraphs.
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
      const paragraphs = root.querySelectorAll("p");
      const range = document.createRange();
      range.setStart(paragraphs[0], 0);
      range.setEnd(paragraphs[paragraphs.length - 1], paragraphs[paragraphs.length - 1].childNodes.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await openToolbarDropdown(page, "Line spacing");
    for (const preset of ["1", "1.15", "1.5", "2", "2.5", "Default"]) {
      await expect(toolbarMenuItem(page, preset)).toHaveAttribute("aria-pressed", "false");
    }
    await expect(editor.locator("p").first()).toHaveCSS("line-height", /.+/);
  });

  /**
   * PDF fidelity for line-height is declared `full` specifically because
   * this package's real "Save as PDF" is a browser print of the same HTML
   * export (formats/pdf/format.ts's buildPdfPrintDocument), not a separate
   * PDF-generation path - so it inherits whatever the HTML export produces
   * exactly. Verified directly against the real popup's own computed
   * style, not assumed from the HTML string alone.
   */
  test("a custom line-height value renders correctly in the actual 'Save as PDF' output, not just live in the editor", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await placeCaret(page, '[data-smart-authority="canonical"] [contenteditable="true"] p');
    await openToolbarDropdown(page, "Line spacing");
    await toolbarMenuItem(page, "2").click();

    const popupPromise = page.waitForEvent("popup");
    await openToolbarDropdown(page, "Save a copy");
    await toolbarMenuItem(page, "Print / Save as PDF").click();
    const popup = await popupPromise;
    await popup.waitForLoadState();

    const printedParagraph = popup.locator("p").first();
    await expect(printedParagraph).toHaveCSS("line-height", /.+/);
    const [printedHeight, printedFontSize] = await printedParagraph.evaluate((el) => {
      const style = getComputedStyle(el);
      return [Number.parseFloat(style.lineHeight), Number.parseFloat(style.fontSize)];
    });
    expect(printedHeight).toBeCloseTo(printedFontSize * 2, 0);
    await popup.close();
  });

  /**
   * Post-Phase-11.5 bug batch item 1: a real Sootr export (fixtures/
   * test-html-sootr.html - kept permanently, both as this regression's
   * fixture and as the real-document fixture Tier 3's performance-
   * validation gate had been blocked on) has a blockquote whose inline
   * content is bare <span> runs with no wrapping <p>, and a <table>
   * wrapped in nested <div>s. Both previously fell through parseBlock's
   * generic "unrecognized tag" fallback into `unknown` nodes, rendering as
   * "[Unsupported: span]"/"[Unsupported: div]" - the underlying text
   * survived (in `attrs.raw.html`, recoverable via re-export) but was
   * completely unreadable in the live editor, and the div-wrapped table's
   * structure was lost outright, not just its text. Fixed in
   * list/formats.ts (see docs/bugs/html-import-span-and-div-wrapped-
   * content-lost.md for the content-loss-vs-degradation analysis).
   */
  test("pastes a real Sootr export without losing the blockquote or the div-wrapped table", async ({ page }) => {
    const fixtureHtml = readFileSync("e2e/fixtures/test-html-sootr.html", "utf8");
    const mainMatch = fixtureHtml.match(/<main[^>]*>([\s\S]*)<\/main>/);
    if (!mainMatch) throw new Error("Fixture is missing its <main> wrapper - has the file changed?");
    const pasteHtml = mainMatch[1];

    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await page.evaluate((html) => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        surface: { pipeline: { handlePaste: (event: ClipboardEvent) => void } | null };
      } }).__smartProductCanonical!;
      const transfer = new DataTransfer();
      transfer.setData("text/html", html);
      transfer.setData("text/plain", "");
      runtime.surface.pipeline!.handlePaste({ clipboardData: transfer, preventDefault: () => undefined } as unknown as ClipboardEvent);
    }, pasteHtml);

    // No placeholder anywhere - the headline symptom from the report.
    await expect(editor).not.toContainText("Unsupported");

    // The blockquote's span-wrapped text survived completely, in order,
    // including the split runs ("divisio" + "ns or br" + "anc" + "hes")
    // that a naive "just grab textContent" fix could still get right while
    // silently merging - asserting the full string catches that too.
    const blockquote = editor.locator("blockquote");
    await expect(blockquote).toContainText(
      "What you have to learn:- What is the definition of anatomy?- What are the main divisions or branches of anatomy?- Why is learning anatomy important for nursing students?",
    );
    // The style-only bold span ("font-weight: bolder", no <strong> tag)
    // recovered as a real bold mark, not just plain text.
    await expect(blockquote.locator("strong")).toHaveText("What you have to learn:");

    // The div-wrapped table (<div align><div data-table-wrapper><table>)
    // parsed as a real table, not an opaque unknown block.
    const table = editor.locator("table");
    await expect(table).toBeVisible();
    await expect(table.locator("tr")).toHaveCount(8);
    await expect(table.locator("tr").nth(1).locator("td").first()).toContainText("Surface anatomy");

    const modelCheck = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { type: string; children?: unknown[] } };
      } }).__smartProductCanonical!;
      const collect = (node: { type: string; children?: unknown[] }, out: { type: string; children?: unknown[] }[]): typeof out => {
        out.push(node);
        (node.children || []).forEach((child) => collect(child as { type: string; children?: unknown[] }, out));
        return out;
      };
      const all = collect(runtime.editor.document as { type: string; children?: unknown[] }, []);
      return {
        unknownCount: all.filter((node) => node.type === "unknown").length,
        imageCount: all.filter((node) => node.type === "image").length,
        imageWidths: all.filter((node) => node.type === "image")
          .map((node) => (node as { attrs?: { width?: number } }).attrs?.width),
      };
    });
    // Zero unknown nodes anywhere in the pasted result - not just absent
    // from the visible text, absent from the model.
    expect(modelCheck.unknownCount).toBe(0);
    // The 4 real <img> tags in the fixture parsed as image atoms.
    expect(modelCheck.imageCount).toBe(4);
    // Every image in this real-world fixture sizes itself only via inline
    // `style="width:...px"`, never the legacy HTML width/height attributes
    // - a pasted image's size was previously dropped whenever a source
    // used style instead of attributes (see docs/bugs/pasted-image-size-
    // dropped-on-paste.md).
    expect(modelCheck.imageWidths).toEqual([400, 400, 400, 370]);
  });

  /**
   * 2026-08-26: "images copied from the web render as [Unsupported: img]".
   * fixtures/web-image-only-clipboard.html is a real, unmodified clipboard
   * capture - selecting a live Wikipedia photo element and copying it (the
   * closest scriptable equivalent of a native right-click "Copy image")
   * produced a bare `<a href="..."><img ...></a>` fragment, no <p>/<td>
   * wrapper at all. parseBlock had no case for a block-level <img> (the
   * ordinary shape for a standalone photo on most real sites - a bare
   * <img> between paragraphs, or one wrapped in <figure>/<a>) at all, so
   * it fell to the generic "unrecognized tag" fallback. See
   * docs/bugs/pasted-web-images-and-hr-render-as-unsupported.md.
   */
  test("pastes an image copied from a generic web page (not Sootr/Word/Google Docs) without showing [Unsupported: ...]", async ({ page }) => {
    const fixtureHtml = readFileSync("e2e/fixtures/web-image-only-clipboard.html", "utf8");

    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await page.evaluate((html) => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        surface: { pipeline: { handlePaste: (event: ClipboardEvent) => void } | null };
      } }).__smartProductCanonical!;
      const transfer = new DataTransfer();
      transfer.setData("text/html", html);
      transfer.setData("text/plain", "");
      runtime.surface.pipeline!.handlePaste({ clipboardData: transfer, preventDefault: () => undefined } as unknown as ClipboardEvent);
    }, fixtureHtml);

    await expect(editor).not.toContainText("Unsupported");
    await expect(editor.locator("img")).toHaveCount(1);
    await expect(editor.locator("img")).toHaveAttribute("src", /Golden_Gate_Bridge/);
  });

  /**
   * Same report, second item: <hr> also had no node type at all and fell
   * to "[Unsupported: hr]".
   */
  test("pastes a horizontal rule as a real divider instead of [Unsupported: hr]", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        surface: { pipeline: { handlePaste: (event: ClipboardEvent) => void } | null };
      } }).__smartProductCanonical!;
      const transfer = new DataTransfer();
      transfer.setData("text/html", "<p>Before</p><hr><p>After</p>");
      transfer.setData("text/plain", "");
      runtime.surface.pipeline!.handlePaste({ clipboardData: transfer, preventDefault: () => undefined } as unknown as ClipboardEvent);
    });

    await expect(editor).not.toContainText("Unsupported");
    await expect(editor.locator("hr")).toHaveCount(1);
  });

  /**
   * Follow-up to the divider fix above: making `divider` atomic+selectable
   * (needed so ordinary caret/Backspace/Delete behave correctly around an
   * `<hr>`) also made it satisfy the same "atomic node selected" scope that
   * previously rendered MediaOverlay for every selectable atom. Selecting a
   * divider must not surface media UI; images show resize handles on left-click
   * and their details editor on right-click.
   */
  test("selecting a divider does not surface media UI, but image interactions remain scoped", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        surface: { pipeline: { handlePaste: (event: ClipboardEvent) => void } | null };
      } }).__smartProductCanonical!;
      // A data: URI (rather than a real network URL) so the image renders
      // immediately and identically across browsers with no load-timing
      // flakiness - only the atom-selection/overlay-gating behavior below
      // is under test here.
      const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const transfer = new DataTransfer();
      transfer.setData("text/html", `<p>Before</p><hr><p><img src="${pixel}" alt="" width="100" height="80"></p>`);
      transfer.setData("text/plain", "");
      runtime.surface.pipeline!.handlePaste({ clipboardData: transfer, preventDefault: () => undefined } as unknown as ClipboardEvent);
    });

    const overlay = page.locator('[data-srte-media-overlay="true"]');
    await editor.locator("hr").click();
    await expect(overlay).not.toBeVisible();

    await editor.locator("img").click();
    await expect(overlay).not.toBeVisible();
    await expect(page.locator('[data-srte-media-resize-handle-direction]')).toHaveCount(8);
    await editor.locator("img").click({ button: "right" });
    await expect(page.locator('[data-srte-media-details-popover="true"]')).toBeVisible();
    await expect(overlay).toHaveCount(0);
  });

  /**
   * docs/bugs/horizontal-line-not-visibly-selectable.md - a left-click on a
   * divider/page break already set real node selection ("Delete selected
   * media" was enabled in the toolbar), but produced zero visible UI, which
   * read as "not selectable" from the outside. Right-click now surfaces the
   * same Delete-only action menu formula already gets (never Edit/Resize -
   * neither atom has an editable field or a width/height concept).
   */
  test("right-clicking a horizontal line or page break shows a Delete-only action menu, never Edit/Resize", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Horizontal line").click();
    await placeCaretAtEnd(page);
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Page break").click();

    const overlay = page.locator('[data-srte-media-overlay="true"]');
    for (const selector of ["hr", '[data-smart-type="page_break"]']) {
      await editor.locator(selector).click({ button: "right" });
      await expect(overlay).toBeVisible();
      await expect(overlay.getByRole("button", { name: "Edit" })).toHaveCount(0);
      await expect(page.locator('[data-srte-media-resize-handle-direction]')).toHaveCount(0);
      const deleteButton = overlay.getByRole("button", { name: "Delete" });
      await expect(deleteButton).toBeVisible();
      const countBefore = await editor.locator(selector).count();
      await deleteButton.click();
      await expect(editor.locator(selector)).toHaveCount(countBefore - 1);
    }
  });

  /**
   * "Horizontal line + page break tools" (2026-09-06). Item 1: the
   * `divider` atom already existed (schema/render/round-trip, confirmed
   * above) but had no deliberate insertion command at all - only reachable
   * by pasting a real <hr>. This is the new "Horizontal line" toolbar tool,
   * using the same insertAtom command pattern as image/video/audio.
   */
  test("inserts a horizontal line via the toolbar, using the same atom-insertion pattern as image/video/audio", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Horizontal line").click();
    await expect(editor.locator("hr")).toHaveCount(1);
    await expect(editor).not.toContainText("Unsupported");
  });

  /**
   * Item 2: "Page break" is genuinely new capability - a distinct atomic
   * node from `divider`, never reusing or overloading it. Confirms it
   * inserts via the toolbar, renders visibly distinct from a horizontal
   * line (a dashed marker with a "Page break" label, not a plain <hr>),
   * and - like divider - never surfaces media-editing UI when selected.
   */
  test("inserts a page break via the toolbar, rendered distinctly from a horizontal line and never surfacing media UI", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Page break").click();

    const pageBreak = editor.locator('[data-smart-type="page_break"]');
    await expect(pageBreak).toHaveCount(1);
    // A real, distinct node - not a divider, not an "unknown" placeholder.
    await expect(editor.locator("hr")).toHaveCount(0);
    await expect(editor).not.toContainText("Unsupported");
    // Visually distinct from a plain <hr> (dashed vs solid, with a label) -
    // asserting real computed style, not just presence of the node.
    await expect(pageBreak).toHaveCSS("border-top-style", "dashed");
    const label = await pageBreak.evaluate((element) => getComputedStyle(element, "::after").content);
    expect(label).toContain("Page break");

    // Left-click alone (like formula) shows no UI at all - only real node
    // selection. Right-click gets the same Delete-only action menu formula
    // and divider get (docs/bugs/horizontal-line-not-visibly-selectable.md)
    // - "never surfacing media UI" means never the full Media details
    // popover and never Edit/Resize, not "never any menu at all".
    const overlay = page.locator('[data-srte-media-overlay="true"]');
    await pageBreak.click();
    await expect(overlay).not.toBeVisible();
    await pageBreak.click({ button: "right" });
    await expect(page.locator('[data-srte-media-details-popover="true"]')).toHaveCount(0);
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.locator('[data-srte-media-resize-handle-direction]')).toHaveCount(0);
    await expect(overlay.getByRole("button", { name: "Delete" })).toBeVisible();
  });

  /**
   * Both tools reuse the exact same atom-insertion command
   * (insertBlockAtom -> insertAtom) that image/video/audio already use, so
   * ordinary Backspace/Delete around them (already covered generically by
   * the atomic-node deletion tests elsewhere) just works - this test
   * covers the one thing genuinely specific to these two: deleting either
   * one via the toolbar's own "Delete selected media" action (which,
   * despite its name, deletes any selected atom - see
   * insertMoreMenuItems's own comment on that button).
   */
  test("deletes a horizontal line and a page break via the toolbar's delete-selected-atom action", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Horizontal line").click();
    await placeCaretAtEnd(page);
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Page break").click();
    await expect(editor.locator("hr")).toHaveCount(1);
    await expect(editor.locator('[data-smart-type="page_break"]')).toHaveCount(1);

    await editor.locator('[data-smart-type="page_break"]').click();
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Delete selected media").click();
    await expect(editor.locator('[data-smart-type="page_break"]')).toHaveCount(0);
    await expect(editor.locator("hr")).toHaveCount(1);

    await editor.locator("hr").click();
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Delete selected media").click();
    await expect(editor.locator("hr")).toHaveCount(0);
  });

  /**
   * The actual point of building "Page break" at all: this package's real
   * "Save as PDF" feature (react/src/adapters/pdfPrint.ts) is a genuine
   * browser print of the same HTML export atomToHtml produces - not a
   * separate PDF-generation library. This proves the `break-before: page`
   * marker (atom/formats.ts's atomToHtml) produces REAL PDF pagination,
   * not just a visual line that happens to persist as text - counted from
   * a real generated PDF's own internal page objects, not inferred from
   * anything visual. Chromium-only: `page.pdf()` (used here to capture the
   * exact same document `window.print()` would have produced, without
   * depending on an actual OS print dialog) is a Chromium-specific
   * Playwright capability.
   */
  test("a page break produces a real second page in the actual 'Save as PDF' output, not just a visual marker", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "page.pdf() is Chromium-only.");
    await page.goto("/?canonicalAuthority=1&blocks=1");

    // Chromium's own print-to-PDF output places one page object per
    // rendered page at the top level (not inside a compressed object
    // stream) - counting raw `/Type /Page` occurrences (excluding the
    // plural `/Type /Pages` parent tree node) is a reliable, dependency-
    // free proxy for real page count for this specific generator,
    // confirmed directly against known single- and multi-page output
    // before relying on it here.
    const countPdfPages = async (): Promise<number> => {
      const popupPromise = page.waitForEvent("popup");
      await openToolbarDropdown(page, "Save a copy");
      await toolbarMenuItem(page, "Print / Save as PDF").click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      const buffer = await popup.pdf();
      await popup.close();
      const matches = buffer.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || [];
      return matches.length;
    };

    const pagesBefore = await countPdfPages();
    expect(pagesBefore).toBe(1);

    await placeCaretAtEnd(page);
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Page break").click();

    const pagesAfter = await countPdfPages();
    expect(pagesAfter).toBe(pagesBefore + 1);
  });

  /**
   * Reported live: "In PDF formula not rendering." Root cause: `buildPdfPrintDocument`
   * (formats/pdf/format.ts) called `serializeCanonicalListHtml` without
   * `renderFormulaHtml: true` - the same static-HTML-consumer gap already
   * fixed once for Sootr's Web Preview (docs/bugs/
   * formula-not-rendered-in-static-html-consumers.md), just never applied
   * to this second static consumer. Without it, every formula serializes
   * as an empty, invisible <span> - present in the DOM, blank on the page.
   * Also required adding KaTeX's own CSS to the print document (a brand
   * new, isolated window sharing none of the host page's stylesheets) -
   * without it, KaTeX's HTML renders as unstyled character soup, not real
   * typeset math. Asserts real rendered geometry inside the actual popup
   * window, not just that KaTeX markup is present in the HTML string.
   */
  test("a formula renders as real, visually laid-out math in the actual 'Save as PDF' output, not an empty or unstyled placeholder", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Asserting on the exact popup's rendered layout is only exercised on one engine, matching the other PDF-output test in this file.");
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await placeCaretAtEnd(page);
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Insert formula").click();
    await page.locator('[data-srte-formula-entry="algebra-quadratic"]').click();

    const popupPromise = page.waitForEvent("popup");
    await openToolbarDropdown(page, "Save a copy");
    await toolbarMenuItem(page, "Print / Save as PDF").click();
    const popup = await popupPromise;
    // The "load" event alone is not sufficient here: this print window's
    // KaTeX CSS is a separate CDN <link> (see buildPdfPrintDocument's own
    // comment - it shares none of the host page's stylesheets), and a
    // document.write()'d popup's "load" event does not reliably block on
    // that external stylesheet actually finishing and being applied before
    // resolving - confirmed directly (an identical assertion immediately
    // after waitForLoadState() alone was flaky/failed; polling briefly for
    // the real applied font, which the CDN fetch and font-face swap
    // genuinely need a moment for, is what this is waiting on).
    await popup.waitForLoadState();
    const katexRoot = popup.locator(".katex").first();
    await expect(katexRoot).toBeVisible();
    // katex.css's own top-level `.katex` rule sets `font: ... KaTeX_Main`
    // - a computed font-family that can only be present if this specific
    // stylesheet actually loaded and applied (unstyled, it would resolve
    // to the page's plain body font instead). This is the one property in
    // KaTeX's CSS most directly diagnostic of "did the CSS load", as
    // opposed to incidentally true even for unstyled spans.
    await expect(async () => {
      const fontFamily = await katexRoot.evaluate((element) => getComputedStyle(element).fontFamily);
      expect(fontFamily).toContain("KaTeX_Main");
    }).toPass({ timeout: 10_000 });
    // `.katex-mathml` (the accessibility-only MathML twin KaTeX always
    // emits alongside its visual HTML) is hidden via clip-path in
    // katex.css - without the stylesheet it would render fully visible,
    // duplicating the equation right next to its own unstyled HTML form.
    const mathmlClip = await popup.locator(".katex-mathml").first().evaluate((element) => getComputedStyle(element).clipPath);
    expect(mathmlClip).not.toBe("none");
    await popup.close();
  });

  /**
   * Post-Phase-11.5 bug batch item 2: the completion report's §A described
   * ContextMenu.tsx as "click-outside-to-close", but that claim had no
   * dedicated regression test - every existing context-menu e2e test
   * dismissed the menu by clicking one of its own items, which never
   * exercised the outside-click path at all. Extensive manual
   * re-verification (this test, repeated open/close cycles, near-viewport-
   * edge positions, all 3 browsers) could not reproduce the reported
   * failure - the listener was, and is, functionally correct. What *was*
   * real: ContextMenu's outside-click effect depended on `onDismiss`,
   * a new closure on every parent render (CanonicalAuthorityEditor
   * re-renders on every editor subscribe tick, which can fire while the
   * menu is still open), so the listener was torn down and reattached on
   * every such render - a genuine, narrow window during which a real,
   * differently-timed click could theoretically be missed, even though no
   * fast/isolated automated click ever landed inside that window. Fixed by
   * reading the latest onDismiss through a ref instead of the effect's own
   * dependency array, so the listener mounts exactly once per menu
   * lifetime; a mousedown fallback was added alongside pointerdown as
   * defense in depth. This test is the missing coverage either way.
   */
  test("closes the context menu on outside click and on Escape", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const menu = page.locator('[data-srte-context-menu="true"]');
    // Context menu scope reduction: table-only now - a right-click needs
    // a table cell to open anything at all, not plain text.
    await insertDefaultTable(page);
    const cell = editor.locator('[data-smart-type="table"] td').first();

    await cell.click({ button: "right" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();

    await cell.click({ button: "right" });
    await expect(menu).toBeVisible();
    await editor.locator("p").first().click();
    await expect(menu).not.toBeVisible();

    // Reopen and dismiss via an outside click far from the menu itself, so
    // the menu's own (possibly viewport-clamped) bounds can't overlap the
    // click target - a click that lands ON the menu is not an outside
    // click at all, regardless of what triggered it.
    await cell.click({ button: "right" });
    await expect(menu).toBeVisible();
    const menuBox = (await menu.boundingBox())!;
    await page.mouse.click(Math.max(4, menuBox.x - 20), Math.max(4, menuBox.y - 20));
    await expect(menu).not.toBeVisible();
  });

  /**
   * Post-Phase-11.5 bug batch item 3: two real, distinct causes of "the
   * menu shows the same options regardless of what was right-clicked":
   *
   * 1. Atom selection is not native browser behavior - it's
   *    InputController's clickListener (surface/input.ts), bound to the
   *    "click" DOM event, which never fires for a right-click. A direct
   *    right-click on an atom (no preceding left-click - the realistic
   *    case) left whatever selection existed before in place, so
   *    atomic-node scope never resolved and MediaOverlay (which shows
   *    whenever atomSelected is true) never appeared. Still relevant after
   *    the later context-menu scope reduction below: MediaOverlay depends
   *    on the exact same atom-selection fix.
   *
   * Context menu scope reduction (later work order): the menu is now
   * table-only for ordinary text. Images use their dedicated right-click
   * details editor, other media keeps its quick-action menu, and links keep
   * their existing editor popover behavior.
   */
  test("scopes the context menu to tables and media", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const menu = page.locator('[data-srte-context-menu="true"]');

    // Plain text: no menu at all.
    await editor.locator("p").first().click({ button: "right" });
    await page.waitForTimeout(100);
    await expect(menu).toHaveCount(0);

    // Table cell: table items only, no marks.
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    await table.locator("td").first().click({ button: "right" });
    await expect(menu).toBeVisible();
    const tableItems = await page.evaluate(() => Array.from(document.querySelectorAll("[data-srte-context-menu-item]"))
      .map((element) => element.getAttribute("data-srte-context-menu-item")));
    expect(tableItems).toContain("table.contextMenu.mergeCells");
    expect(tableItems.some((id) => id?.startsWith("marks.contextMenu."))).toBe(false);
    await page.keyboard.press("Escape");

    // Atom, right-clicked directly with NO preceding left-click: the media
    // details editor must resolve the clicked atom, not the previous selection.
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: unknown[] }; schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const doc = runtime.editor.document;
      (doc.children as unknown[]).push({
        type: "paragraph", id: "ctxmenu-atom-p",
        children: [{ type: "image", id: "ctxmenu-atom-img", attrs: { src: "https://example.com/x.png", alt: "x" } }],
      });
      runtime.replaceValue({ schemaVersion: runtime.editor.schema.version, revision: runtime.editor.state.revision + 1, document: doc });
    });
    const image = editor.locator('[data-smart-id="ctxmenu-atom-img"]');
    await image.click({ button: "right" });
    await expect(page.locator('[data-srte-media-details-popover="true"]')).toBeVisible();
    await expect(page.locator('[data-srte-media-overlay="true"]')).toHaveCount(0);
    await expect(page.locator('[data-srte-media-resize-handle-direction]')).toHaveCount(8);
    await expect(menu).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Link: no generic context menu - the auto overlay is the edit surface.
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: unknown[] }; schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const doc = runtime.editor.document;
      (doc.children as unknown[]).push({
        type: "paragraph", id: "ctxmenu-link-p",
        children: [{ type: "text", text: "a link here", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }],
      });
      runtime.replaceValue({ schemaVersion: runtime.editor.schema.version, revision: runtime.editor.state.revision + 1, document: doc });
    });
    // Target the <a> element itself, not the (much wider, block-level)
    // paragraph - a wide paragraph's bounding-box center can land on blank
    // space well past the actual text, which some engines (webkit) don't
    // treat as "clicking near text" for native caret repositioning.
    await editor.locator('[data-smart-id="ctxmenu-link-p"] a').click({ button: "right" });
    await page.waitForTimeout(100);
    await expect(menu).toHaveCount(0);
  });

  /**
   * Post-Phase-11.5 bug batch item 4: ContextMenu.tsx previously clamped
   * its position against a hardcoded 220px width/34px-per-item height
   * estimate - real item labels ("Insert column right") can exceed that
   * assumed width, and the clamp math never flipped the menu to the
   * opposite side, only slid it (still overflowing when the assumed size
   * was wrong). Fixed with a real two-pass measure: render invisibly at
   * the raw click point, measure the actual DOM size, then compute a
   * final position that flips left/up when the default open direction
   * would overflow, plus a maxHeight/overflowY so a menu taller than the
   * remaining viewport scrolls instead of extending off-screen.
   * Context menu scope reduction (later work order) made the menu table-
   * only, so this and the next test now right-click real cells of a table
   * built large enough to reach the viewport's edges, via real mouse
   * clicks (not a synthetic "contextmenu" DOM event targeting the bare
   * root) - a synthetic event's target wouldn't resolve table-grid scope
   * the way an event genuinely dispatched at a table cell does.
   */
  test("keeps the context menu fully within the viewport at every edge, and scrolls when taller than available space", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const viewport = page.viewportSize()!;
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    // 8x30 comfortably overflows a standard viewport in both dimensions,
    // so cells genuinely near each edge exist to right-click on. Locators
    // (not manually computed pixel coordinates) target specific known
    // cells - Playwright scrolls each into view and clicks its own center,
    // which stays correct regardless of per-browser row-height/layout
    // differences that made hand-computed coordinates unreliable.
    await page.evaluate(() => {
      const runtime = (window as typeof window & {
        __smartProductCanonical?: { editor: { schema: { version: number }; state: { revision: number } }; replaceValue: (value: unknown) => void };
      }).__smartProductCanonical!;
      const cell = (id: string, text: string) => ({ type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: `${id}-p`, children: [{ type: "text", text }] }] });
      const rows = Array.from({ length: 30 }, (_, r) => ({
        type: "table_row", id: `edge-row-${r}`,
        children: Array.from({ length: 8 }, (_, c) => cell(`edge-cell-${r}-${c}`, `${r},${c}`)),
      }));
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "edge-doc", children: [{ type: "table", id: "edge-table", children: rows }] },
      });
    });
    const menu = page.locator('[data-srte-context-menu="true"]');
    const topRightCell = editor.locator('[data-smart-id="edge-cell-0-7"]');
    const bottomLeftCell = editor.locator('[data-smart-id="edge-cell-29-0"]');
    const bottomRightCell = editor.locator('[data-smart-id="edge-cell-29-7"]');

    await topRightCell.scrollIntoViewIfNeeded();
    await topRightCell.click({ button: "right" });
    await expect(menu).toBeVisible();
    let box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();

    await bottomLeftCell.scrollIntoViewIfNeeded();
    await bottomLeftCell.click({ button: "right" });
    await expect(menu).toBeVisible();
    box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();

    await bottomRightCell.scrollIntoViewIfNeeded();
    await bottomRightCell.click({ button: "right" });
    await expect(menu).toBeVisible();
    box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  });

  test("scrolls the context menu internally instead of overflowing when it's taller than the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 350 });
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const menu = page.locator('[data-srte-context-menu="true"]');
    await insertDefaultTable(page);
    const cell = editor.locator('[data-smart-type="table"] td').first();
    await cell.click({ button: "right" });
    await expect(menu).toBeVisible();
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(350);
    const clientHeight = await menu.evaluate((element) => element.clientHeight);
    const scrollHeight = await menu.evaluate((element) => element.scrollHeight);
    expect(scrollHeight).toBeGreaterThan(clientHeight);
  });

  /**
   * Post-Phase-11.5 bug batch item 5: a right-click near a shared cell
   * border produced a highlight spanning multiple cells, well past what a
   * simple right-click should ever select. Root cause: surface/input.ts's
   * tableMouseDownListener/tableMouseUpListener (native "mousedown"/
   * "mouseup" listeners implementing left-click-drag cell-range selection)
   * never checked event.button - a right-click's own mousedown/mouseup
   * pair reaches the exact same listeners, and a real hand's natural
   * few-pixel wobble between press and release is easily enough to land
   * the two events in different cells near a shared border, silently
   * forming a genuine multi-cell "cell" selection the user never intended
   * (confirmed directly: mousedown targeted one cell's paragraph, mouseup
   * targeted the adjacent cell's, and editor.selection.type became "cell"
   * with 2 data-smart-cell-selected elements). Fixed by only starting the
   * drag-selection gesture for the primary (left) button.
   */
  test("does not form a multi-cell selection from a right-click near a cell border", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    const box = (await table.locator("td").first().boundingBox())!;
    const borderX = box.x + box.width;
    const borderY = box.y + box.height / 2;

    await page.mouse.move(box.x + 10, borderY);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(borderX + 20, borderY, { steps: 5 });
    await page.mouse.up({ button: "right" });
    const afterRightClick = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { selection: { type: string } } } }).__smartProductCanonical!;
      return { selectionType: runtime.editor.selection.type, cellSelectedCount: document.querySelectorAll("[data-smart-cell-selected]").length };
    });
    expect(afterRightClick.selectionType).not.toBe("cell");
    expect(afterRightClick.cellSelectedCount).toBe(0);
  });

  test("a left-click drag across a cell border still forms a real cell selection", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    const box = (await table.locator("td").first().boundingBox())!;
    const borderX = box.x + box.width;
    const borderY = box.y + box.height / 2;

    await page.mouse.move(box.x + 10, borderY);
    await page.mouse.down();
    await page.mouse.move(borderX + 20, borderY, { steps: 5 });
    await page.mouse.up();
    const afterLeftDrag = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { selection: { type: string } } } }).__smartProductCanonical!;
      return { selectionType: runtime.editor.selection.type, cellSelectedCount: document.querySelectorAll("[data-smart-cell-selected]").length };
    });
    expect(afterLeftDrag.selectionType).toBe("cell");
    expect(afterLeftDrag.cellSelectedCount).toBe(2);
  });

  /**
   * Post-Phase-11.5 bug batch item 6: three related table-resize defects,
   * all found investigating the same report.
   *
   * 1. "Not smooth, doesn't update live": TableResizeHandles.tsx dragged
   *    with commit-on-release only - nothing rendered until pointerup, so
   *    the whole gesture looked frozen until it suddenly jumped. Fixed by
   *    mutating the real <col>/<tr> directly during the drag (still
   *    committing only the final value via setTableColumnWidthCommand/
   *    setTableRowHeightCommand on release).
   * 2. "Resizing one column moves a neighboring column": the stylesheet's
   *    `table { width: 100% }` combined with the renderer's
   *    `table-layout: fixed` (set whenever columnWidths is present) made
   *    every <col> width a *proportion* of the table's rendered width,
   *    not a literal pixel value - growing one column shifted everyone
   *    else's proportional share. Fixed by pinning the table's own inline
   *    width to the literal sum of columnWidths (surface/renderer.ts),
   *    both at rest and live during the drag.
   * 3. A third, related defect found while reproducing #1: column and row
   *    resize handles are both full-length/full-height overlays that
   *    cross at every boundary intersection - with no z-index difference,
   *    whichever rendered later in the DOM won pointer hit-testing at an
   *    exact overlap, so a column-drag started at the wrong y-coordinate
   *    could silently grab a row handle instead. Fixed by rendering
   *    column handles after row handles, so a column drag always wins.
   */
  /**
   * Post-batch follow-up ("why resizing column or row effect whole table?
   * I want border to move only... if user increase or decrease rightmost
   * column then only table width matters"): dragging an *internal*
   * boundary now redistributes between the two columns it actually sits
   * between - the far column (not adjacent to this boundary at all) stays
   * untouched, and the table's total width is unchanged, matching a
   * standard spreadsheet/word-processor resize. Only the *last* column's
   * own outer-edge handle still changes the table's total width - see the
   * companion test below.
   */
  test("previews table column resize live during the drag, redistributes with the adjacent column, and leaves the far column and table width untouched", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const cell = (id: string, text: string) => ({
        type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false },
        children: [{ type: "paragraph", id: `${id}-p`, children: [{ type: "text", text }] }],
      });
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "resize3-doc", children: [
          { type: "table", id: "resize3-table", attrs: { columnWidths: [120, 120, 120], layout: "fixed" }, children: [
            { type: "table_row", id: "resize3-row0", children: [cell("resize3-a0", "a0"), cell("resize3-b0", "b0"), cell("resize3-c0", "c0")] },
            { type: "table_row", id: "resize3-row1", children: [cell("resize3-a1", "a1"), cell("resize3-b1", "b1"), cell("resize3-c1", "c1")] },
          ] },
        ] },
      });
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const table = editor.locator('[data-smart-type="table"]');
    const cellA = editor.locator('[data-smart-id="resize3-a0"]');
    await selectCellRange(page, cellA, cellA);

    const startWidthA = (await cellA.boundingBox())!.width;
    const startTableWidth = (await table.boundingBox())!.width;
    // Drag the boundary between column 2 (index 1) and column 3 (index 2) -
    // column 1 (cellA), not adjacent to this boundary at all, must never
    // move; column 3 (adjacent, on the other side) absorbs the change
    // instead. TableResizeHandles renders as a sibling of the
    // contentEditable root, not inside it - scope to page, not editor.
    const handle = page.locator('[data-srte-column-resize-handle="1"]');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 8 });

    // Still mid-drag: column 1 (not adjacent to the dragged boundary) and
    // the table's own overall width must both stay put - live preview
    // must not reintroduce the whole-table-grows bug for an internal drag.
    const midDragWidthA = (await cellA.boundingBox())!.width;
    const midDragTableWidth = (await table.boundingBox())!.width;
    expect(Math.abs(midDragWidthA - startWidthA)).toBeLessThan(5);
    expect(Math.abs(midDragTableWidth - startTableWidth)).toBeLessThan(5);

    await page.mouse.up();
    const finalWidthA = (await cellA.boundingBox())!.width;
    const finalTableWidth = (await table.boundingBox())!.width;
    const modelWidths = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ id: string; attrs?: { columnWidths?: number[] } }> } };
      } }).__smartProductCanonical!;
      return runtime.editor.document.children.find((child) => child.id === "resize3-table")?.attrs?.columnWidths;
    });
    expect(finalWidthA).toBeCloseTo(startWidthA, 0);
    expect(Math.abs(finalTableWidth - startTableWidth)).toBeLessThan(2);
    expect(modelWidths?.[0]).toBeCloseTo(120, 0);
    expect(modelWidths?.[1]).toBeGreaterThan(150);
    // Column 3 gave up what column 2 gained - the pair's sum is unchanged.
    expect((modelWidths?.[1] ?? 0) + (modelWidths?.[2] ?? 0)).toBeCloseTo(240, 0);
  });

  /**
   * The symmetric case: dragging the *last* column's own outer-edge
   * handle has no neighbor to redistribute with, so it still changes the
   * table's total width - exactly the "if user increase or decrease
   * rightmost column then only table width matters" half of the report.
   */
  test("resizing the last column's own edge changes the table's total width, with no neighbor to redistribute with", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const cell = (id: string, text: string) => ({
        type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false },
        children: [{ type: "paragraph", id: `${id}-p`, children: [{ type: "text", text }] }],
      });
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "resize-last-doc", children: [
          { type: "table", id: "resize-last-table", attrs: { columnWidths: [120, 120, 120], layout: "fixed" }, children: [
            { type: "table_row", id: "resize-last-row0", children: [cell("resize-last-a0", "a0"), cell("resize-last-b0", "b0"), cell("resize-last-c0", "c0")] },
          ] },
        ] },
      });
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const table = editor.locator('[data-smart-type="table"]');
    const startTableWidth = (await table.boundingBox())!.width;

    const handle = page.locator('[data-srte-column-resize-handle="2"]');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const finalTableWidth = (await table.boundingBox())!.width;
    expect(finalTableWidth).toBeGreaterThan(startTableWidth + 30);
    const modelWidths = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ id: string; attrs?: { columnWidths?: number[] } }> } };
      } }).__smartProductCanonical!;
      return runtime.editor.document.children.find((child) => child.id === "resize-last-table")?.attrs?.columnWidths;
    });
    expect(modelWidths?.[0]).toBeCloseTo(120, 0);
    expect(modelWidths?.[1]).toBeCloseTo(120, 0);
    expect(modelWidths?.[2]).toBeGreaterThan(150);
  });

  /**
   * Same redistribution behavior, for rows: dragging an internal row
   * boundary grows one row and shrinks its immediate neighbor by the same
   * amount (their combined height is unchanged) instead of only ever
   * growing the table's total height.
   */
  test("resizing an internal row boundary redistributes with the adjacent row, leaving a distant row and the pair's total height untouched", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const cell = (id: string, text: string) => ({
        type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false },
        children: [{ type: "paragraph", id: `${id}-p`, children: [{ type: "text", text }] }],
      });
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "resize-row-doc", children: [
          // 150px starting height, well above a single-short-word cell's
          // natural content floor (~55px, from padding + one line of
          // text) - see docs/bugs/row-resize-drag-up-only-grows-the-row-
          // below.md: a <tr>'s rendered height can never go below its own
          // content's natural minimum, so shrinking a row by 25px needs
          // real headroom above that floor for the shrink to actually
          // happen, or the redistribution invariant this test checks
          // holds trivially (nothing moves) rather than meaningfully.
          { type: "table", id: "resize-row-table", attrs: { columnWidths: [150, 150] }, children: [
            { type: "table_row", id: "resize-row-r0", attrs: { height: 150 }, children: [cell("resize-row-a0", "A"), cell("resize-row-b0", "B")] },
            { type: "table_row", id: "resize-row-r1", attrs: { height: 150 }, children: [cell("resize-row-a1", "C"), cell("resize-row-b1", "D")] },
            { type: "table_row", id: "resize-row-r2", attrs: { height: 150 }, children: [cell("resize-row-a2", "E"), cell("resize-row-b2", "F")] },
          ] },
        ] },
      });
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const cellE = editor.locator('[data-smart-id="resize-row-a2"]');
    await cellE.click();
    const startHeightE = (await cellE.boundingBox())!.height;

    // Click away from the table's horizontal midpoint - a symmetric
    // 2-column table's column-boundary handle otherwise sits exactly
    // there and wins the deliberate handle-overlap tie-break.
    const handle = page.locator('[data-srte-row-resize-handle="0"]');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 15, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 15, box.y + box.height / 2 + 25, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const finalHeightE = (await cellE.boundingBox())!.height;
    expect(Math.abs(finalHeightE - startHeightE)).toBeLessThan(5);
    const heights = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ id: string; children?: Array<{ attrs?: { height?: number } }> }> } };
      } }).__smartProductCanonical!;
      const table = runtime.editor.document.children.find((child) => child.id === "resize-row-table");
      return table?.children?.map((row) => row.attrs?.height);
    });
    expect(heights?.[0]).toBeGreaterThan(165);
    expect(heights?.[2]).toBeCloseTo(150, 0);
    expect((heights?.[0] ?? 0) + (heights?.[1] ?? 0)).toBeCloseTo(300, 0);
  });

  /**
   * Post-batch follow-up, "Resize vertically is not working same as it
   * behaves horizantaly. Also, that blue line and actual border during
   * resize are misplaced. blue line is veryslow." - TableResizeHandles.tsx
   * only refreshed a handle's own on-screen position via ResizeObserver on
   * the <table> element's box size. An internal row-boundary drag keeps
   * the table's total height exactly constant by construction (the two
   * adjacent rows' heights change by equal and opposite amounts), so that
   * observer never fires mid-drag and the row handle stayed frozen at its
   * pre-drag position while the real row border moved live underneath it.
   * Column drags happened to work because table-layout: fixed's own
   * sub-pixel width redistribution incidentally nudges the table's
   * rendered width, retriggering the observer by accident.
   */
  test("row resize handle tracks the live row border during the drag, not just after release", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const cell = (id: string, text: string) => ({
        type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false },
        children: [{ type: "paragraph", id: `${id}-p`, children: [{ type: "text", text }] }],
      });
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "resize-row-track-doc", children: [
          // 150px, not 60px: see the internal-row-boundary test above for
          // why the shrinking side needs real headroom above a single-
          // short-word cell's natural content floor (~55px).
          { type: "table", id: "resize-row-track-table", attrs: { columnWidths: [150, 150] }, children: [
            { type: "table_row", id: "resize-row-track-r0", attrs: { height: 150 }, children: [cell("resize-row-track-a0", "A"), cell("resize-row-track-b0", "B")] },
            { type: "table_row", id: "resize-row-track-r1", attrs: { height: 150 }, children: [cell("resize-row-track-a1", "C"), cell("resize-row-track-b1", "D")] },
          ] },
        ] },
      });
    });
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const cellA = editor.locator('[data-smart-id="resize-row-track-a0"]');
    await cellA.click();

    const handle = page.locator('[data-srte-row-resize-handle="0"]');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    // Off-center to avoid the deliberate column-handle tie-break at the
    // table's exact horizontal midpoint (see the internal-row-boundary
    // test above).
    await page.mouse.move(box.x + 15, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 15, box.y + box.height / 2 + 40, { steps: 8 });

    // Mid-drag (before release): the handle's own rendered position must
    // already have followed the row border it's currently dragging, not
    // stayed at its pre-drag measurement.
    const midDragHandleBox = (await handle.boundingBox())!;
    const midDragRowBottom = (await cellA.boundingBox())!.y + (await cellA.boundingBox())!.height;
    expect(Math.abs(midDragHandleBox.y + midDragHandleBox.height / 2 - midDragRowBottom)).toBeLessThan(4);
    expect(midDragHandleBox.y).toBeGreaterThan(box.y + 20);

    await page.mouse.up();
  });

  /**
   * Post-batch follow-up, "if i resize rows. click on icon hold and move
   * cursor up then it is effecting below row height." A <tr>'s rendered
   * height can never go below what its own cell content needs (an
   * explicit row height is a minimum, not a hard cap, in table layout) -
   * unlike a column's width under table-layout:fixed, which genuinely can
   * be squeezed below its content's natural width. A freshly-inserted
   * table's rows are already at that natural floor (short/empty cell
   * content), so dragging the boundary between them upward - intending to
   * shrink the row above - previously computed the *neighbor's* new size
   * from the full requested delta regardless of whether the row above
   * actually gave up any space, silently growing only the row below while
   * the row the user was actually dragging stayed frozen. See
   * docs/bugs/row-resize-drag-up-only-grows-the-row-below.md.
   */
  test("dragging a row boundary up does not grow the row below when the row above has no room to shrink", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    await expect(table).toBeVisible();
    await table.locator("td").first().click();

    const rows = table.locator("tr");
    const rowHeightsBefore = await rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));

    const handle = page.locator('[data-srte-row-resize-handle="0"]');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 15, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 15, box.y + box.height / 2 - 25, { steps: 8 });
    await page.waitForTimeout(50);

    // Mid-drag: the row above (already at its natural content floor)
    // cannot have shrunk further, so the row below - having been given
    // nothing to absorb - must not have grown either.
    const rowHeightsMidDrag = await rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(rowHeightsMidDrag[0]).toBeCloseTo(rowHeightsBefore[0], 0);
    expect(rowHeightsMidDrag[1]).toBeCloseTo(rowHeightsBefore[1], 0);

    await page.mouse.up();
    await page.waitForTimeout(100);
    const heightsAfterRelease = await rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(heightsAfterRelease[1]).toBeCloseTo(rowHeightsBefore[1], 0);
  });

  /**
   * Post-batch follow-up, "row resize not working. Couldn't able to drag
   * up or down." A fix for a related report (dragging a row boundary up
   * silently grew the row below by the full requested delta even when the
   * row above had no room to shrink) made the dragged row's own growth
   * strictly conditional on the neighbor actually having room to shrink -
   * correct for the *shrinking* side (a row genuinely can't go below its
   * content's natural height, no workaround exists), but wrong for the
   * *growing* side (a row's height only ever has a floor, never a
   * ceiling - CSS always lets a <tr> grow). On a freshly-created or
   * pasted table, every row already sits at that same floor, so with the
   * conditional-growth logic, dragging *either* direction did nothing at
   * all: shrinking had nowhere to go, and growing was blocked because the
   * neighbor had nowhere to give either. See docs/bugs/
   * row-resize-blocked-when-every-row-is-at-its-floor.md.
   */
  test("dragging a row boundary down grows the dragged row even when the row below has no room to shrink", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    await expect(table).toBeVisible();
    await table.locator("td").first().click();

    const rows = table.locator("tr");
    const rowHeightsBefore = await rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));

    const handle = page.locator('[data-srte-row-resize-handle="0"]');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 15, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 15, box.y + box.height / 2 + 40, { steps: 8 });
    await page.waitForTimeout(50);

    // Mid-drag: the row being dragged must visibly grow - the row below
    // (also at its own natural floor, so it cannot cede any space) is not
    // allowed to silently block that.
    const rowHeightsMidDrag = await rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(rowHeightsMidDrag[0]).toBeGreaterThan(rowHeightsBefore[0] + 20);
    expect(rowHeightsMidDrag[1]).toBeCloseTo(rowHeightsBefore[1], 0);

    await page.mouse.up();
    await page.waitForTimeout(100);
    const heights = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ type: string; children?: Array<{ attrs?: { height?: number } }> }> } };
      } }).__smartProductCanonical!;
      const tableNode = runtime.editor.document.children.find((child) => child.type === "table");
      return tableNode?.children?.map((row) => row.attrs?.height);
    });
    expect(heights?.[0]).toBeGreaterThan((rowHeightsBefore[0] ?? 0) + 20);
  });

  /**
   * "if I resize row or column then while dragging it's adjacent one's
   * doing effected... but as soon as user stop dragging and drop the
   * cursor then if user again try to make it back as normal dragging same
   * border line but it make space as edited by resize to adjacent one
   * below to the row as well. User can't undo in 1 step without using
   * undo button." - on a freshly-inserted table (every row at its own
   * natural content floor, no real slack), the previous fix's "let the
   * table grow instead of blocking the drag" (row-resize-blocked-when-
   * every-row-is-at-its-floor.md) means the row below never actually gave
   * up any space to the dragged row above - it just held still while the
   * table grew around it. Dragging the same border back up should
   * therefore shrink the table back down to its original total, not
   * balloon that same row further, which is what happened before this
   * fix (docs/bugs/row-resize-round-trip-inflates-neighbor.md).
   */
  test("dragging a row boundary down then back up on a floor-height table round-trips cleanly, without inflating the neighbor", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    await expect(table).toBeVisible();
    await table.locator("td").first().click();

    const rows = table.locator("tr");
    const readRenderedHeights = () => rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    const readModelHeights = () => page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: Array<{ type: string; children?: Array<{ attrs?: { height?: number } }> }> } };
      } }).__smartProductCanonical!;
      const tableNode = runtime.editor.document.children.find((child) => child.type === "table");
      return tableNode?.children?.map((row) => row.attrs?.height);
    });
    const originalHeights = await readRenderedHeights();

    const dragBoundary = async (deltaY: number) => {
      const handle = page.locator('[data-srte-row-resize-handle="0"]');
      await expect(handle).toBeVisible();
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + 15, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 15, box.y + box.height / 2 + deltaY, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(100);
    };

    await dragBoundary(40);
    const modelAfterDown = await readModelHeights();
    expect(modelAfterDown?.[0]).toBeGreaterThan(originalHeights[0] + 20);

    await dragBoundary(-40);
    const afterUp = await readRenderedHeights();
    // Row 0 (dragged) is back near its original size, and row 1 (the
    // neighbor that never actually gave up anything) is NOT left inflated
    // above where it started - the whole point of this regression.
    expect(Math.abs(afterUp[0] - originalHeights[0])).toBeLessThan(5);
    expect(Math.abs(afterUp[1] - originalHeights[1])).toBeLessThan(5);
  });

  /**
   * Post-batch follow-up (user screenshot): every row/column resize
   * handle highlighted blue during a single drag, not just the one being
   * dragged - TableResizeHandles.tsx's highlight condition checked only
   * `dragging?.kind`, never `dragging.index`, so every handle of the same
   * kind matched together.
   */
  test("highlights only the resize handle actually being dragged", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    await expect(table).toBeVisible();
    await table.locator("td").first().click();

    const draggedHandle = page.locator('[data-srte-column-resize-handle="0"]');
    const otherHandle = page.locator('[data-srte-column-resize-handle="1"]');
    await expect(draggedHandle).toBeVisible();
    await expect(otherHandle).toBeVisible();
    const box = (await draggedHandle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });

    const draggedBg = await draggedHandle.evaluate((element) => getComputedStyle(element).backgroundColor);
    const otherBg = await otherHandle.evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.mouse.up();
    expect(draggedBg).not.toBe("rgba(0, 0, 0, 0)");
    expect(otherBg).toBe("rgba(0, 0, 0, 0)");
  });

  /**
   * Post-batch follow-up (user report): a pasted table rendered much
   * narrower than its copied content, because <col>s with no real pixel
   * width data got a fabricated 120px fallback, and the renderer's
   * table-width pin (item 6 of the prior batch) made that fake size the
   * table's real, visible width instead of the natural stretched default.
   */
  test("does not shrink a pasted table whose source has no real column pixel widths", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const editorWidth = (await editor.boundingBox())!.width;
    await placeCaretAtEnd(page);
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        surface: { pipeline: { handlePaste: (event: ClipboardEvent) => void } | null };
      } }).__smartProductCanonical!;
      const html = '<table><colgroup><col><col></colgroup><tbody>'
        + '<tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>';
      const transfer = new DataTransfer();
      transfer.setData("text/html", html);
      transfer.setData("text/plain", "");
      runtime.surface.pipeline!.handlePaste({ clipboardData: transfer, preventDefault: () => undefined } as unknown as ClipboardEvent);
    });
    const table = editor.locator('[data-smart-type="table"]');
    await expect(table).toBeVisible();
    const tableWidth = (await table.boundingBox())!.width;
    expect(tableWidth).toBeGreaterThan(editorWidth * 0.8);
  });

  /**
   * Post-batch follow-up (user question: "why doesn't table context menu
   * have cell style etc"): table_cell.attrs.background/textColor were
   * already real, settable attrs (via table.setCellAttributes) but the
   * table context menu had no UI for either - and attrs.textColor turned
   * out to have never been rendered at all (docs/bugs/
   * table-cell-text-color-not-rendered.md), the same "written, never
   * rendered" shape as table columnWidths before it. Both now have
   * context-menu items reusing the same ColorPickerPopover the toolbar's
   * text/background colour buttons already use.
   */
  test("sets cell background and text colour via the right-click context menu", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    const cell = table.locator("td").first();
    await cell.click({ button: "right" });
    const menu = page.locator('[data-srte-context-menu="true"]');
    await expect(menu).toBeVisible();
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.cellBackgroundColor"]').click();
    const colorPopover = page.locator('[data-srte-color-popover="true"]');
    await expect(colorPopover).toBeVisible();
    await pickColor(page, "#ffc9c9");
    await expect(cell).toHaveCSS("background-color", "rgb(255, 201, 201)");

    await cell.click({ button: "right" });
    await expect(menu).toBeVisible();
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.cellTextColor"]').click();
    await expect(colorPopover).toBeVisible();
    await page.locator("[data-srte-color-hex-input]").fill("#1971c2");
    await page.keyboard.press("Escape");
    await expect(cell).toHaveCSS("color", "rgb(25, 113, 194)");
  });

  /**
   * table_cell's border attrs already existed (uniform `borders`), already
   * rendered, already round-tripped through HTML/DOCX - only never settable
   * from this editor's own UI. Per-side attrs (borderTop/Right/Bottom/Left)
   * were added specifically for the "which sides" control below
   * (docs/bugs/table-cell-border-color-width-no-ui.md's addendum, filed
   * after a follow-up request for per-side control + a style option).
   * Covers both entry points (the "Table tools" dropdown's single "Border
   * options" item, and the context menu's "Cell border options" item),
   * side toggling, style, width, colour (via the nested, unmodified
   * ColorPickerPopover), live preview before Apply, and Cancel reverting.
   */
  test("sets cell border sides, style, width, and colour via the Border options popover", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    const cell = table.locator("td").first();
    await selectCellRange(page, cell, cell);
    const popover = page.locator('[data-srte-table-border-popover="true"]');

    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Border options").click();
    await expect(popover).toBeVisible();
    // Defaults to no side selected, since this cell has no border attrs yet
    // (the table's own default gridlines mean border-top-style is already
    // "solid" from ambient CSS regardless, so this checks the popover's own
    // toggle state, not the cell's already-non-neutral computed style).
    await expect(popover.getByRole("button", { name: "Top border" })).toHaveAttribute("aria-pressed", "false");

    // Only the top side, dashed, thick, default black - preview before Apply.
    await popover.getByRole("button", { name: "Top border" }).click();
    await popover.getByRole("combobox", { name: "Border style" }).selectOption("dashed");
    await popover.getByRole("combobox", { name: "Border width" }).selectOption("thick");
    await expect(cell).toHaveCSS("border-top-style", "dashed");
    await expect(cell).toHaveCSS("border-top-width", "4px");
    // Only the top side was toggled on - left/right/bottom stay borderless.
    await expect(cell).not.toHaveCSS("border-left-style", "dashed");

    // Colour via the nested, unmodified ColorPickerPopover.
    await popover.getByRole("button", { name: "Border colour" }).click();
    const colorPopover = page.locator('[data-srte-color-popover="true"]');
    await expect(colorPopover).toBeVisible();
    await page.locator("[data-srte-color-hex-input]").fill("#2f9e44");
    await page.keyboard.press("Escape"); // Commits into the border popover's own staged draft, not the document yet.
    await expect(colorPopover).not.toBeVisible();
    await expect(popover).toBeVisible();
    await expect(cell).toHaveCSS("border-top-color", "rgb(47, 158, 68)"); // Still just a preview.

    await popover.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(popover).not.toBeVisible();
    await expect(cell).toHaveCSS("border-top-style", "dashed");
    await expect(cell).toHaveCSS("border-top-color", "rgb(47, 158, 68)");

    // Reopening (via the context menu this time) reflects the committed state.
    await cell.click({ button: "right" });
    const menu = page.locator('[data-srte-context-menu="true"]');
    await expect(menu).toBeVisible();
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.cellBorderOptions"]').click();
    await expect(popover).toBeVisible();
    await expect(popover.getByRole("button", { name: "Top border" })).toHaveAttribute("aria-pressed", "true");
    await expect(popover.getByRole("combobox", { name: "Border style" })).toHaveValue("dashed");
    await expect(popover.getByRole("combobox", { name: "Border width" })).toHaveValue("thick");
    await expect(popover.getByRole("button", { name: "Border colour" })).toContainText("#2f9e44");

    // "All sides" + Cancel: previews live, then fully reverts on Cancel.
    await popover.getByRole("button", { name: "All sides", exact: true }).click();
    await expect(cell).toHaveCSS("border-right-style", "dashed");
    await popover.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(popover).not.toBeVisible();
    await expect(cell).not.toHaveCSS("border-right-style", "dashed");
    await expect(cell).toHaveCSS("border-top-style", "dashed"); // Unaffected - the only side actually committed before.
  });

  /**
   * Regression: "Thin" (originally 1px) silently failed to render on any
   * side that faced an already-rendered neighbor. The table uses
   * border-collapse:collapse (theme.ts), and every cell already carries a
   * 1px solid ambient default border (the visible gridlines) - a custom
   * border tied at exactly 1px hits CSS border-collapse's own conflict-
   * resolution tie-break ("earlier cell in table order wins" once width and
   * style both match), so the *neighbor's* default border silently won on
   * whichever side faced an earlier cell, while Medium (2px)/Thick (4px)
   * always won outright since they're strictly wider than the 1px ambient
   * default. Confirmed both ends empirically (pixel-level screenshot
   * cropping, all 3 browser engines) before and after: at 1px, a
   * fully-interior cell only showed its custom colour on 2 of 4 sides
   * (bottom/right); at 2px+, all 4 sides showed it correctly. Fixed by
   * starting BORDER_WIDTH_PRESETS at 2px instead of 1px (a 1.5px
   * fractional width was also tried and still lost the tie in every
   * engine tested - only an integer width strictly greater than 1px is
   * reliable) - see
   * docs/bugs/table-cell-border-thin-preset-loses-border-collapse-tie.md.
   * This assertion directly encodes the fix (guards against a future
   * "helpful" revert back to 1px); the actual multi-side visual rendering
   * was confirmed manually rather than via a new pixel-sampling test
   * harness, matching how this suite already treats other genuinely
   * paint-time-only behaviors it can't assert through the DOM/CSSOM.
   */
  test("'Thin' border width is not tied with the table's own 1px ambient gridline", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await insertDefaultTable(page);
    const cell = editor.locator('[data-smart-type="table"] td').first();
    await selectCellRange(page, cell, cell);
    const popover = page.locator('[data-srte-table-border-popover="true"]');

    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Border options").click();
    await popover.getByRole("button", { name: "All sides", exact: true }).click();
    await popover.getByRole("combobox", { name: "Border width" }).selectOption("thin");
    await expect(cell).not.toHaveCSS("border-top-width", "1px");
    await expect(cell).toHaveCSS("border-top-width", "2px");
  });

  /**
   * The color picker previously always opened blank ("#000000") regardless
   * of the caret's or cell's actual current color, and never dismissed on
   * an outside click (unlike ContextMenu.tsx, which already had that fix -
   * docs/bugs/context-menu-outside-click-dismiss-untested.md - this popover
   * never got the equivalent).
   */
  test("color picker reflects the existing colour when reopened, and closes on an outside click", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const colorPopover = page.locator('[data-srte-color-popover="true"]');

    // Mark case: apply a text colour, reopen the picker on that same text,
    // confirm it now seeds with the applied colour rather than #000000.
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode() as Text;
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    await expect(colorPopover).toBeVisible();
    await pickColor(page, "#e03131");
    await expect(colorPopover).not.toBeVisible();

    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    await expect(colorPopover).toBeVisible();
    await expect(page.locator("[data-srte-color-hex-input]")).toHaveValue("#e03131");

    // Outside click dismisses (this same open popover, no explicit close).
    await editor.click({ position: { x: 5, y: 5 } });
    await expect(colorPopover).not.toBeVisible();

    // Cell case: same reopened-value expectation, via the table context menu.
    await insertDefaultTable(page);
    const cell = editor.locator('[data-smart-type="table"] td').first();
    await cell.click({ button: "right" });
    const menu = page.locator('[data-srte-context-menu="true"]');
    await expect(menu).toBeVisible();
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.cellBackgroundColor"]').click();
    await expect(colorPopover).toBeVisible();
    await pickColor(page, "#ffc9c9");
    await expect(colorPopover).not.toBeVisible();

    await cell.click({ button: "right" });
    await expect(menu).toBeVisible();
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.cellBackgroundColor"]').click();
    await expect(colorPopover).toBeVisible();
    await expect(page.locator("[data-srte-color-hex-input]")).toHaveValue("#ffc9c9");
  });

  /**
   * Codex work order (3 confirmed table bugs), item 1: "Adding a column to
   * a table copied from Sootr shrinks the table". Same fabricated-fallback
   * pattern docs/bugs/table-resize-shrinks-table-with-no-prior-
   * columnwidths.md fixed for resize, found here in
   * insertTableColumnCommand for insert - fixed by only extending
   * columnWidths when the table already has real per-column data, never
   * fabricating a full array for one that doesn't.
   */
  test("adding a column to a pasted table with no real column widths does not shrink it", async ({ page }) => {
    const fixtureHtml = readFileSync("e2e/fixtures/test-html-sootr.html", "utf8");
    const mainMatch = fixtureHtml.match(/<main[^>]*>([\s\S]*)<\/main>/);
    if (!mainMatch) throw new Error("Fixture is missing its <main> wrapper - has the file changed?");
    const pasteHtml = mainMatch[1];

    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const editorWidth = (await editor.boundingBox())!.width;
    await placeCaretAtEnd(page);
    await page.evaluate((html) => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        surface: { pipeline: { handlePaste: (event: ClipboardEvent) => void } | null };
      } }).__smartProductCanonical!;
      const transfer = new DataTransfer();
      transfer.setData("text/html", html);
      transfer.setData("text/plain", "");
      runtime.surface.pipeline!.handlePaste({ clipboardData: transfer, preventDefault: () => undefined } as unknown as ClipboardEvent);
    }, pasteHtml);

    const table = editor.locator("table").first();
    await expect(table).toBeVisible();
    const widthsBeforeInsert = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: unknown } } }).__smartProductCanonical!;
      const find = (node: any): any => node.type === "table" ? node : (node.children || []).map(find).find(Boolean);
      return find(runtime.editor.document)?.attrs?.columnWidths;
    });
    expect(widthsBeforeInsert).toBeUndefined();

    await table.locator("td").first().click();
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Add column").click();

    const widthsAfterInsert = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: unknown } } }).__smartProductCanonical!;
      const find = (node: any): any => node.type === "table" ? node : (node.children || []).map(find).find(Boolean);
      return find(runtime.editor.document)?.attrs?.columnWidths;
    });
    expect(widthsAfterInsert).toBeUndefined();
    const tableWidth = (await table.boundingBox())!.width;
    expect(tableWidth).toBeGreaterThan(editorWidth * 0.8);
  });

  /**
   * Codex work order item 2: "Resizing a middle column from the right
   * affects an unrelated column". Confirmed this is a genuinely new bug,
   * not a regression of round 1's table-layout:fixed fix (which remains
   * correct and untouched) - TableResizeHandles.tsx only recomputed its
   * cached handle geometry via a ResizeObserver on the table's own outer
   * box, which never fires when a row/column is inserted into a table
   * whose overall width doesn't change (the common width:100% case).
   * Dragging a stale handle then computed a wildly wrong new width from a
   * stale, index-misaligned start size. Fixed with a MutationObserver on
   * the table's own structure.
   */
  test("resizing a column boundary after inserting a column only affects the adjacent column", async ({ page }) => {
    const fixtureHtml = readFileSync("e2e/fixtures/test-html-sootr.html", "utf8");
    const mainMatch = fixtureHtml.match(/<main[^>]*>([\s\S]*)<\/main>/);
    if (!mainMatch) throw new Error("Fixture is missing its <main> wrapper - has the file changed?");
    const pasteHtml = mainMatch[1];

    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await placeCaretAtEnd(page);
    await page.evaluate((html) => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        surface: { pipeline: { handlePaste: (event: ClipboardEvent) => void } | null };
      } }).__smartProductCanonical!;
      const transfer = new DataTransfer();
      transfer.setData("text/html", html);
      transfer.setData("text/plain", "");
      runtime.surface.pipeline!.handlePaste({ clipboardData: transfer, preventDefault: () => undefined } as unknown as ClipboardEvent);
    }, pasteHtml);

    const table = editor.locator("table").first();
    await table.locator("td").first().click();
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Add column").click();

    const cells = table.locator("tr").first().locator("td");
    const widthsBefore = await cells.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    expect(widthsBefore.length).toBe(3);

    // Boundary 1: between the newly-inserted (narrow, index 1) column and
    // the third column - an internal boundary, so it redistributes
    // between those two (column 2 grows, column 3 gives up the same
    // amount) and must never touch the first column at all - not by
    // hundreds of pixels from a stale cached start size (the original
    // bug here), and not by leaving column 3 untouched either (a later
    // design change - see "previews table column resize live..." above).
    const handle = page.locator('[data-srte-column-resize-handle="1"]');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    const widthsAfter = await cells.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    expect(Math.abs(widthsAfter[0] - widthsBefore[0])).toBeLessThan(5);
    expect(widthsAfter[1] - widthsBefore[1]).toBeGreaterThan(30);
    expect(widthsAfter[1] - widthsBefore[1]).toBeLessThan(70);
    // Column 3 gave up roughly what column 2 gained - the table's total
    // width (columns 1-3 together) stays put.
    const totalBefore = widthsBefore[0] + widthsBefore[1] + widthsBefore[2];
    const totalAfter = widthsAfter[0] + widthsAfter[1] + widthsAfter[2];
    expect(Math.abs(totalAfter - totalBefore)).toBeLessThan(5);
  });

  /**
   * Codex work order item 3: "Adding a row/column doesn't inherit the last
   * row/column's style". Confirmed current behaviour first: new cells were
   * always created blank - not a broken inheritance attempt, there wasn't
   * one. New capability: new row/column cells now default to the
   * immediately adjacent existing row/column's background/borders/
   * textColor/verticalAlign.
   */
  test("adding a row or column inherits the adjacent row/column's cell background colour", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await insertDefaultTable(page);
    const table = editor.locator('[data-smart-type="table"]');
    const lastCell = table.locator("td").last();
    await lastCell.click({ button: "right" });
    const menu = page.locator('[data-srte-context-menu="true"]');
    await expect(menu).toBeVisible();
    await menu.locator('[data-srte-context-menu-item="table.contextMenu.cellBackgroundColor"]').click();
    await expect(page.locator('[data-srte-color-popover="true"]')).toBeVisible();
    await pickColor(page, "#ffc9c9");
    await expect(lastCell).toHaveCSS("background-color", "rgb(255, 201, 201)");

    // Select the last cell (not the first) before each insert, so "Add
    // row"/"Add column" append after the styled row/column rather than
    // inserting between rows/columns - the styled one must end up
    // adjacent to the new one for inheritance to be exercised at all.
    await lastCell.click();
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Add row").click();
    const newRowCells = table.locator("tr").last().locator("td");
    // Inheritance is per column position: only the last cell of the
    // original row was coloured, so only the new row's last cell (same
    // column) should inherit it - the first cell must stay uncoloured.
    await expect(newRowCells.first()).not.toHaveCSS("background-color", "rgb(255, 201, 201)");
    await expect(newRowCells.last()).toHaveCSS("background-color", "rgb(255, 201, 201)");

    await table.locator("tr").last().locator("td").last().click();
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Add column").click();
    // Same per-position logic for the column case: only rows whose
    // adjacent (now second-to-last) column cell was coloured - row 1
    // (original) and row 2 (inherited via the row insert above) - should
    // see the new column inherit it; row 0 never had that cell coloured.
    const rows = table.locator("tr");
    await expect(rows.nth(0).locator("td").last()).not.toHaveCSS("background-color", "rgb(255, 201, 201)");
    await expect(rows.nth(1).locator("td").last()).toHaveCSS("background-color", "rgb(255, 201, 201)");
    await expect(rows.nth(2).locator("td").last()).toHaveCSS("background-color", "rgb(255, 201, 201)");
  });

  /**
   * Image width can be edited directly from the right-click details editor.
   */
  test("resizes a media atom via the media details editor", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { document: { children: unknown[] }; schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const doc = runtime.editor.document;
      (doc.children as unknown[]).push({
        type: "paragraph", id: "media-ctx-p",
        children: [{ type: "image", id: "media-ctx-img", attrs: { src: "https://example.com/x.png", alt: "x", width: 160, height: 90 } }],
      });
      runtime.replaceValue({ schemaVersion: runtime.editor.schema.version, revision: runtime.editor.state.revision + 1, document: doc });
    });
    const image = editor.locator('[data-smart-id="media-ctx-img"]');
    await image.click({ button: "right" });
    const overlay = page.locator('[data-srte-media-overlay="true"]');
    await expect(overlay).toHaveCount(0);
    const details = page.locator('[data-srte-media-details-popover="true"]');
    await expect(details).toBeVisible();
    await details.locator('[data-srte-media-width-input]').fill("180");
    await details.getByRole("button", { name: "Apply", exact: true }).click();
    const width = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: unknown[] } } } }).__smartProductCanonical!;
      const collect = (node: { type: string; id: string; attrs?: { width?: number }; children?: unknown[] }, out: typeof node[] = []): typeof out => {
        out.push(node);
        (node.children || []).forEach((child) => collect(child as typeof node, out));
        return out;
      };
      const all = collect({ type: "doc", id: "doc", children: runtime.editor.document.children } as never);
      return all.find((node) => node.id === "media-ctx-img")?.attrs?.width;
    });
    expect(width).toBeGreaterThan(160);
  });

  /**
   * Post-batch follow-up (user report: "images doesn't have a resizer") -
   * media now exposes all four side handles and four corner handles.
   */
  test("resizes a media atom by dragging its corner handle, preserving aspect ratio", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const runtime = (window as typeof window & {
        __smartProductCanonical?: { editor: { document: { children: unknown[] }; schema: { version: number }; state: { revision: number } }; replaceValue: (value: unknown) => void };
      }).__smartProductCanonical!;
      const doc = runtime.editor.document;
      (doc.children as unknown[]).push({
        type: "paragraph", id: "media-drag-p",
        children: [{ type: "image", id: "media-drag-img", attrs: { src: "https://example.com/x.png", alt: "x", width: 160, height: 90 } }],
      });
      runtime.replaceValue({ schemaVersion: runtime.editor.schema.version, revision: runtime.editor.state.revision + 1, document: doc });
    });
    const image = editor.locator('[data-smart-id="media-drag-img"]');
    await image.click({ button: "right" });
    await expect(page.locator('[data-srte-media-details-popover="true"]')).toBeVisible();
    await expect(page.locator('[data-srte-media-overlay="true"]')).toHaveCount(0);
    await expect(page.locator('[data-srte-media-resize-handle-direction]')).toHaveCount(8);
    const handle = page.locator('[data-srte-media-resize-handle-direction="se"]');
    await expect(handle).toBeVisible();

    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 22, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const attrs = await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: unknown[] } } } }).__smartProductCanonical!;
      const collect = (node: { type: string; id: string; attrs?: { width?: number; height?: number }; children?: unknown[] }, out: typeof node[] = []): typeof out => {
        out.push(node);
        (node.children || []).forEach((child) => collect(child as typeof node, out));
        return out;
      };
      const all = collect({ type: "doc", id: "doc", children: runtime.editor.document.children } as never);
      return all.find((node) => node.id === "media-drag-img")?.attrs;
    });
    expect(attrs?.width).toBeGreaterThan(160);
    expect(attrs?.height).toBeGreaterThan(90);
    // Aspect ratio (160:90 = 1.778) stays close to the original.
    expect(attrs!.width! / attrs!.height!).toBeCloseTo(160 / 90, 1);
  });

  test("resizes a media atom horizontally and vertically with side handles", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const runtime = (window as typeof window & {
        __smartProductCanonical?: { editor: { document: { children: unknown[] }; schema: { version: number }; state: { revision: number } }; replaceValue: (value: unknown) => void };
      }).__smartProductCanonical!;
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "media-side-doc", children: [{
          type: "paragraph", id: "media-side-p",
          children: [{ type: "image", id: "media-side-img", attrs: { src: "https://example.com/x.png", alt: "x", width: 160, height: 90 } }],
        }] },
      });
    });

    const image = editor.locator('[data-smart-id="media-side-img"]');
    await image.click({ button: "right" });
    await expect(page.locator('[data-srte-media-details-popover="true"]')).toBeVisible();
    await expect(page.locator('[data-srte-media-overlay="true"]')).toHaveCount(0);
    await expect(page.locator('[data-srte-media-resize-handle-direction]')).toHaveCount(8);

    const dragHandle = async (direction: "e" | "s", deltaX: number, deltaY: number) => {
      const handle = page.locator(`[data-srte-media-resize-handle-direction="${direction}"]`);
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2 + deltaY, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(100);
    };
    const attrsOf = () => page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: { editor: { document: { children: unknown[] } } } }).__smartProductCanonical!;
      const imageNode = (runtime.editor.document.children as Array<{ children?: Array<{ id: string; attrs?: { width?: number; height?: number } }> }>).flatMap((node) => node.children || []).find((node) => node.id === "media-side-img");
      return imageNode?.attrs;
    });

    await dragHandle("e", 40, 0);
    let attrs = await attrsOf();
    expect(attrs?.width).toBe(200);
    expect(attrs?.height).toBe(90);

    await dragHandle("s", 0, 20);
    attrs = await attrsOf();
    expect(attrs?.width).toBe(200);
    expect(attrs?.height).toBe(110);
  });

  /**
   * Post-batch follow-up (user question: "why aren't we using a
   * colorpicker instead of giving a list of colors") - originally answered
   * with a native <input type="color">, later replaced by an in-page
   * saturation/hue picker (docs/bugs - the "no click needed" redesign)
   * specifically so the drag surface is visible on the popover's first
   * click, with no separate Apply button - dismissing the popover commits
   * whatever was last staged.
   */
  test("applies a color via the saturation/hue picker", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await selectFirstText(page);
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    await expect(page.locator('[data-srte-color-sv-square="true"]')).toBeVisible();
    await expect(page.locator('[data-srte-color-hue-slider="true"]')).toBeVisible();
    await pickColor(page, "#336699");
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCount(1);
    const applied = await editor.locator('[data-smart-mark="textColor"]').getAttribute("data-smart-mark-attrs");
    expect(applied).toContain("#336699");
  });

  /**
   * A real mouse drag on the saturation/value square and the hue slider -
   * not the hex-input staging shortcut every other color test uses - since
   * this is the literal, explicitly requested interaction ("dragging should
   * update the color"). Also covers the three other explicit requirements
   * from that same request: the picker is visible on the popover's very
   * first click (no second click to open an OS dialog), there is no
   * separate Apply/Cancel button pair, and a drag that's never explicitly
   * discarded gets applied when the popover closes.
   */
  test("a real pointer drag on the saturation/value square and hue slider live-previews and commits on close, with no Apply/Cancel buttons", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await selectFirstText(page);
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();

    // One click opened the picker directly - no second click on a swatch
    // needed to reach a drag surface.
    const svSquare = page.locator('[data-srte-color-sv-square="true"]');
    const hueSlider = page.locator('[data-srte-color-hue-slider="true"]');
    await expect(svSquare).toBeVisible();
    await expect(hueSlider).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
    await expect(page.locator('[data-srte-color-discard="true"]')).toBeVisible();

    // Drag the hue slider first, then the saturation/value square - each a
    // real pointer sequence, not a synthetic single event.
    const hueBox = (await hueSlider.boundingBox())!;
    await page.mouse.move(hueBox.x + hueBox.width * 0.5, hueBox.y + hueBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(hueBox.x + hueBox.width * 0.2, hueBox.y + hueBox.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCount(1);

    const svBox = (await svSquare.boundingBox())!;
    await page.mouse.move(svBox.x + svBox.width * 0.5, svBox.y + svBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(svBox.x + svBox.width * 0.9, svBox.y + svBox.height * 0.1, { steps: 5 });
    await page.mouse.up();
    const previewedStyle = await editor.locator('[data-smart-mark="textColor"]').getAttribute("style");

    // Closed via outside click without ever touching Discard - the drag
    // result is applied, not reverted.
    await editor.click({ position: { x: 2, y: 2 } });
    await expect(page.locator('[data-srte-color-popover="true"]')).not.toBeVisible();
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveAttribute("style", previewedStyle!);
  });

  /**
   * Regression (2026-09-12, live report + console stack trace): dragging
   * the color picker anywhere in a document that also contains a
   * multi-line code block crashed with "Children do not match 'text*'."
   * previewColor's checkpoint-then-restore live-preview mechanism runs the
   * *whole* document through migrateNewlineTextToHardBreaks on every
   * restoreCheckpoint call - that migration didn't know code_block's
   * schema (`content: "text*"`) never accepts a hard_break child, so it
   * split the code block's own literal "\n" content into text+hard_break
   * pieces and produced a document that failed validation on the very
   * next call, well before the drag handler itself ran again - matching
   * the reported symptoms exactly (drag looked broken, clicks "didn't
   * reflect," and the popover couldn't be dismissed, because the thrown
   * error broke the interaction mid-frame).
   */
  test("dragging the color picker does not crash when the document also contains a multi-line code block", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");

    await page.keyboard.type("colortext");
    await page.keyboard.press("Enter");
    await page.keyboard.type("line one");
    await page.getByRole("combobox", { name: "Block type" }).selectOption("code_block");
    await page.waitForTimeout(30);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter"); // embeds a literal "\n" in the code block's own text
    await page.waitForTimeout(30);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await selectFirstText(page); // selects "colortext", not the code block
    await openToolbarDropdown(page, "More text styles");
    await toolbarMenuItem(page, "Text colour").click();
    const svSquare = page.locator('[data-srte-color-sv-square="true"]');
    await expect(svSquare).toBeVisible();
    const svBox = (await svSquare.boundingBox())!;
    await page.mouse.move(svBox.x + svBox.width * 0.5, svBox.y + svBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(svBox.x + svBox.width * 0.9, svBox.y + svBox.height * 0.1, { steps: 5 });
    await page.mouse.up();
    await expect(editor.locator('[data-smart-mark="textColor"]')).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(page.locator('[data-srte-color-popover="true"]')).not.toBeVisible();
    expect(pageErrors).toEqual([]);
    await expect(editor.locator("pre")).toContainText("line one");
  });

  /**
   * Formula library (Direction B "Small" scope, owner-approved) -
   * replaces the raw `window.prompt` formula-insert flow. Browsable by
   * domain, searchable by name, each entry a real KaTeX preview; selecting
   * one inserts it, auto-selects the new atom, and opens the existing
   * edit-formula prompt automatically (most real use needs customizing
   * variable names/values).
   */
  test("formula library: search, domain tabs, insert-then-auto-edit, and Escape/outside-click cancel without inserting", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const library = page.locator('[data-srte-formula-library="true"]');

    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Insert formula").click();
    await expect(library).toBeVisible();
    await expect(page.locator('[data-srte-formula-grid] button')).toHaveCount(55);

    await page.locator("[data-srte-formula-search]").fill("quadratic");
    await expect(page.locator('[data-srte-formula-grid] button')).toHaveCount(1);
    await page.locator("[data-srte-formula-search]").fill("");
    await page.getByRole("tab", { name: "Physics" }).click();
    await expect(page.locator('[data-srte-formula-entry="physics-newton-second"]')).toBeVisible();
    await expect(page.locator('[data-srte-formula-entry="algebra-quadratic"]')).toHaveCount(0);

    // Escape cancels without inserting anything.
    await page.keyboard.press("Escape");
    await expect(library).not.toBeVisible();
    await expect(editor.locator('[data-smart-type="formula"]')).toHaveCount(0);

    // Outside click also cancels.
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Insert formula").click();
    await expect(library).toBeVisible();
    await editor.click({ position: { x: 5, y: 5 } });
    await expect(library).not.toBeVisible();
    await expect(editor.locator('[data-smart-type="formula"]')).toHaveCount(0);

    // Selecting an entry inserts it and opens the existing edit-formula
    // prompt automatically - accept it to confirm the atom is both
    // inserted and immediately editable.
    let promptMessage: string | null = null;
    page.once("dialog", (dialog) => { promptMessage = dialog.message(); void dialog.accept(); });
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Insert formula").click();
    await page.locator('[data-srte-formula-entry="algebra-quadratic"]').click();
    await expect(library).not.toBeVisible();
    await expect.poll(() => promptMessage).not.toBeNull();
    const formula = editor.locator('[data-smart-type="formula"]');
    await expect(formula).toHaveCount(1);
    await expect(formula).toHaveAttribute("data-smart-formula", /4ac/);
    await expect(formula.locator(".katex")).toBeVisible();
  });

  /**
   * Chemistry entries use KaTeX's mhchem extension (`\ce{...}`) - not
   * registered by default. Confirms the real document renders it (not
   * just the library's own preview), via `surface/renderer.ts`'s
   * `import "katex/contrib/mhchem"`.
   */
  test("formula library: a chemistry entry (mhchem notation) renders as real math, not a raw-text fallback", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    page.once("dialog", (dialog) => void dialog.accept());
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Insert formula").click();
    await page.getByRole("tab", { name: "Chemistry" }).click();
    await page.locator('[data-srte-formula-entry="chemistry-water-formation"]').click();
    const formula = editor.locator('[data-smart-type="formula"]');
    await expect(formula).toHaveCount(1);
    await expect(formula.locator(".katex")).toBeVisible();
    await expect(formula.locator(".katex-mathml math")).toHaveCount(1);
  });

  /**
   * Regression: formula is the first UI-reachable *inline* atom (its parent
   * is the paragraph, not the document root/a table cell, unlike
   * image/video/audio/table). Inserting it leaves it selected ("node"
   * selection) so the auto-opened edit prompt targets it - but
   * insertBlockAtom's "node" branch used to always treat the selected
   * atom's own parent as the insertion point for the *next* block atom,
   * which is only valid when that atom is itself block-level. Inserting a
   * block atom into a paragraph fails schema validation and insertAtom
   * silently no-ops (see docs/bugs/formula-library-and-special-character-picker-added.md).
   */
  test("inserting an image right after inserting a formula does not silently no-op", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    page.once("dialog", (dialog) => void dialog.accept());
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Insert formula").click();
    await page.locator('[data-srte-formula-entry="algebra-quadratic"]').click();
    await expect(editor.locator('[data-smart-type="formula"]')).toHaveCount(1);

    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page, "image", "generated.png", "image/png");
    await expect(editor.locator('[data-smart-type="block_image"]')).toHaveCount(1);
  });

  /**
   * Regression: formula has no width/height concept (KaTeX sizes its own
   * rendering from source/font-size), but selecting a formula atom used to
   * enable "Enlarge/Shrink selected media" and show MediaOverlay's resize
   * button pair + drag handle anyway - clicking them silently persisted
   * meaningless width/height attrs onto the formula node with no visible
   * effect (formula-resize-controls-shown-for-non-resizable-atom.md). Edit
   * and Delete stay available - formula editing already has its own
   * "Formula source" prompt branch in editSelectedAtom.
   */
  test("a selected formula atom hides resize controls but keeps edit/delete", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    page.once("dialog", (dialog) => void dialog.accept());
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Insert formula").click();
    await page.locator('[data-srte-formula-entry="algebra-quadratic"]').click();
    const formula = editor.locator('[data-smart-type="formula"]');
    await expect(formula).toHaveCount(1);

    // The inserted atom is selected, but the media context menu is now
    // intentionally opened only by an explicit right-click.
    const overlay = page.locator('[data-srte-media-overlay="true"]');
    await expect(overlay).toHaveCount(0);
    await formula.dispatchEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 120 });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Resize +", exact: true })).toHaveCount(0);
    await expect(overlay.getByRole("button", { name: "Resize βˆ’", exact: true })).toHaveCount(0);
    await expect(page.locator('[data-srte-media-resize-handle="true"]')).toHaveCount(0);

    await openToolbarDropdown(page, "More to insert");
    await expect(toolbarMenuItem(page, "Enlarge selected media")).toBeDisabled();
    await expect(toolbarMenuItem(page, "Shrink selected media")).toBeDisabled();
  });

  /**
   * Special character picker - zero implementation before this (confirmed
   * via search, only a placeholder line in docs/ARCHITECTURE.md). Six
   * categories, ~200 characters, searchable, with a recently-used row
   * matching ColorPickerPopover's own pattern. Insertion is plain text via
   * a real synthetic `beforeinput`(insertText) event - the same event
   * ordinary typing dispatches - so it correctly replaces an active
   * selection instead of just inserting at the head.
   */
  test("special character picker: opens on first click, inserts at a collapsed cursor, replaces an active selection, and tracks recents", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    const picker = page.locator('[data-srte-special-char-popover="true"]');

    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Special characters").click();
    await expect(picker).toBeVisible();
    await expect(page.locator('[data-srte-special-char-grid] [data-srte-special-char]')).not.toHaveCount(0);

    // Collapsed-cursor insert.
    await page.keyboard.press("End");
    await page.locator('[data-srte-special-char="α"]').click();
    await expect(picker).not.toBeVisible();
    await expect(editor).toContainText("Canonical product editorα");

    // Replaces an active (non-collapsed) selection instead of inserting
    // alongside it - the literal point of using a real insertText event.
    await page.evaluate(() => {
      const root = document.querySelector('[contenteditable="true"]')!;
      const text = root.querySelector("p")!.firstChild as Text;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 9); // "Canonical"
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Special characters").click();
    await page.locator('[data-srte-special-char="π"]').click();
    await expect(editor).toContainText("π product editorα");
    await expect(editor).not.toContainText("Canonical");

    // Recently-used row and name search.
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Special characters").click();
    await expect(page.locator('[data-srte-recent-special-char="π"]')).toHaveCount(1);
    await expect(page.locator('[data-srte-recent-special-char="α"]')).toHaveCount(1);
    await page.locator("[data-srte-special-char-search]").fill("infinity");
    await expect(page.locator('[data-srte-special-char="∞"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(picker).not.toBeVisible();
  });

  /**
   * Post-batch-2 follow-up (user report): a table pasted with no real
   * column-width data (natural/stretched rendering - docs/bugs/
   * table-shrinks-after-paste.md) shrank as soon as any one column was
   * resized. Root cause: setTableColumnWidthCommand's own fallback for a
   * table with no existing columnWidths (`Array(columns).fill(120)`)
   * silently reset every OTHER column to a fabricated 120px the instant
   * one column was resized - the command layer has no way to know a
   * table's real *rendered* widths, that's DOM state. Fixed by having
   * TableResizeHandles pass its own already-measured current widths of
   * every column through to the command as an explicit seed.
   */
  test("resizing one column of a table with no prior columnWidths does not shrink the others", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const editor = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.evaluate(() => {
      const runtime = (window as typeof window & { __smartProductCanonical?: {
        editor: { schema: { version: number }; state: { revision: number } };
        replaceValue: (value: unknown) => void;
      } }).__smartProductCanonical!;
      const cell = (id: string, text: string) => ({
        type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false },
        children: [{ type: "paragraph", id: `${id}-p`, children: [{ type: "text", text }] }],
      });
      runtime.replaceValue({
        schemaVersion: runtime.editor.schema.version,
        revision: runtime.editor.state.revision + 1,
        document: { type: "doc", id: "noshrink-doc", children: [
          { type: "table", id: "noshrink-table", attrs: {}, children: [
            { type: "table_row", id: "noshrink-row", children: [cell("ns-a", "aaaaaaaaaa"), cell("ns-b", "b"), cell("ns-c", "cccccccccc")] },
          ] },
        ] },
      });
    });
    const cellA = editor.locator('[data-smart-id="ns-a"]');
    const cellB = editor.locator('[data-smart-id="ns-b"]');
    const cellC = editor.locator('[data-smart-id="ns-c"]');
    await cellA.click();
    const startA = (await cellA.boundingBox())!.width;
    const startB = (await cellB.boundingBox())!.width;

    const handle = page.locator('[data-srte-column-resize-handle="2"]');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();

    const afterA = (await cellA.boundingBox())!.width;
    const afterB = (await cellB.boundingBox())!.width;
    const afterC = (await cellC.boundingBox())!.width;
    expect(Math.abs(afterA - startA)).toBeLessThan(5);
    expect(Math.abs(afterB - startB)).toBeLessThan(5);
    expect(afterC).toBeGreaterThan(startB);
  });

});
