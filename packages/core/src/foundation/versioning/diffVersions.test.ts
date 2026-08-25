import { describe, expect, it } from "vitest";
import { foundationSchema } from "../schema.js";
import type { PersistedEditorDocument, SmartDocument } from "../types.js";
import { diffVersions } from "./diffVersions.js";
import type { DocumentVersion } from "./types.js";

const envelope = (document: SmartDocument, revision: number): PersistedEditorDocument => ({ schemaVersion: 1, revision, document });
const version = (id: string, document: SmartDocument, revision: number): DocumentVersion => ({ id, createdAt: revision, envelope: envelope(document, revision) });

describe("diffVersions", () => {
  it("delegates to diffDocuments over each version's own document", () => {
    const before: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p1", children: [{ type: "text", text: "hello" }] }] };
    const after: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p1", children: [{ type: "text", text: "hello world" }] }] };
    const result = diffVersions(version("v1", before, 1), version("v2", after, 2), foundationSchema);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([{
      kind: "changed", nodeId: "p1",
      contentChange: [
        { op: "equal", text: "hello ", marks: [] },
        { op: "insert", text: "world", marks: [] },
      ],
    }]);
  });

  it("returns an empty diff for two versions of the identical document", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p1", children: [{ type: "text", text: "unchanged" }] }] };
    expect(diffVersions(version("v1", model, 1), version("v2", structuredClone(model), 2), foundationSchema)).toEqual({ added: [], removed: [], changed: [] });
  });
});
