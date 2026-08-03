import { describe, expect, it } from "vitest";
import {
  applyMarkCommand,
  applyOperations,
  canonicalColor,
  canonicalFontFamily,
  canonicalFontSize,
  canonicalMarkOrder,
  createFoundationEditor,
  createMarkNormalizer,
  createScopeIndex,
  editLinkCommand,
  executeMarkTool,
  foundationSchema,
  hardBreakNodeSpec,
  inlineToolDeclarations,
  insertHardBreak,
  migrateNewlineTextToHardBreaks,
  reportMarkApplication,
  removeLinkCommand,
  resolveMarkRun,
  runNormalization,
  toggleMarkCommand,
  validate,
  type InlineRangeScope,
  type InlineToolDeclaration,
  type MarkCommandContext,
  type SmartDocument,
  type SmartMark,
  type SmartOperation,
  type SmartSelection,
} from "../index.js";

const selection = (from: number, to = from, path = [0]): SmartSelection => ({
  type: "text",
  anchor: { path: [...path], offset: from },
  head: { path: [...path], offset: to },
});

const paragraphDocument = (children: SmartDocument["children"][number]["children"]): SmartDocument => ({
  type: "doc",
  id: "doc",
  children: [{ type: "paragraph", id: "p", children: children || [] }],
});

const contextFor = (document: SmartDocument): MarkCommandContext => ({
  schema: foundationSchema,
  positions: createScopeIndex().positions(document, foundationSchema),
});

const inlineScope = (document: SmartDocument, from: number, to: number, path = [0]) =>
  createScopeIndex().resolve(document, selection(from, to, path), { want: "inline-range" }, foundationSchema) as InlineRangeScope;

describe("Phase 4 generic mark engine", () => {
  it("adds a thirteenth tool declaration without adding command code", () => {
    const declaration: InlineToolDeclaration = { id: "highlightAlias", markType: "backgroundColor", inclusive: true };
    const editor = createFoundationEditor({ document: paragraphDocument([{ type: "text", text: "hello" }]), selection: selection(1, 4) });
    const operations = executeMarkTool(editor, declaration, "apply", { value: "RED" });
    expect(operations.map((operation) => operation.type)).toContain("addMark");
    expect(editor.document.children[0].children).toEqual([
      { type: "text", text: "h" },
      { type: "text", text: "ell", marks: [{ type: "backgroundColor", attrs: { value: "#ff0000" } }] },
      { type: "text", text: "o" },
    ]);
  });

  it("removes on all coverage and applies across mixed coverage", () => {
    const marked = paragraphDocument([{ type: "text", text: "hello", marks: [{ type: "bold" }] }]);
    const all = inlineScope(marked, 0, 5);
    const removed = toggleMarkCommand(marked, all, { markType: "bold", coverage: "all" }, contextFor(marked));
    expect(applyOperations(marked, removed).children[0].children).toEqual([{ type: "text", text: "hello" }]);

    const mixed = paragraphDocument([
      { type: "text", text: "he", marks: [{ type: "bold" }] },
      { type: "text", text: "llo" },
    ]);
    const applied = toggleMarkCommand(mixed, inlineScope(mixed, 0, 5), { markType: "bold", coverage: "partial" }, contextFor(mixed));
    expect(applyOperations(mixed, applied).children[0].children).toEqual([{ type: "text", text: "hello", marks: [{ type: "bold" }] }]);
  });

  it("uses Phase 2 runs across owners, including list items, without list-specific code", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "paragraph", id: "outside", children: [{ type: "text", text: "a" }] },
      { type: "list", id: "list", attrs: { preset: "bullet" }, children: [
        { type: "list_item", id: "item", children: [{ type: "paragraph", id: "inside", children: [{ type: "text", text: "b" }] }] },
      ] },
    ] };
    const scope = createScopeIndex().resolve(document, {
      type: "text", anchor: { path: [0], offset: 0 }, head: { path: [1, 0, 0], offset: 1 },
    }, { want: "inline-range" }, foundationSchema) as InlineRangeScope;
    expect(scope.runs.map((run) => run.ownerNodeId)).toEqual(["outside", "inside"]);
    const operations = applyMarkCommand(document, scope, { markType: "italic" }, contextFor(document));
    expect(operations.filter((operation) => operation.type === "addMark")).toHaveLength(2);
    const result = applyOperations(document, operations);
    expect(result.children[0]).toMatchObject({ children: [{ marks: [{ type: "italic" }] }] });
    expect(result.children[1]).toMatchObject({ children: [{ children: [{ children: [{ marks: [{ type: "italic" }] }] }] }] });
  });

  it("replaces self-exclusive values and mutually exclusive super/subscript", () => {
    const sized = paragraphDocument([{ type: "text", text: "x", marks: [{ type: "fontSize", attrs: { valuePx: 12 } }] }]);
    const sizeOps = applyMarkCommand(sized, inlineScope(sized, 0, 1), { markType: "fontSize", attrs: { valuePx: "14px" } }, contextFor(sized));
    expect(applyOperations(sized, sizeOps).children[0]).toMatchObject({ children: [{ marks: [{ type: "fontSize", attrs: { valuePx: 14 } }] }] });

    const sub = paragraphDocument([{ type: "text", text: "x", marks: [{ type: "subscript" }] }]);
    const superOps = applyMarkCommand(sub, inlineScope(sub, 0, 1), { markType: "superscript" }, contextFor(sub));
    expect(applyOperations(sub, superOps).children[0]).toMatchObject({ children: [{ marks: [{ type: "superscript" }] }] });
  });

  it("skips an inline atom while applying to its neighboring text", () => {
    const document = paragraphDocument([
      { type: "text", text: "a" },
      { type: "hard_break", id: "break" },
      { type: "text", text: "b" },
    ]);
    const scope = inlineScope(document, 0, 3);
    const context = contextFor(document);
    const operations = applyMarkCommand(document, scope, { markType: "bold" }, context);
    expect(applyOperations(document, operations).children[0].children).toEqual([
      { type: "text", text: "a", marks: [{ type: "bold" }] },
      { type: "hard_break", id: "break" },
      { type: "text", text: "b", marks: [{ type: "bold" }] },
    ]);
    expect(reportMarkApplication(document, scope, "bold", context)).toEqual({
      ownerCount: 1,
      ownerIdsSkipped: [],
      atomOwnersSkipped: ["break"],
      partial: true,
    });
  });

  it("canonicalizes attributed marks at command boundaries", () => {
    expect(canonicalColor("red")).toBe("#ff0000");
    expect(canonicalColor("#F00")).toBe("#ff0000");
    expect(canonicalColor("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(canonicalFontSize("12pt")).toBe(16);
    expect(canonicalFontFamily(" 'Open   Sans', ARIAL ")).toBe("open sans, arial");
  });
});

describe("Phase 4 mark normalization", () => {
  it("is deterministic, idempotent, terminating, and local in 2,000 cases (seed 0x4A4B2026)", () => {
    let seed = 0x4A4B2026;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const normalizer = createMarkNormalizer();
    for (let run = 0; run < 2_000; run += 1) {
      const pool: SmartMark[] = [{ type: "bold" }, { type: "italic" }, { type: "underline" }];
      const marks = pool.filter(() => random() > 0.35).sort(() => random() - 0.5);
      const document: SmartDocument = { type: "doc", id: "doc", children: [
        { type: "paragraph", id: "target", children: [
          { type: "text", text: "", marks },
          { type: "text", text: "a", marks },
          { type: "text", text: "b", marks: [...marks].reverse() },
        ] },
        { type: "paragraph", id: "untouched", children: [{ type: "text", text: "stable" }] },
      ] };
      const operation: SmartOperation = { type: "insertText", pos: { path: [0], offset: 1 }, text: "x" };
      const first = runNormalization({ document, originatingOperations: [operation], schema: foundationSchema, normalizers: [normalizer] });
      const normalized = applyOperations(document, first.operations);
      const second = runNormalization({ document: normalized, originatingOperations: [operation], schema: foundationSchema, normalizers: [normalizer] });
      expect(first.passes).toBeLessThanOrEqual(3);
      expect(second.operations).toEqual([]);
      expect(normalized.children[1]).toBe(document.children[1]);
      const children = normalized.children[0].children || [];
      expect(children.some((child) => child.type === "text" && !child.text)).toBe(false);
      children.forEach((child) => {
        if (child.type === "text" && child.marks) expect(child.marks).toEqual(canonicalMarkOrder(child.marks));
      });
    }
  });
});

describe("Phase 4 links, stored marks, and hard breaks", () => {
  it("resolves and edits/removes the whole contiguous link when collapsed", () => {
    const document = paragraphDocument([
      { type: "text", text: "a" },
      { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://old.example/" } }] },
      { type: "text", text: "z" },
    ]);
    const run = resolveMarkRun(document, { path: [0], offset: 3 }, "link");
    expect(run?.range).toEqual({ from: { path: [0], offset: 1 }, to: { path: [0], offset: 5 } });
    const scope = inlineScope(document, 3, 3);
    const edited = applyOperations(document, editLinkCommand(document, scope, { href: "https://new.example" }, contextFor(document)));
    expect(edited.children[0]).toMatchObject({ children: [
      { text: "a" },
      { text: "link", marks: [{ type: "link", attrs: { href: "https://new.example" } }] },
      { text: "z" },
    ] });
    const removed = applyOperations(document, removeLinkCommand(document, scope, { markType: "link" }, contextFor(document)));
    expect(removed.children[0].children).toEqual([{ type: "text", text: "alinkz" }]);
  });

  it("splits ranged link removal, merges equal adjacent hrefs, and keeps different hrefs separate", () => {
    const link = { type: "link", attrs: { href: "https://a.example/" } } as const;
    const document = paragraphDocument([{ type: "text", text: "hello", marks: [link] }]);
    const removed = applyOperations(document, removeLinkCommand(document, inlineScope(document, 1, 4), { markType: "link" }, contextFor(document)));
    expect(removed.children[0].children).toHaveLength(3);

    const same = paragraphDocument([
      { type: "text", text: "a", marks: [link] }, { type: "text", text: "b", marks: [link] },
    ]);
    expect(applyOperations(same, []).children[0].children).toHaveLength(2);
    const normalized = runNormalization({ document: same, originatingOperations: [{ type: "insertText", pos: { path: [0], offset: 1 }, text: "" }], schema: foundationSchema, normalizers: [createMarkNormalizer()] });
    expect(applyOperations(same, normalized.operations).children[0].children).toEqual([{ type: "text", text: "ab", marks: [link] }]);

    const different = paragraphDocument([
      { type: "text", text: "a", marks: [link] },
      { type: "text", text: "b", marks: [{ type: "link", attrs: { href: "https://b.example/" } }] },
    ]);
    const result = runNormalization({ document: different, originatingOperations: [{ type: "insertText", pos: { path: [0], offset: 1 }, text: "" }], schema: foundationSchema, normalizers: [createMarkNormalizer()] });
    expect(applyOperations(different, result.operations).children[0].children).toHaveLength(2);
  });

  it("rejects unsafe links and prevents links from extending at their end", () => {
    const document = paragraphDocument([{ type: "text", text: "x" }]);
    expect(() => applyMarkCommand(document, inlineScope(document, 0, 1), { markType: "link", attrs: { href: "javascript:alert(1)" } }, contextFor(document))).toThrow("safe URL");
    const linked = paragraphDocument([{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "https://a.example/" } }] }]);
    const editor = createFoundationEditor({ document: linked, selection: selection(1) });
    editor.typeText("y", { timestamp: 1 });
    expect(editor.document.children[0].children).toEqual([
      { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "https://a.example/" } }] },
      { type: "text", text: "y" },
    ]);
  });

  it("preserves the exact stored-mark cycle through 500 type/undo/redo cases (seed 0x5704ED)", () => {
    const editor = createFoundationEditor({ document: paragraphDocument([]), selection: selection(0) });
    executeMarkTool(editor, inlineToolDeclarations[0], "toggle");
    expect(editor.storedMarks).toEqual([{ type: "bold" }]);
    editor.typeText("x", { timestamp: 1 });
    expect(editor.document.children[0].children).toEqual([{ type: "text", text: "x", marks: [{ type: "bold" }] }]);
    expect(editor.storedMarks).toEqual([{ type: "bold" }]);
    expect(editor.undo()).toBe(true);
    expect(editor.document.children[0].children).toEqual([]);
    expect(editor.selection).toEqual(selection(0));
    expect(editor.storedMarks).toEqual([{ type: "bold" }]);
    expect(editor.redo()).toBe(true);
    expect(editor.document.children[0].children).toEqual([{ type: "text", text: "x", marks: [{ type: "bold" }] }]);
    expect(editor.storedMarks).toEqual([{ type: "bold" }]);

    let seed = 0x5704ED;
    for (let caseIndex = 0; caseIndex < 500; caseIndex += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const declaration = inlineToolDeclarations[seed % 5];
      const value = String.fromCodePoint(0x61 + seed % 26);
      const candidate = createFoundationEditor({ document: paragraphDocument([]), selection: selection(0) });
      executeMarkTool(candidate, declaration, "toggle");
      const expectedMarks = [{ type: declaration.markType }];
      candidate.typeText(value, { timestamp: seed });
      expect(candidate.undo()).toBe(true);
      expect(candidate.document.children[0].children).toEqual([]);
      expect(candidate.selection).toEqual(selection(0));
      expect(candidate.storedMarks).toEqual(expectedMarks);
      expect(candidate.redo()).toBe(true);
      expect(candidate.document.children[0].children).toEqual([{ type: "text", text: value, marks: expectedMarks }]);
      expect(candidate.storedMarks).toEqual(expectedMarks);
    }
  });

  it("locks hard_break as a one-unit unmarked atom and migrates legacy newlines", () => {
    expect(hardBreakNodeSpec).toMatchObject({ type: "hard_break", group: "inline", atomic: true, marks: "" });
    const legacy = paragraphDocument([{ type: "text", text: "a\nb", marks: [{ type: "bold" }] }]);
    const migrated = migrateNewlineTextToHardBreaks(legacy);
    expect(migrated.migratedBreaks).toBe(1);
    expect(migrated.document.children[0].children).toEqual([
      { type: "text", text: "a", marks: [{ type: "bold" }] },
      { type: "hard_break", id: expect.any(String) },
      { type: "text", text: "b", marks: [{ type: "bold" }] },
    ]);
    expect(validate(migrated.document)).toEqual([]);
    const operations = insertHardBreak(paragraphDocument([{ type: "text", text: "ab" }]), { path: [0], offset: 1 }, "fixed-break");
    const result = applyOperations(paragraphDocument([{ type: "text", text: "ab" }]), operations);
    expect(result.children[0].children).toEqual([
      { type: "text", text: "a" }, { type: "hard_break", id: "fixed-break" }, { type: "text", text: "b" },
    ]);
  });
});
