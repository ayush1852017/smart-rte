import { describe, expect, it } from "vitest";
import {
  createFoundationEditor,
  createScopeIndex,
  indentList,
  restartListNumbering,
  setListChecked,
  setListStyle,
  type CommandContext,
  type ListSelectionScope,
  type SmartDocument,
  type SmartElementNode,
} from "../index.js";

const p = (id: string, text: string): SmartElementNode => ({ type: "paragraph", id, children: [{ type: "text", text }] });
const item = (id: string): SmartElementNode => ({ type: "list_item", id, children: [p(`${id}-p`, id)] });
const fixture = (run: number): SmartDocument => ({ type: "doc", id: `doc-${run}`, children: [{
  type: "list", id: `list-${run}`, attrs: { style: "disc", checkable: true }, children: [item(`a-${run}`), item(`b-${run}`), item(`c-${run}`)],
}] });
const scope = (run: number, itemId: string): ListSelectionScope => ({
  kind: "list-selection", listId: `list-${run}`,
  items: [{ itemId, depth: 0, hasChildList: false }], partialSubtree: false, promotedFromPartial: false,
  range: { from: { path: [0], offset: 0 }, to: { path: [0], offset: 1 } }, isolatingAncestorId: null, clamped: false,
});

describe("Phase 3 structural history property", () => {
  it("restores exact IDs, list state, and reverse selection in 1,000 cases (seed 0x13A57EED)", () => {
    let state = 0x13A57EED;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
    for (let run = 0; run < 1_000; run += 1) {
      const before = fixture(run);
      const selection = { type: "node" as const, anchor: { path: [], offset: 1 }, head: { path: [], offset: 0 } };
      const editor = createFoundationEditor({ document: before, selection });
      const initial = editor.state;
      const commandContext: CommandContext = { schema: editor.schema, positions: createScopeIndex().positions(editor.document, editor.schema) };
      const choice = Math.floor(random() * 4);
      const selected = scope(run, `b-${run}`);
      const operations = choice === 0
        ? indentList(editor.document, selected, { nestedListIds: [`nested-${run}`] }, commandContext)
        : choice === 1
          ? setListChecked(editor.document, selected, { checked: true }, commandContext)
          : choice === 2
            ? restartListNumbering(editor.document, selected, { start: 2 + Math.floor(random() * 20) }, commandContext)
            : setListStyle(editor.document, selected, { style: "upper-roman" }, commandContext);
      editor.transact((builder) => {
        builder.operations.push(...operations);
        builder.setSelection(selection);
      }, { source: "keyboard", addToHistory: true, timestamp: run });
      expect(editor.history.undo).toHaveLength(1);
      expect(editor.undo()).toBe(true);
      expect(editor.state).toMatchObject({ document: initial.document, selection: initial.selection });
      expect(editor.redo()).toBe(true);
      expect(editor.selection).toEqual(selection);
    }
  });
});
