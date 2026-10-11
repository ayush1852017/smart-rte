import { expect, test, type Page } from "@playwright/test";
import { openToolbarDropdown, toolbarMenuItem } from "./toolbarHelpers.js";

/**
 * Image captions, host image insertion (insertImage) and the caption
 * projection's live behaviour (1.2.0). Images use an inline data: URI so they
 * load instantly on every engine - a fake remote URL races WebKit's 0x0
 * broken-image box (docs/bugs/webkit-broken-image-zero-size-race.md).
 */
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type RuntimeWindow = Window & {
  __smartProductCanonical?: {
    insertImage: (input: Record<string, unknown>, opts?: Record<string, unknown>) => { ok: boolean; nodeId?: string; reason?: string };
    editor: { document: { children: { type: string; attrs?: Record<string, unknown> }[] }; selection: { head: { path: number[] } } };
    surface: { pipeline: { handlePaste: (event: ClipboardEvent) => void } | null };
  };
  getCleanHtml?: () => string;
  loadRawHtml?: (html: string) => void;
  __lastInsert?: unknown;
};

const surface = (page: Page) => page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
const caption = (page: Page) => surface(page).locator('[data-smart-projection="image-caption"]');

const load = async (page: Page, html: string) => {
  await page.goto("/?canonicalAuthority=1&blocks=1");
  await expect(surface(page)).toBeVisible();
  await page.evaluate((value) => (window as RuntimeWindow).loadRawHtml!(value), html);
};

const expectCaptionUnderImage = async (page: Page, text: string) => {
  const image = surface(page).locator('img[data-smart-type="block_image"]');
  await expect(caption(page)).toHaveText(text);
  const imageBox = (await image.boundingBox())!;
  const captionBox = (await caption(page).boundingBox())!;
  expect(captionBox.y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height - 1);
  expect(captionBox.y - (imageBox.y + imageBox.height)).toBeLessThan(24);
  // The projection really is the image's next sibling.
  expect(await image.evaluate((element) => element.nextElementSibling?.getAttribute("data-smart-projection"))).toBe("image-caption");
};

test.describe("image captions", () => {
  test("a host panel outside the editor inserts a captioned image at the caret without taking focus", async ({ page }) => {
    await load(page, "<p>First paragraph</p><p>Second paragraph</p><p>Third paragraph</p>");
    await page.evaluate((src) => {
      const panel = document.createElement("div");
      panel.innerHTML = '<input id="host-query" value="growth chart"><button id="host-insert" type="button">Insert figure</button>';
      document.body.appendChild(panel);
      const insert = () => {
        (window as RuntimeWindow).__lastInsert = (window as RuntimeWindow).__smartProductCanonical!.insertImage({
          src, alt: "Growth chart", caption: "Figure 1: Growth since 2020",
        });
      };
      document.getElementById("host-insert")!.addEventListener("click", insert);
      document.getElementById("host-query")!.addEventListener("keydown", (event) => { if (event.key === "Enter") insert(); });
    }, PIXEL);
    await surface(page).getByText("Second paragraph").click();
    // The user works in the host panel, then inserts from it (Enter in the
    // panel's own field - a text input keeps focus on every engine, unlike a
    // clicked <button>, which WebKit never focuses).
    await page.locator("#host-query").click();
    await page.keyboard.press("Enter");

    expect(await page.evaluate(() => (window as RuntimeWindow).__lastInsert)).toMatchObject({ ok: true });
    await expect(page.locator("#host-query")).toBeFocused();
    const blocks = surface(page).locator(":scope > [data-smart-type]");
    await expect(blocks.nth(2)).toHaveAttribute("data-smart-type", "block_image");
    await expect(blocks.nth(1)).toHaveText("Second paragraph");
    await expectCaptionUnderImage(page, "Figure 1: Growth since 2020");
    await expect(surface(page)).not.toContainText("Unsupported");

    // A second insert from the panel's button: focus must not land in the editor.
    await page.locator("#host-insert").click();
    expect(await page.evaluate(() => (window as RuntimeWindow).__lastInsert)).toMatchObject({ ok: true });
    await expect(surface(page).locator('img[data-smart-type="block_image"]')).toHaveCount(2);
    expect(await surface(page).evaluate((root) => root.contains(document.activeElement))).toBe(false);
  });

  test("a caption added in Media details renders under the image and survives save -> reload", async ({ page }) => {
    await load(page, `<p>Before</p><img src="${PIXEL}" alt="A pixel" width="120" height="60"><p>After</p>`);
    const image = surface(page).locator('img[data-smart-type="block_image"]');
    await image.click({ button: "right" });
    const popover = page.locator('[data-srte-media-details-popover="true"]');
    await expect(popover).toBeVisible();
    await popover.locator("[data-srte-media-caption-input]").fill("A tiny <pixel> & friends");
    await popover.getByRole("button", { name: "Apply" }).click();
    await expect(popover).toHaveCount(0);
    await expectCaptionUnderImage(page, "A tiny <pixel> & friends");

    const html = await page.evaluate(() => (window as RuntimeWindow).getCleanHtml!());
    expect(html).toContain("<figcaption>A tiny &lt;pixel&gt; &amp; friends</figcaption></figure>");
    await page.reload();
    await expect(surface(page)).toBeVisible();
    await page.evaluate((value) => (window as RuntimeWindow).loadRawHtml!(value), html);
    await expectCaptionUnderImage(page, "A tiny <pixel> & friends");

    // Clicking the caption reopens Media details with the Caption field focused.
    await caption(page).click();
    const reopened = page.locator('[data-srte-media-details-popover="true"]');
    await expect(reopened).toBeVisible();
    await expect(reopened.locator("[data-srte-media-caption-input]")).toBeFocused();
    await expect(reopened.locator("[data-srte-media-caption-input]")).toHaveValue("A tiny <pixel> & friends");
    await reopened.locator("[data-srte-media-caption-input]").fill("");
    await reopened.getByRole("button", { name: "Apply" }).click();
    await expect(caption(page)).toHaveCount(0);
  });

  test("pasting a web page's <figure> keeps the image and its caption, with no [Unsupported] placeholder", async ({ page }) => {
    await load(page, "<p>Start</p>");
    await surface(page).getByText("Start").click();
    await page.keyboard.press("End");
    await page.evaluate((src) => {
      const transfer = new DataTransfer();
      transfer.setData("text/html", `<meta charset="utf-8"><figure class="wp-block-image"><img src="${src}" alt="Bridge" width="80" height="40"><figcaption class="wp-element-caption">The <em>Golden Gate</em> at dusk</figcaption></figure>`);
      transfer.setData("text/plain", "The Golden Gate at dusk");
      (window as RuntimeWindow).__smartProductCanonical!.surface.pipeline!.handlePaste({ clipboardData: transfer, preventDefault: () => undefined } as unknown as ClipboardEvent);
    }, PIXEL);
    await expect(surface(page)).not.toContainText("Unsupported");
    await expect(surface(page).locator('img[data-smart-type="block_image"]')).toHaveCount(1);
    await expectCaptionUnderImage(page, "The Golden Gate at dusk");
  });

  test("select-all and delete still works with a captioned image in the document", async ({ page }) => {
    await load(page, `<p>Alpha</p><figure><img src="${PIXEL}" alt="A" width="40" height="40"><figcaption>Cap</figcaption></figure><p>Omega</p>`);
    await surface(page).getByText("Alpha").click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await expect(surface(page).locator('img[data-smart-type="block_image"]')).toHaveCount(0);
    await expect(caption(page)).toHaveCount(0);
    await expect(surface(page)).not.toContainText("Alpha");
    await expect(surface(page)).not.toContainText("Omega");
  });

  test("the caption stays attached to its image through a block move past it, typing around it, and undo/redo", async ({ page }) => {
    await load(page, `<p>One</p><figure><img src="${PIXEL}" alt="A" width="40" height="40"><figcaption>Stays put</figcaption></figure><p>Two</p>`);
    await surface(page).getByText("Two").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Three");
    const undo = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redo = process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await expectCaptionUnderImage(page, "Stays put");
    // Move "Two" up past the image: the image element itself is reordered.
    await surface(page).getByText("Two").click();
    await openToolbarDropdown(page, "More paragraph tools");
    await toolbarMenuItem(page, "Move block up").click();
    const order = () => surface(page).evaluate((root) => [...root.children].map((child) => child.getAttribute("data-smart-type") === "block_image" ? "IMG" : child.getAttribute("data-smart-projection") === "image-caption" ? "CAP" : child.textContent?.trim()).filter(Boolean));
    await expect.poll(order).toEqual(["One", "Two", "IMG", "CAP", "Three"]);
    await expectCaptionUnderImage(page, "Stays put");
    await page.keyboard.press(undo);
    await expect.poll(order).toEqual(["One", "IMG", "CAP", "Two", "Three"]);
    await expectCaptionUnderImage(page, "Stays put");
    await page.keyboard.press(redo);
    await expect.poll(order).toEqual(["One", "Two", "IMG", "CAP", "Three"]);
    await expectCaptionUnderImage(page, "Stays put");
    // Typing directly after the image (in the paragraph below its caption).
    await surface(page).getByText("Two").click();
    await page.keyboard.press("Home");
    await page.keyboard.type("X");
    await expect(surface(page).getByText("XTwo")).toBeVisible();
    await expectCaptionUnderImage(page, "Stays put");
  });
});
