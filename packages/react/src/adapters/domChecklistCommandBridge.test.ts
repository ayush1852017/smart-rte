// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { executeDomChecklistItemCommand } from "./domChecklistCommandBridge.js";

describe("DOM checklist command bridge", () => {
  it("updates one item through core while preserving the list subtree styles", () => {
    document.body.innerHTML = `
      <div>
        <p>Before</p>
        <ul data-srte-checklist="true" data-srte-checklist-strike="true" style="list-style-type:none">
          <li data-srte-checked="false" style="color:red"><p>One</p></li>
          <li data-srte-checked="false"><p>Two</p></li>
        </ul>
        <p>After</p>
      </div>`;
    const list = document.querySelector("ul") as HTMLElement;
    const item = list.children[1] as HTMLElement;
    const result = executeDomChecklistItemCommand(list, item, true);
    expect(result).toBe(list);
    expect(result?.children[0].getAttribute("data-srte-checked")).toBe("false");
    expect(result?.children[1]).toBe(item);
    expect(result?.children[1].getAttribute("data-checked")).toBe("true");
    expect((result?.children[0] as HTMLElement).style.color).toBe("red");
    expect(result?.style.listStyleType).toBe("none");
    expect(document.querySelector("div")?.firstElementChild?.textContent).toBe("Before");
    expect(document.querySelector("div")?.lastElementChild?.textContent).toBe("After");
  });

  it("declines items outside the checklist", () => {
    document.body.innerHTML = '<ul data-srte-checklist="true"><li>A</li></ul><li id="other">B</li>';
    expect(executeDomChecklistItemCommand(
      document.querySelector("ul") as HTMLElement,
      document.getElementById("other") as HTMLElement,
    )).toBeNull();
  });
});
