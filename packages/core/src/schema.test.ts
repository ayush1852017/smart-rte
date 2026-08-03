import { describe, expect, it } from "vitest";
import {
  createSmartSchema,
  normalizeSmartDocument,
  paragraph,
  validateSmartDocument,
  type LegacySmartDocument,
} from "./index.js";

describe("LegacySmartDocument schema", () => {
  it("preserves a row fully covered by a rowspan without synthesizing a cell", () => {
    const document: LegacySmartDocument = {
      type: "doc",
      children: [{
        type: "table",
        children: [
          {
            type: "tableRow",
            children: [{
              type: "tableCell",
              rowspan: 2,
              colspan: 2,
              children: [paragraph("merged")],
            }],
          },
          { type: "tableRow", children: [] },
        ],
      }],
    };
    const normalized = normalizeSmartDocument(document);
    const table = normalized.children[0];
    expect(table.type === "table" && table.children[1].children).toEqual([]);
    expect(validateSmartDocument(normalized).valid).toBe(true);
  });

  it("accepts a valid nested document", () => {
    const document: LegacySmartDocument = {
      type: "doc",
      children: [
        {
          type: "list",
          style: "decimal",
          children: [{
            type: "listItem",
            children: [
              paragraph("parent"),
              {
                type: "list",
                style: "lower-alpha",
                children: [{ type: "listItem", children: [paragraph("child")] }],
              },
            ],
          }],
        },
        {
          type: "table",
          children: [{
            type: "tableRow",
            children: [{ type: "tableHeaderCell", children: [paragraph("heading")] }],
          }],
        },
      ],
    };

    expect(validateSmartDocument(document)).toEqual({ valid: true, issues: [] });
  });

  it("reports precise paths for invalid structural content", () => {
    const malformed = {
      type: "doc",
      children: [{
        type: "table",
        children: [{
          type: "tableRow",
          children: [{ type: "tableCell", colspan: 0, children: [] }],
        }],
      }],
    } as unknown as LegacySmartDocument;

    const result = validateSmartDocument(malformed);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: [0, 0, 0], code: "empty-table-cell" }),
      expect.objectContaining({ path: [0, 0, 0], code: "invalid-colspan" }),
    ]));
  });

  it("repairs empty containers without discarding their structure", () => {
    const malformed = {
      type: "doc",
      children: [
        { type: "paragraph", children: [] },
        { type: "blockquote", children: [] },
        { type: "list", style: "unsupported", children: [] },
        { type: "table", children: [] },
      ],
    } as unknown as LegacySmartDocument;

    const normalized = normalizeSmartDocument(malformed);
    expect(validateSmartDocument(normalized).valid).toBe(true);
    expect(normalized.children.map((node) => node.type)).toEqual([
      "paragraph",
      "blockquote",
      "list",
      "table",
    ]);
    expect(normalized.children[2]).toMatchObject({ type: "list", style: "disc" });
    expect(normalized.children[3]).toMatchObject({
      type: "table",
      children: [{
        type: "tableRow",
        children: [{
          type: "tableCell",
          children: [{ type: "paragraph" }],
        }],
      }],
    });
  });

  it("normalizes an empty document to one editable paragraph", () => {
    const normalized = normalizeSmartDocument({ type: "doc", children: [] });
    expect(normalized).toEqual({ type: "doc", children: [paragraph()] });
  });

  it("clamps headings, cell spans, and duplicate marks deterministically", () => {
    const malformed = {
      type: "doc",
      children: [
        {
          type: "heading",
          level: 9,
          children: [{
            type: "text",
            text: "heading",
            marks: [{ type: "bold" }, { type: "bold" }],
          }],
        },
        {
          type: "table",
          children: [{
            type: "tableRow",
            children: [{
              type: "tableCell",
              colspan: -2,
              rowspan: 1,
              children: [paragraph("cell")],
            }],
          }],
        },
      ],
    } as unknown as LegacySmartDocument;

    const normalized = normalizeSmartDocument(malformed);
    expect(normalized.children[0]).toMatchObject({
      type: "heading",
      level: 6,
      children: [{ marks: [{ type: "bold" }] }],
    });
    expect(normalized.children[1]).not.toHaveProperty("children.0.children.0.colspan");
    const table = normalized.children[1];
    expect(table.type === "table" && table.children[0].children[0]).not.toHaveProperty("colspan");
    expect(table.type === "table" && table.children[0].children[0]).not.toHaveProperty("rowspan");
  });

  it("is idempotent and does not mutate its input", () => {
    const input = {
      type: "doc",
      children: [{
        type: "list",
        style: "decimal",
        children: [{ type: "listItem", children: [] }],
      }],
    } as unknown as LegacySmartDocument;
    const snapshot = structuredClone(input);
    const once = normalizeSmartDocument(input);
    const twice = normalizeSmartDocument(once);

    expect(twice).toEqual(once);
    expect(input).toEqual(snapshot);
  });

  it("composes named plugin schema extensions after built-in normalization", () => {
    const schema = createSmartSchema([{
      id: "required-prefix",
      normalize: (document) => {
        const first = document.children[0];
        if (first.type !== "paragraph" || first.children[0].text.startsWith("prefix:")) return document;
        return {
          ...document,
          children: [{
            ...first,
            children: [{ ...first.children[0], text: `prefix:${first.children[0].text}` }],
          }],
        };
      },
      validate: (document) => {
        const first = document.children[0];
        return first.type === "paragraph" && first.children[0].text.startsWith("prefix:")
          ? []
          : [{ path: [0], code: "missing-prefix", message: "A prefix is required." }];
      },
    }]);

    const normalized = normalizeSmartDocument(
      { type: "doc", children: [paragraph("value")] },
      schema,
    );
    expect(normalized).toEqual({ type: "doc", children: [paragraph("prefix:value")] });
    expect(validateSmartDocument(normalized, schema)).toEqual({ valid: true, issues: [] });
  });

  it("rejects ambiguous schema extension registrations", () => {
    expect(() => createSmartSchema([{ id: "same" }, { id: "same" }]))
      .toThrow('Duplicate schema extension id "same"');
    expect(() => createSmartSchema([{ id: " " }])).toThrow("cannot be empty");
  });

  it("normalizes and validates checklist, image, and media metadata", () => {
    const malformed = {
      type: "doc",
      children: [
        {
          type: "list",
          style: "disc",
          checklist: true,
          strikeCompleted: true,
          children: [{ type: "listItem", checked: true, children: [] }],
        },
        { type: "image", src: "image.png", width: -1, height: 200 },
        { type: "media", src: "movie.mp4", mediaType: "unsupported" },
      ],
    } as unknown as LegacySmartDocument;

    const normalized = normalizeSmartDocument(malformed);
    expect(normalized.children[0]).toMatchObject({
      type: "list",
      checklist: true,
      strikeCompleted: true,
      children: [{ checked: true, children: [{ type: "paragraph" }] }],
    });
    expect(normalized.children[1]).toEqual({
      type: "image",
      src: "image.png",
      height: 200,
    });
    expect(normalized.children[2]).toEqual({
      type: "media",
      src: "movie.mp4",
      mediaType: "video",
    });
    expect(validateSmartDocument(normalized).valid).toBe(true);
  });
});
