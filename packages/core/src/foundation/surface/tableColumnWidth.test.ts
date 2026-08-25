// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSubtreeRenderer } from "./index.js";
import type { SmartDocument, SmartSelection } from "../types.js";

const caret = (path = [0, 0, 0, 0]): SmartSelection => ({ type: "text", anchor: { path, offset: 0 }, head: { path, offset: 0 } });

const tableDoc = (columnWidths?: number[]): SmartDocument => ({
  type: "doc", id: "doc", children: [
    { type: "table", id: "t", attrs: { ...(columnWidths ? { columnWidths } : {}) }, children: [
      { type: "table_row", id: "r", children: [
        { type: "table_cell", id: "c0", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "p0", children: [{ type: "text", text: "a" }] }] },
        { type: "table_cell", id: "c1", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "p1", children: [{ type: "text", text: "b" }] }] },
      ] },
    ] },
  ],
});

/**
 * Phase 11.5 §2.2 found this while building table resize handles: table.
 * attrs.columnWidths was written by setTableColumnWidthCommand but never
 * read by surface/renderer.ts at all - a real, previously-invisible gap
 * (docs/bugs/table-column-width-not-rendered.md). A resize-handle UI
 * calling that command would have had zero visible effect without this
 * fix.
 */
describe("table.attrs.columnWidths is rendered as a real <colgroup>", () => {
  it("creates one <col> per column with the declared pixel width", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(tableDoc([80, 200]), caret());

    const table = renderer.mapping.nodeToDom("t") as HTMLTableElement;
    const cols = table.querySelectorAll("colgroup col");
    expect(cols).toHaveLength(2);
    expect((cols[0] as HTMLElement).style.width).toBe("80px");
    expect((cols[1] as HTMLElement).style.width).toBe("200px");
    // The colgroup must not be mistaken for a model child during diffing.
    expect(table.querySelector("colgroup")?.hasAttribute("data-smart-id")).toBe(false);
  });

  it("updates existing <col> widths and adds/removes columns as columnWidths changes", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(tableDoc([80, 200]), caret());
    renderer.render(tableDoc([120, 150]), caret());

    const table = renderer.mapping.nodeToDom("t") as HTMLTableElement;
    const cols = table.querySelectorAll("colgroup col");
    expect((cols[0] as HTMLElement).style.width).toBe("120px");
    expect((cols[1] as HTMLElement).style.width).toBe("150px");
  });

  it("renders no colgroup when columnWidths is absent, and removes one if it's cleared", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(tableDoc(), caret());
    let table = renderer.mapping.nodeToDom("t") as HTMLTableElement;
    expect(table.querySelector("colgroup")).toBeNull();

    renderer.render(tableDoc([80, 200]), caret());
    table = renderer.mapping.nodeToDom("t") as HTMLTableElement;
    expect(table.querySelector("colgroup")).not.toBeNull();

    renderer.render(tableDoc(), caret());
    table = renderer.mapping.nodeToDom("t") as HTMLTableElement;
    expect(table.querySelector("colgroup")).toBeNull();
  });

  /**
   * Post-Phase-11.5 bug batch item 6: the stylesheet's `table { width:
   * 100% }` combined with `table-layout: fixed` (set whenever columnWidths
   * is present) makes every <col> width a *proportion* of the table's
   * rendered width, not a literal pixel value - resizing one column
   * visibly shifted every other column's rendered width too, even though
   * their own columnWidths entries were untouched (docs/bugs/
   * table-resize-moves-unrelated-columns.md). Pinning the table's own
   * inline width to the literal sum of columnWidths overrides that
   * default, so table-layout: fixed gives each column exactly its
   * specified pixel width.
   */
  it("pins the table's own width to the sum of columnWidths, overriding the stylesheet's width:100%", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(tableDoc([80, 200]), caret());
    let table = renderer.mapping.nodeToDom("t") as HTMLTableElement;
    expect(table.style.width).toBe("280px");

    renderer.render(tableDoc([120, 200]), caret());
    table = renderer.mapping.nodeToDom("t") as HTMLTableElement;
    expect(table.style.width).toBe("320px");

    renderer.render(tableDoc(), caret());
    table = renderer.mapping.nodeToDom("t") as HTMLTableElement;
    expect(table.style.width).toBe("");
  });
});

/**
 * Post-Phase-11.5 bug batch: table_cell.attrs.textColor was already a
 * real, settable attribute (via table.setCellAttributes, parsed from HTML
 * import) but this renderer never applied it at all - the same "written,
 * never rendered" gap columnWidths had before it. Found wiring the new
 * "Cell text colour" context menu item, which would otherwise have
 * applied a value with zero visible effect. background was already
 * rendered correctly; included here as a sanity check alongside the fix.
 */
describe("table_cell.attrs.background/textColor are rendered as real CSS", () => {
  const cellDoc = (attrs: Record<string, unknown>): SmartDocument => ({
    type: "doc", id: "doc", children: [
      { type: "table", id: "t", attrs: {}, children: [
        { type: "table_row", id: "r", children: [
          { type: "table_cell", id: "c0", attrs: { rowspan: 1, colspan: 1, header: false, ...attrs }, children: [{ type: "paragraph", id: "p0", children: [{ type: "text", text: "a" }] }] },
        ] },
      ] },
    ],
  });

  it("applies background and textColor as inline styles, and clears them when unset", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(cellDoc({ background: "#ffc9c9", textColor: "#1971c2" }), caret([0, 0, 0, 0]));
    const cell = renderer.mapping.nodeToDom("c0") as HTMLElement;
    expect(cell.style.background).toContain("rgb(255, 201, 201)");
    expect(cell.style.color).toBe("rgb(25, 113, 194)");

    renderer.render(cellDoc({}), caret([0, 0, 0, 0]));
    // jsdom's live CSSStyleDeclaration getter doesn't always reflect a
    // removeProperty call made through a different reference in the same
    // synchronous tick - the style *attribute* (outerHTML/getAttribute,
    // both DOM-level ground truth) is what actually renders, and is
    // correctly cleared; re-reading through .style here is a jsdom
    // artifact, not a real behavior difference.
    expect(cell.getAttribute("style") || "").toBe("");
  });
});
