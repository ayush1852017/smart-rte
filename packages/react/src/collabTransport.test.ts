import { describe, expect, it } from "vitest";
import { createTransactionMap, type SmartOperation } from "smartrte-core/foundation";
import type { PresenceUpdate } from "./collabTransport.js";

/**
 * Phase 12b-client §2.3: PresenceUpdate defines the data shape only - no
 * rendering - but its `selection` field must be able to flow through the
 * same rebase machinery a real local selection does, or a remote cursor
 * would silently drift out of sync with the document the instant any
 * concurrent edit landed. Reuses `selection` as a plain `SmartSelection`
 * specifically so this is true for free via the existing
 * `createTransactionMap`/`FoundationTransactionMap` (the same primitive
 * `rebaseTransaction` uses for the local transaction's own
 * selectionBefore/selectionAfter, and the same one comments/structural
 * suggestions already rely on) - this test demonstrates that composition
 * rather than asserting it by inspection alone.
 */
describe("PresenceUpdate.selection maps through the same rebase machinery as a local selection", () => {
  it("shifts a remote cursor's position through a concurrent structural insert, exactly like a local selection would", () => {
    const remoteCursor: PresenceUpdate = {
      authorId: "author-b",
      selection: { type: "text", anchor: { path: [3], offset: 2 }, head: { path: [3], offset: 2 } },
      lastActiveAt: Date.now(),
    };
    const concurrentInsert: SmartOperation = { type: "insertNode", pos: { path: [], offset: 1 }, node: { type: "paragraph", id: "new", children: [] } };
    const map = createTransactionMap([concurrentInsert]);
    const mapped = remoteCursor.selection ? map.mapSelection(remoteCursor.selection) : null;
    expect(mapped).toEqual({ type: "text", anchor: { path: [4], offset: 2 }, head: { path: [4], offset: 2 } });
  });

  it("has no selection to map for a presence update reporting an idle/no-selection state", () => {
    const idlePresence: PresenceUpdate = { authorId: "author-b", lastActiveAt: Date.now() };
    expect(idlePresence.selection).toBeUndefined();
  });
});
