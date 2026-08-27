import { describe, expect, it } from "vitest";
import { createFoundationEditor } from "../editor.js";
import { RebaseConflictError, ResyncRequiredError } from "../transactions.js";
import type { SmartDocument, SmartSelection } from "../types.js";

const doc = (): SmartDocument => ({
  type: "doc", id: "doc",
  children: [
    { type: "paragraph", id: "p0", children: [{ type: "text", text: "hello" }] },
    { type: "paragraph", id: "p1", children: [{ type: "text", text: "world" }] },
  ],
});
const caret = (path: number[], offset: number): SmartSelection => ({ type: "text", anchor: { path, offset }, head: { path, offset } });

/**
 * End-to-end simulation of two independent local editors (as two real
 * concurrent clients would be) starting from the same revision, each
 * committing one local edit, then one client's transaction being replayed
 * into the other's editor instance via dispatch() - the actual integration
 * point §2.1 changes, not just the pure rebaseTransaction function in
 * isolation (already covered by rebase.property.test.ts).
 */
describe("FoundationEditor.dispatch: real rebase-and-reapply", () => {
  it("applies a transaction whose baseRevision is behind current, rebasing it through what was missed", () => {
    const clientA = createFoundationEditor({ document: doc(), selection: caret([0], 5) });
    const clientB = createFoundationEditor({ document: doc(), selection: caret([1], 0) });

    clientA.typeText("!", { authorId: "author-a" });
    expect(clientA.state.revision).toBe(1);

    const bTransaction = clientB.transact((builder) => {
      builder.insertText(clientB.resolve({ pos: { path: [1], offset: 0 } }), "B says: ", []);
      return builder.selectionAfter;
    }, { authorId: "author-b" });
    expect(bTransaction!.baseRevision).toBe(0);

    // Replay B's (now-stale, baseRevision 0) transaction into A's editor
    // (already at revision 1) - the exact scenario dispatch() must rebase
    // rather than reject outright.
    clientA.dispatch(bTransaction!);
    expect(clientA.state.revision).toBe(2);
    const textOf = (index: number) => {
      const node = clientA.document.children[index];
      return "children" in node ? node.children?.map((c) => ("text" in c ? c.text : null)) : null;
    };
    expect(textOf(0)).toEqual(["hello!"]);
    expect(textOf(1)).toEqual(["B says: world"]); // adjacent same-mark text runs normalize into one node
  });

  it("throws RebaseConflictError for a genuinely non-transformable concurrent conflict, without corrupting state", () => {
    const clientA = createFoundationEditor({ document: doc(), selection: caret([0], 0) });
    const clientB = createFoundationEditor({ document: doc(), selection: caret([0], 0) });

    clientA.transact((builder) => {
      builder.moveNode(clientA.resolve({ pos: { path: [], offset: 0 } }), clientA.resolve({ pos: { path: [], offset: 1 } }), "p0");
      return builder.selectionAfter;
    }, { authorId: "author-a" });
    expect(clientA.state.revision).toBe(1);

    const bTransaction = clientB.transact((builder) => {
      builder.moveNode(clientB.resolve({ pos: { path: [], offset: 1 } }), clientB.resolve({ pos: { path: [], offset: 0 } }), "p1");
      return builder.selectionAfter;
    }, { authorId: "author-b" });

    const beforeRevision = clientA.state.revision;
    const beforeDocument = clientA.document;
    expect(() => clientA.dispatch(bTransaction!)).toThrow(RebaseConflictError);
    // State must be completely untouched by the rejected attempt.
    expect(clientA.state.revision).toBe(beforeRevision);
    expect(clientA.document).toBe(beforeDocument);
  });

  it("throws ResyncRequiredError when the incoming transaction is older than the retained revision log", () => {
    const clientA = createFoundationEditor({ document: doc(), selection: caret([0], 0), revisionLogLimit: 2 });
    const clientB = createFoundationEditor({ document: doc(), selection: caret([0], 0) });

    const staleTransaction = clientB.transact((builder) => {
      builder.insertText(clientB.resolve({ pos: { path: [0], offset: 0 } }), "X", []);
      return builder.selectionAfter;
    }, { authorId: "author-b" });

    // Advance clientA past the retention window (limit 2) so the stale
    // transaction's baseRevision (0) is no longer covered.
    for (let i = 0; i < 3; i += 1) clientA.typeText(".", { authorId: "author-a" });
    expect(clientA.state.revision).toBe(3);

    expect(() => clientA.dispatch(staleTransaction!)).toThrow(ResyncRequiredError);
  });
});
