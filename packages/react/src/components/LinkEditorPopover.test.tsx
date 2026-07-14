// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkEditorPopover } from "./LinkEditorPopover.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const renderPopover = (props: Partial<React.ComponentProps<typeof LinkEditorPopover>> = {}) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const merged: React.ComponentProps<typeof LinkEditorPopover> = {
    x: 10,
    y: 10,
    onApply: vi.fn(),
    onCancel: vi.fn(),
    ...props,
  };
  act(() => {
    root!.render(<LinkEditorPopover {...merged} />);
  });
  return merged;
};

const change = (selector: string, value: string) => {
  const input = document.querySelector(selector) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const click = (label: string) => {
  const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent === label) as HTMLButtonElement;
  act(() => button.click());
};

describe("LinkEditorPopover", () => {
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("applies a normalized link for selected text", () => {
    const onApply = vi.fn();
    renderPopover({ onApply });

    change("[data-srte-link-href-input]", "example.com");
    click("Insert");

    expect(onApply).toHaveBeenCalledWith({ href: "https://example.com", text: undefined, openInNewTab: false });
  });

  it("requires display text for collapsed insertion", () => {
    const onApply = vi.fn();
    renderPopover({ onApply, showTextInput: true });

    change("[data-srte-link-href-input]", "https://example.com");
    click("Insert");

    expect(onApply).not.toHaveBeenCalled();
    expect(document.querySelector("[data-srte-link-error]")?.textContent).toContain("display text");
  });

  it("applies collapsed insertion with display text", () => {
    const onApply = vi.fn();
    renderPopover({ onApply, showTextInput: true });

    change("[data-srte-link-text-input]", "Example");
    change("[data-srte-link-href-input]", "example.com");
    click("Insert");

    expect(onApply).toHaveBeenCalledWith({ href: "https://example.com", text: "Example", openInNewTab: false });
  });

  it("prefills edit state and supports remove/open/cancel", () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const onCancel = vi.fn();
    renderPopover({
      initialHref: "mailto:old@example.test",
      initialText: "Old",
      showTextInput: true,
      showOpen: true,
      showRemove: true,
      onOpen,
      onRemove,
      onCancel,
    });

    expect((document.querySelector("[data-srte-link-href-input]") as HTMLInputElement).value).toBe("mailto:old@example.test");
    expect((document.querySelector("[data-srte-link-text-input]") as HTMLInputElement).value).toBe("Old");
    click("Open");
    click("Remove link");
    click("Cancel");

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows validation instead of applying unsafe links", () => {
    const onApply = vi.fn();
    renderPopover({ onApply });

    change("[data-srte-link-href-input]", "javascript:alert(1)");
    click("Insert");

    expect(onApply).not.toHaveBeenCalled();
    expect(document.querySelector("[data-srte-link-error]")?.textContent).toContain("safe");
  });

  it.each([
    ["xyz@gmail.com", "mailto:xyz@gmail.com"],
    ["+91 98765 43210", "tel:+919876543210"],
  ])("normalizes %s", (input, href) => {
    const onApply = vi.fn();
    renderPopover({ onApply });

    change("[data-srte-link-href-input]", input);
    click("Insert");

    expect(onApply).toHaveBeenCalledWith({ href, text: undefined, openInNewTab: false });
  });

  it("allows normal pointer interaction in link fields", () => {
    renderPopover({ initialHref: "https://example.com/path" });
    const input = document.querySelector("[data-srte-link-href-input]") as HTMLInputElement;
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("applies secure new-tab behavior", () => {
    const onApply = vi.fn();
    renderPopover({ onApply });
    change("[data-srte-link-href-input]", "example.com");
    const checkbox = document.querySelector("[data-srte-link-new-tab-input]") as HTMLInputElement;
    act(() => checkbox.click());
    click("Insert");

    expect(onApply).toHaveBeenCalledWith({
      href: "https://example.com",
      text: undefined,
      openInNewTab: true,
    });
  });
});
