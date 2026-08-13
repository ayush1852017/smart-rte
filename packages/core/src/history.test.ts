import { describe, expect, it } from "vitest";
import {
  applyTransactionWithHistory,
  createHistoryState,
  paragraph,
  redoHistory,
  undoHistory,
  type SmartEditorState,
  type LegacySmartOperation,
  type LegacySmartSelection,
  type LegacySmartTransaction,
} from "./legacy/index.js";

const caret = (path: readonly number[], offset: number): LegacySmartSelection => ({
  type: "text",
  anchor: { path, offset },
  focus: { path, offset },
});

const initialSelection = caret([0, 0], 1);

const state = (): SmartEditorState => ({
  document: {
    type: "doc",
    children: [
      paragraph("one"),
      paragraph("two"),
      {
        type: "blockquote",
        children: [paragraph("inside"), paragraph("second")],
      },
    ],
  },
  selection: initialSelection,
});

const transaction = (
  id: string,
  operations: LegacySmartOperation[],
  selectionAfter?: LegacySmartSelection,
  historyGroup?: string
): LegacySmartTransaction => ({
  id,
  source: "user",
  operations,
  selectionBefore: initialSelection,
  selectionAfter,
  addToHistory: true,
  historyGroup,
  timestamp: 1,
});

describe("core history", () => {
  it.each<[string, LegacySmartOperation[]]>([
    ["insert", [{ type: "insertNode", path: [1], node: paragraph("inserted") }]],
    ["remove", [{ type: "removeNode", path: [1] }]],
    ["replace", [{ type: "replaceNode", path: [1], node: paragraph("replacement") }]],
    ["move", [{ type: "moveNode", from: [0], to: [3] }]],
    ["split", [{ type: "splitNode", path: [2], position: 1 }]],
    ["merge", [{ type: "mergeNode", path: [1] }]],
    ["attributes", [{ type: "setNodeAttrs", path: [0], attrs: { alignment: "right" } }]],
    ["text", [{ type: "replaceText", path: [0, 0], start: 1, end: 3, text: "ther" }]],
    ["mark", [{ type: "addMark", path: [0, 0], start: 0, end: 2, mark: { type: "bold" } }]],
  ])("round-trips the %s operation", (_name, operations) => {
    const before = state();
    const applied = applyTransactionWithHistory(
      before,
      createHistoryState(),
      transaction(`test-${_name}`, operations, caret([0, 0], 0))
    );
    const undone = undoHistory(applied.state, applied.history);

    expect(undone.applied).toBe(true);
    expect(undone.state).toEqual(before);
  });

  it("restores redo content and selection exactly", () => {
    const before = state();
    const afterSelection = caret([0, 0], 4);
    const applied = applyTransactionWithHistory(
      before,
      createHistoryState(),
      transaction(
        "replace-text",
        [{ type: "replaceText", path: [0, 0], start: 0, end: 3, text: "changed" }],
        afterSelection
      )
    );
    const undone = undoHistory(applied.state, applied.history);
    const redone = redoHistory(undone.state, undone.history);

    expect(redone.applied).toBe(true);
    expect(redone.state).toEqual(applied.state);
  });

  it("groups adjacent transactions with the same explicit history group", () => {
    const before = state();
    const first = applyTransactionWithHistory(
      before,
      createHistoryState(),
      transaction(
        "typing-1",
        [{ type: "replaceText", path: [0, 0], start: 3, end: 3, text: "!" }],
        caret([0, 0], 4),
        "typing"
      )
    );
    const secondTransaction: LegacySmartTransaction = {
      ...transaction(
        "typing-2",
        [{ type: "replaceText", path: [0, 0], start: 4, end: 4, text: "!" }],
        caret([0, 0], 5),
        "typing"
      ),
      selectionBefore: first.state.selection,
    };
    const second = applyTransactionWithHistory(first.state, first.history, secondTransaction);

    expect(second.history.undo).toHaveLength(1);
    expect(undoHistory(second.state, second.history).state).toEqual(before);
  });

  it("clears redo after a new recorded transaction", () => {
    const before = state();
    const applied = applyTransactionWithHistory(
      before,
      createHistoryState(),
      transaction("first", [{ type: "replaceText", path: [0, 0], start: 0, end: 1, text: "O" }])
    );
    const undone = undoHistory(applied.state, applied.history);
    expect(undone.history.redo).toHaveLength(1);

    const branched = applyTransactionWithHistory(
      undone.state,
      undone.history,
      transaction("branch", [{ type: "replaceText", path: [1, 0], start: 0, end: 1, text: "T" }])
    );
    expect(branched.history.redo).toHaveLength(0);
  });

  it("does not record transactions excluded from history", () => {
    const before = state();
    const tx = transaction("normalizer", [{ type: "setNodeAttrs", path: [0], attrs: { alignment: "left" } }]);
    tx.addToHistory = false;
    const result = applyTransactionWithHistory(before, createHistoryState(), tx);
    expect(result.history.undo).toHaveLength(0);
    expect(result.state.document.children[0]).toMatchObject({ alignment: "left" });
  });

  it("enforces the configured history limit", () => {
    let currentState = state();
    let history = createHistoryState(2);
    for (let index = 0; index < 3; index += 1) {
      const result = applyTransactionWithHistory(
        currentState,
        history,
        transaction(`change-${index}`, [{
          type: "setNodeAttrs",
          path: [0],
          attrs: { alignment: index % 2 ? "left" : "right" },
        }])
      );
      currentState = result.state;
      history = result.history;
    }
    expect(history.undo).toHaveLength(2);
  });

  it("falls back to an exact document inverse when normalization adds repair nodes", () => {
    const before: SmartEditorState = {
      document: { type: "doc", children: [paragraph("only")] },
      selection: initialSelection,
    };
    const applied = applyTransactionWithHistory(
      before,
      createHistoryState(),
      transaction("remove-only-block", [{ type: "removeNode", path: [0] }])
    );
    expect(applied.state.document.children).toHaveLength(1);
    expect(undoHistory(applied.state, applied.history).state).toEqual(before);
  });
});
