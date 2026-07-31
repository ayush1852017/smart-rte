// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { executeDomTableCommand, executeDomTableRemoval } from "./domTableCommandBridge.js";

describe("DOM table command bridge", () => {
  it("merges through core while preserving unrelated DOM and anchor styling", () => {
    document.body.innerHTML = `
      <div id="editor">
        <p data-keep="yes">Before</p>
        <table style="width:80%"><tbody>
          <tr><td style="background:red"><p>A</p></td><td><p>B</p></td></tr>
          <tr><td><p>C</p></td><td><p>D</p></td></tr>
        </tbody></table>
        <p>After</p>
      </div>`;
    const root = document.getElementById("editor")!;
    const table = root.querySelector("table")!;
    const replacement = executeDomTableCommand(table, {
      id: "table.cell.merge",
      input: {
        start: { row: 0, column: 0 },
        end: { row: 1, column: 1 },
      },
    });
    expect(replacement).not.toBeNull();
    const merged = replacement!.querySelector("td")!;
    expect(merged.colSpan).toBe(2);
    expect(merged.rowSpan).toBe(2);
    expect(merged.style.background).toBe("red");
    expect(replacement!.style.width).toBe("80%");
    expect(root.querySelector('[data-keep="yes"]')?.textContent).toBe("Before");
    expect(root.lastElementChild?.textContent).toBe("After");
    expect(merged.textContent).toBe("ABCD");
  });

  it("splits a merged cell and retains its content in the anchor", () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr><th colspan="2" rowspan="2" style="color:blue"><p>Value</p></th></tr>
        <tr></tr>
      </tbody></table>`;
    const table = document.querySelector("table")!;
    const replacement = executeDomTableCommand(table, {
      id: "table.cell.split",
      input: { row: 1, column: 1 },
    });
    expect(replacement?.rows[0].cells).toHaveLength(2);
    expect(replacement?.rows[1].cells).toHaveLength(2);
    expect(replacement?.rows[0].cells[0].tagName).toBe("TH");
    expect(replacement?.rows[0].cells[0].textContent).toBe("Value");
    expect(replacement?.rows[0].cells[0].style.color).toBe("blue");
  });

  it("adds and removes logical rows through a merged cell", () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr><td rowspan="2" style="background:red"><p>A</p></td><td><p>B</p></td></tr>
        <tr><td><p>C</p></td></tr>
      </tbody></table>`;
    let table = document.querySelector("table")!;
    table = executeDomTableCommand(table, {
      id: "table.row.add",
      input: { index: 1 },
    })!;
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0].cells[0].rowSpan).toBe(3);
    expect(table.rows[0].cells[0].style.background).toBe("red");

    table = executeDomTableCommand(table, {
      id: "table.row.remove",
      input: { index: 0 },
    })!;
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].cells[0].rowSpan).toBe(2);
    expect(table.rows[0].cells[0].textContent).toBe("A");
  });

  it("adds and removes logical columns while retaining header styling", () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr><th colspan="2" style="color:blue"><p>Header</p></th></tr>
        <tr><td><p>A</p></td><td><p>B</p></td></tr>
      </tbody></table>`;
    let table = document.querySelector("table")!;
    table = executeDomTableCommand(table, {
      id: "table.column.add",
      input: { index: 1 },
    })!;
    expect(table.rows[0].cells[0].colSpan).toBe(3);
    expect(table.rows[0].cells[0].style.color).toBe("blue");
    expect(table.rows[1].cells).toHaveLength(3);

    table = executeDomTableCommand(table, {
      id: "table.column.remove",
      input: { index: 1 },
    })!;
    expect(table.rows[0].cells[0].colSpan).toBe(2);
    expect(table.rows[1].cells).toHaveLength(2);
  });

  it("toggles logical headers and reconciles their visual defaults", () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr><td rowspan="2"><p>A</p></td><td><p>B</p></td></tr>
        <tr><td><p>C</p></td></tr>
      </tbody></table>`;
    let table = document.querySelector("table")!;
    table = executeDomTableCommand(table, {
      id: "table.header.column.toggle",
      input: { row: 1, column: 0 },
    })!;
    expect(table.rows[0].cells[0].tagName).toBe("TH");
    expect(table.rows[0].cells[0].rowSpan).toBe(2);
    expect(table.rows[0].cells[0].style.fontWeight).toBe("700");

    table = executeDomTableCommand(table, {
      id: "table.header.column.toggle",
      input: { row: 0, column: 0 },
    })!;
    expect(table.rows[0].cells[0].tagName).toBe("TD");
    expect(table.rows[0].cells[0].style.fontWeight).toBe("");
  });

  it("removes only the requested table through the core command", () => {
    document.body.innerHTML = `
      <div><p>Before</p><table><tbody><tr><td><p>A</p></td></tr></tbody></table><p>After</p></div>`;
    const table = document.querySelector("table")!;
    expect(executeDomTableRemoval(table)).toBe(true);
    expect(document.querySelector("table")).toBeNull();
    expect(document.querySelector("div")?.textContent).toBe("BeforeAfter");
  });

  it("applies cell colors through the canonical table model", () => {
    document.body.innerHTML = `
      <table style="width:80%"><tbody>
        <tr><td rowspan="2" class="anchor"><p>A</p></td><td><p>B</p></td></tr>
        <tr><td><p>C</p></td></tr>
      </tbody></table>`;
    const table = executeDomTableCommand(document.querySelector("table")!, {
      id: "table.cell.style.set",
      input: {
        start: { row: 1, column: 0 },
        end: { row: 1, column: 1 },
        backgroundColor: "rgb(18, 52, 86)",
        textColor: "rgb(255, 255, 255)",
      },
    })!;
    expect(table.rows[0].cells[0].rowSpan).toBe(2);
    expect(table.rows[0].cells[0].className).toBe("anchor");
    expect(table.rows[0].cells[0].style.backgroundColor).toBe("rgb(18, 52, 86)");
    expect(table.rows[1].cells[0].style.color).toBe("rgb(255, 255, 255)");
    expect(table.rows[0].cells[1].style.backgroundColor).toBe("");
  });

  it("projects persistent column widths and row heights in place", () => {
    document.body.innerHTML = `
      <table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>`;
    const original = document.querySelector("table")!;
    const table = executeDomTableCommand(original, {
      id: "table.column.width.set",
      input: { index: 1, widthPx: 180 },
    })!;
    expect(table).toBe(original);
    expect(table.querySelectorAll("col")).toHaveLength(2);
    expect((table.querySelectorAll("col")[1] as HTMLElement).style.width).toBe("180px");
    expect(table.rows[0].cells[1].style.width).toBe("180px");

    expect(executeDomTableCommand(table, {
      id: "table.row.height.set",
      input: { index: 0, heightPx: 48 },
    })).toBe(table);
    expect(table.rows[0].style.height).toBe("48px");
    expect(table.rows[0].cells[0].style.height).toBe("48px");
  });

  it("toggles borders in place over a merged logical range", () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr><td rowspan="2"><p>A</p></td><td><p>B</p></td></tr>
        <tr><td><p>C</p></td></tr>
      </tbody></table>`;
    const original = document.querySelector("table")!;
    const table = executeDomTableCommand(original, {
      id: "table.cell.border.toggle",
      input: {
        start: { row: 1, column: 0 },
        end: { row: 1, column: 1 },
      },
    })!;
    expect(table).toBe(original);
    expect(table.rows[0].cells[0].style.border).toContain("1px solid");
    expect(table.rows[1].cells[0].style.border).toContain("1px solid");
    expect(table.rows[0].cells[1].style.border).toBe("");
  });
});
