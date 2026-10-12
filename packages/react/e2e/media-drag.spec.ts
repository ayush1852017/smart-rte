import { expect, test, type Page } from "@playwright/test";
import { openToolbarDropdown, toolbarMenuItem } from "./toolbarHelpers.js";

/**
 * Block media drag-and-drop (1.3.0, MediaDragController). Pointer-based:
 * a grab handle, direct drag past a 6px threshold, a 450ms long press on
 * touch, and a keyboard path from the focused handle. One moveNode per
 * drop, so one undo step and the node keeps its id, size and caption.
 */
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FIGURE = `<figure><img src="${PIXEL}" alt="Diagram" width="160" height="90"><figcaption>Wiggers diagram</figcaption></figure>`;

type Node = { type: string; id: string; attrs?: Record<string, unknown>; children?: Node[]; text?: string };
type RuntimeWindow = Window & {
  __smartProductCanonical?: { editor: { document: Node; selection: { type: string } } };
  loadRawHtml?: (html: string) => void;
};

const surface = (page: Page) => page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
const image = (page: Page) => surface(page).locator('img[data-smart-type="block_image"]');
const handle = (page: Page) => page.locator("[data-srte-media-drag-handle]");
const undoKey = process.platform === "darwin" ? "Meta+Z" : "Control+Z";

const load = async (page: Page, html: string) => {
  await page.goto("/?canonicalAuthority=1&blocks=1");
  await expect(surface(page)).toBeVisible();
  await page.evaluate((value) => (window as RuntimeWindow).loadRawHtml!(value), html);
};

/** Top-level order: text of each block, "IMG"/"VIDEO"/... for media, empty boundary paragraphs dropped. */
const order = (page: Page) => page.evaluate(() => {
  const text = (node: Node): string => node.text ?? (node.children || []).map(text).join("");
  return (window as RuntimeWindow).__smartProductCanonical!.editor.document.children!
    .map((node) => node.type === "paragraph" || node.type === "heading" ? text(node) : node.type === "block_image" ? "IMG" : node.type.toUpperCase())
    .filter(Boolean);
});

const imageNode = (page: Page) => page.evaluate(() => {
  const find = (node: Node): Node | null => node.type === "block_image" ? node : (node.children || []).map(find).find(Boolean) ?? null;
  return find((window as RuntimeWindow).__smartProductCanonical!.editor.document);
});

const center = async (page: Page, selector: ReturnType<Page["locator"]>) => {
  const box = (await selector.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

/** Pointer drag with intermediate moves (pointer events need real movement to cross the threshold). */
const dragTo = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }, beforeUp?: () => Promise<void>) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 8, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (beforeUp) await beforeUp();
  await page.mouse.up();
};

test.describe("block media drag-and-drop", () => {
  test("drags an image by its handle between two paragraphs: same node, size and caption; one undo restores it", async ({ page }) => {
    await load(page, `<p>Alpha</p>${FIGURE}<p>Beta</p><p>Gamma</p>`);
    const before = await imageNode(page);
    await image(page).hover();
    await expect(handle(page)).toBeVisible();
    await expect(handle(page)).toHaveAttribute("aria-label", "Drag to move image");
    const from = await center(page, handle(page));
    const gamma = (await surface(page).getByText("Gamma").boundingBox())!;
    await dragTo(page, from, { x: gamma.x + 40, y: gamma.y - 2 }, async () => {
      // While dragging: the original stays in place, dimmed; a small preview follows the pointer; one drop line shows.
      await expect(image(page)).toHaveAttribute("data-srte-drag-source", "true");
      const preview = page.locator("[data-srte-media-drag-preview] img");
      const previewBox = (await preview.boundingBox())!;
      expect(previewBox.width).toBeLessThanOrEqual(120);
      expect(previewBox.height).toBeLessThanOrEqual(80);
      await expect(page.locator("[data-srte-media-drag-preview]")).toContainText("Wiggers diagram");
      await expect(page.locator("[data-srte-media-drop-line]")).toHaveCount(1);
    });
    await expect.poll(() => order(page)).toEqual(["Alpha", "Beta", "IMG", "Gamma"]);
    const after = await imageNode(page);
    expect(after).toEqual(before);
    await expect(image(page)).toHaveCount(1);
    await expect(image(page)).not.toHaveAttribute("data-srte-drag-source");
    await expect(page.locator("[data-srte-media-drag-preview]")).toHaveCount(0);
    // Full size again, caption still directly under it, and the moved image is selected.
    const box = (await image(page).boundingBox())!;
    expect(Math.round(box.width)).toBe(160);
    expect(await image(page).evaluate((element) => element.nextElementSibling?.textContent)).toBe("Wiggers diagram");
    expect(await page.evaluate(() => (window as RuntimeWindow).__smartProductCanonical!.editor.selection.type)).toBe("node");
    await page.keyboard.press(undoKey);
    await expect.poll(() => order(page)).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
    expect(await imageNode(page)).toEqual(before);
  });

  test("direct drag on the image past the threshold moves it; a click under the threshold still just selects", async ({ page }) => {
    await load(page, `<p>Alpha</p>${FIGURE}<p>Beta</p><p>Gamma</p>`);
    const from = await center(page, image(page));
    // A press with a 4px wobble is a click: it selects, nothing moves.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 3, from.y + 2, { steps: 2 });
    await page.mouse.up();
    expect(await page.evaluate(() => (window as RuntimeWindow).__smartProductCanonical!.editor.selection.type)).toBe("node");
    expect(await order(page)).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
    await expect(page.locator("[data-srte-media-drag-preview]")).toHaveCount(0);
    // A real drag from the image itself.
    const gamma = (await surface(page).getByText("Gamma").boundingBox())!;
    await dragTo(page, from, { x: gamma.x + 40, y: gamma.y + gamma.height + 4 });
    await expect.poll(() => order(page)).toEqual(["Alpha", "Beta", "Gamma", "IMG"]);
    await expect(image(page)).toHaveCount(1);
  });

  test("drags into a table cell", async ({ page }) => {
    await load(page, `<p>Alpha</p>${FIGURE}<p>Beta</p><table><tbody><tr><td><p>Left cell</p></td><td><p>Right cell</p></td></tr></tbody></table><p>After</p>`);
    await image(page).hover();
    const from = await center(page, handle(page));
    const cell = (await surface(page).getByText("Right cell").boundingBox())!;
    await dragTo(page, from, { x: cell.x + 10, y: cell.y + cell.height - 2 }, async () => {
      await expect(page.locator("[data-srte-media-drop-container]")).toHaveCount(1);
    });
    await expect.poll(() => page.evaluate(() => {
      const td = document.querySelectorAll('[contenteditable="true"] td')[1];
      return [...td.querySelectorAll('[data-smart-type="block_image"], p')].map((element) => element.tagName === "IMG" ? "IMG" : element.textContent).filter(Boolean);
    })).toEqual(["Right cell", "IMG"]);
    expect(await order(page)).toEqual(["Alpha", "Beta", "TABLE", "After"]);
  });

  test("an invalid target (outside the editor) shows no drop line and changes nothing; Esc cancels mid-drag", async ({ page }) => {
    await load(page, `<p>Alpha</p>${FIGURE}<p>Beta</p><p>Gamma</p>`);
    await image(page).hover();
    let from = await center(page, handle(page));
    const editorBox = (await surface(page).boundingBox())!;
    await dragTo(page, from, { x: editorBox.x + editorBox.width / 2, y: editorBox.y + editorBox.height + 60 }, async () => {
      await expect(page.locator("[data-srte-media-drop-line]")).toHaveCount(0);
    });
    expect(await order(page)).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
    await expect(image(page)).not.toHaveAttribute("data-srte-drag-source");
    // Esc mid-drag.
    await image(page).hover();
    from = await center(page, handle(page));
    const gamma = (await surface(page).getByText("Gamma").boundingBox())!;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(gamma.x + 20, gamma.y + gamma.height, { steps: 10 });
    await expect(page.locator("[data-srte-media-drop-line]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-srte-media-drop-line]")).toHaveCount(0);
    await page.mouse.up();
    expect(await order(page)).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
    await expect(page.locator("[data-srte-media-drag-status]")).toHaveText("Move cancelled.");
  });

  test("auto-scrolls to a target below the fold", async ({ page }) => {
    const filler = Array.from({ length: 40 }, (_, index) => `<p>Line ${index + 1}</p>`).join("");
    await load(page, `<p>Top</p>${FIGURE}${filler}<p>Bottom</p>`);
    await image(page).hover();
    const from = await center(page, handle(page));
    const scroller = surface(page);
    const box = (await scroller.boundingBox())!;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + box.height - 10, { steps: 10 });
    // Hold near the bottom edge until the surface has scrolled to the end.
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2), { timeout: 15_000 }).toBe(true);
    await page.mouse.move(box.x + 60, box.y + box.height - 12, { steps: 2 });
    await page.mouse.up();
    const result = await order(page);
    expect(result.indexOf("IMG")).toBeGreaterThan(result.indexOf("Line 35"));
  });

  test("video and block formula move too", async ({ page }) => {
    await load(page, `<p>Alpha</p><video src="https://example.com/v.mp4" controls></video><p>Beta</p><div data-smart-type="block_formula" data-smart-notation="latex" data-smart-formula="E=mc^2"></div><p>Gamma</p>`);
    const media = surface(page).locator('[data-smart-type="video"]');
    await expect(media).toHaveCount(1);
    await media.hover();
    await expect(handle(page)).toHaveAttribute("aria-label", "Drag to move video");
    let from = await center(page, handle(page));
    const gamma = (await surface(page).getByText("Gamma").boundingBox())!;
    await dragTo(page, from, { x: gamma.x + 30, y: gamma.y + gamma.height + 2 });
    await expect.poll(() => order(page)).toEqual(expect.arrayContaining(["VIDEO"]));
    expect((await order(page)).at(-1)).toBe("VIDEO");
    const formula = surface(page).locator('[data-smart-type="block_formula"]');
    await expect(formula).toHaveCount(1);
    await formula.hover();
    await expect(handle(page)).toHaveAttribute("aria-label", "Drag to move formula");
    from = await center(page, handle(page));
    const alpha = (await surface(page).getByText("Alpha").boundingBox())!;
    await dragTo(page, from, { x: alpha.x + 30, y: alpha.y - 2 });
    await expect.poll(async () => (await order(page))[0]).toBe("BLOCK_FORMULA");
  });

  test("keyboard-only move from the handle: Space picks up, arrows choose, Enter drops; Esc cancels", async ({ page }) => {
    await load(page, `<p>Alpha</p>${FIGURE}<p>Beta</p><p>Gamma</p>`);
    await image(page).click();
    await expect(handle(page)).toBeVisible();
    await handle(page).focus();
    await page.keyboard.press("Space");
    await expect(page.locator("[data-srte-media-drag-status]")).toContainText("Picked up image 'Wiggers diagram'");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("[data-srte-media-drag-status]")).toContainText("Drop position: after 'Beta'");
    await expect(page.locator("[data-srte-media-drop-line]")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect.poll(() => order(page)).toEqual(["Alpha", "Beta", "IMG", "Gamma"]);
    await expect(page.locator("[data-srte-media-drag-status]")).toHaveText("Moved.");
    // Pick up again and cancel.
    await image(page).click();
    await handle(page).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-srte-media-drag-status]")).toHaveText("Move cancelled.");
    expect(await order(page)).toEqual(["Alpha", "Beta", "IMG", "Gamma"]);
  });

  test("with track changes on, the handle is disabled with a reason and nothing moves", async ({ page }) => {
    await load(page, `<p>Alpha</p>${FIGURE}<p>Beta</p>`);
    await openToolbarDropdown(page, "Review");
    await toolbarMenuItem(page, "Show edits").click();
    await image(page).hover();
    await expect(handle(page)).toHaveAttribute("aria-disabled", "true");
    await expect(handle(page)).toHaveAttribute("title", /Turn off Show edits/);
    const from = await center(page, handle(page));
    const beta = (await surface(page).getByText("Beta").boundingBox())!;
    await dragTo(page, from, { x: beta.x + 20, y: beta.y + beta.height + 2 });
    expect(await order(page)).toEqual(["Alpha", "IMG", "Beta"]);
    // Direct drag on the image is off too.
    const direct = await center(page, image(page));
    await dragTo(page, direct, { x: beta.x + 20, y: beta.y + beta.height + 2 });
    expect(await order(page)).toEqual(["Alpha", "IMG", "Beta"]);
    await expect(page.locator("[data-srte-media-drag-preview]")).toHaveCount(0);
  });

  test("Move block up/down still works on a selected image (the keyboard fallback)", async ({ page }) => {
    await load(page, `<p>Alpha</p>${FIGURE}<p>Beta</p><p>Gamma</p>`);
    await image(page).click();
    await openToolbarDropdown(page, "More paragraph tools");
    await toolbarMenuItem(page, "Move block down").click();
    await expect.poll(() => order(page)).toEqual(["Alpha", "Beta", "IMG", "Gamma"]);
    expect(await image(page).evaluate((element) => element.nextElementSibling?.textContent)).toBe("Wiggers diagram");
  });

  test("works inside a transformed host (e.g. a centred dialog): handle beside the image, drop line where the pointer is", async ({ page }) => {
    await load(page, `<p>Alpha</p>${FIGURE}<p>Beta</p><p>Gamma</p>`);
    // A transformed ancestor becomes the containing block for position:fixed descendants.
    await page.evaluate(() => {
      const section = document.querySelector<HTMLElement>('[data-smart-authority="canonical"]')!;
      section.parentElement!.style.transform = "translate(37px, 23px)";
    });
    await image(page).hover();
    const imageBox = (await image(page).boundingBox())!;
    const handleBox = (await handle(page).boundingBox())!;
    // Level with the image's top and right beside it (left or right, whichever side has room) - not offset by the transform.
    expect(Math.abs(handleBox.y - imageBox.y)).toBeLessThan(2);
    const gapLeft = imageBox.x - (handleBox.x + handleBox.width);
    const gapRight = handleBox.x - (imageBox.x + imageBox.width);
    expect(Math.max(gapLeft, gapRight)).toBeGreaterThanOrEqual(0);
    expect(Math.max(gapLeft, gapRight)).toBeLessThan(12);
    const gamma = (await surface(page).getByText("Gamma").boundingBox())!;
    const target = { x: gamma.x + 40, y: gamma.y - 2 };
    await dragTo(page, await center(page, handle(page)), target, async () => {
      const line = (await page.locator("[data-srte-media-drop-line]").boundingBox())!;
      expect(Math.abs(line.y - target.y)).toBeLessThan(8);
    });
    await expect.poll(() => order(page)).toEqual(["Alpha", "Beta", "IMG", "Gamma"]);
  });

  test("the handle never covers the media, even for a small left-aligned image at the editor's edge", async ({ page }) => {
    await load(page, `<p>Alpha</p><img src="${PIXEL}" alt="Tiny" width="12" height="12" data-smart-align="left"><p>Beta</p>`);
    await image(page).hover();
    await expect(handle(page)).toBeVisible();
    const imageBox = (await image(page).boundingBox())!;
    const handleBox = (await handle(page).boundingBox())!;
    const overlaps = handleBox.x < imageBox.x + imageBox.width && handleBox.x + handleBox.width > imageBox.x
      && handleBox.y < imageBox.y + imageBox.height && handleBox.y + handleBox.height > imageBox.y;
    expect(overlaps).toBe(false);
    // The image itself is still clickable.
    await image(page).click({ trial: true });
  });

  test("text drag-and-drop still uses the native path", async ({ page }) => {
    await load(page, "<p>Alpha bravo</p><p>Charlie</p>");
    const moved = await page.evaluate(() => {
      const root = document.querySelector('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      const first = root.querySelector("p")!.firstChild!;
      const range = document.createRange();
      range.setStart(first, 6);
      range.setEnd(first, 11);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return true;
    });
    expect(moved).toBe(true);
    // A native dragstart on selected text is still handled by the input pipeline (it writes the selection to the transfer).
    const effect = await page.evaluate(() => new Promise<string>((resolve) => {
      const root = document.querySelector('[data-smart-authority="canonical"] [contenteditable="true"]')!;
      setTimeout(() => {
        const transfer = new DataTransfer();
        root.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        resolve(transfer.getData("text/plain"));
      }, 50);
    }));
    expect(effect).toBe("bravo");
    await expect(page.locator("[data-srte-media-drag-preview]")).toHaveCount(0);
  });
});

test.describe("block media drag-and-drop on touch", () => {
  test.use({ hasTouch: true });

  /** Real touch input (Chromium DevTools protocol): pointer events arrive with pointerType "touch" and the browser's own pan handling. */
  const touchDrag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }, holdMs: number) => {
    const cdp = await page.context().newCDPSession(page);
    const point = (x: number, y: number) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
    await page.waitForTimeout(holdMs);
    for (let step = 1; step <= 12; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(from.x + (to.x - from.x) * step / 12, from.y + (to.y - from.y) * step / 12) });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };

  test("long-press drag on the image and an immediate drag from the handle (real touch, Chromium)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "touch input is injected through the Chromium DevTools protocol");
    await load(page, `<p>Alpha</p>${FIGURE}<p>Beta</p><p>Gamma</p>`);
    const gamma = (await surface(page).getByText("Gamma").boundingBox())!;
    // A quick swipe on the image is a scroll, not a drag.
    await touchDrag(page, await center(page, image(page)), { x: gamma.x + 30, y: gamma.y + gamma.height + 2 }, 0);
    await page.waitForTimeout(100);
    expect(await order(page)).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
    // Holding first (past the 450ms long press) drags.
    await touchDrag(page, await center(page, image(page)), { x: gamma.x + 30, y: gamma.y + gamma.height + 2 }, 600);
    await expect.poll(() => order(page)).toEqual(["Alpha", "Beta", "Gamma", "IMG"]);
    // The handle starts a drag immediately on touch (it's touch-action: none).
    await image(page).click();
    await expect(handle(page)).toBeVisible();
    const alpha = (await surface(page).getByText("Alpha").boundingBox())!;
    await touchDrag(page, await center(page, handle(page)), { x: alpha.x + 30, y: alpha.y - 2 }, 0);
    await expect.poll(() => order(page)).toEqual(["IMG", "Alpha", "Beta", "Gamma"]);
  });

  test("touch pointer events: long press starts a drag, moving first does not", async ({ page }) => {
    await load(page, `<p>Alpha</p>${FIGURE}<p>Beta</p><p>Gamma</p>`);
    const from = await center(page, image(page));
    const gamma = (await surface(page).getByText("Gamma").boundingBox())!;
    const to = { x: gamma.x + 30, y: gamma.y + gamma.height + 2 };
    const gesture = (hold: number) => page.evaluate(async ({ from, to, hold }) => {
      const target = document.elementFromPoint(from.x, from.y)!;
      const fire = (type: string, x: number, y: number, on: EventTarget) => on.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, button: type === "pointermove" ? -1 : 0, clientX: x, clientY: y }));
      fire("pointerdown", from.x, from.y, target);
      await new Promise((resolve) => setTimeout(resolve, hold));
      for (let step = 1; step <= 10; step += 1) fire("pointermove", from.x + (to.x - from.x) * step / 10, from.y + (to.y - from.y) * step / 10, window);
      fire("pointerup", to.x, to.y, window);
    }, { from, to, hold });
    await gesture(50);
    expect(await order(page)).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
    await gesture(550);
    await expect.poll(() => order(page)).toEqual(["Alpha", "Beta", "Gamma", "IMG"]);
  });
});
