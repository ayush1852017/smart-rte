import { expect, test } from "@playwright/test";
import { openToolbarDropdown, toolbarMenuItem } from "./toolbarHelpers.js";

const chooseMedia = async (page: import("@playwright/test").Page) => {
  const picker = page.getByRole("dialog", { name: "Media library" });
  await picker.locator('input[type="file"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("media-details-generated") });
  await expect(picker).toHaveCount(0);
};

/**
 * docs/bugs/media-details-old-editor-field-parity.md
 *
 * Replaces the old window.prompt("Alt text")-only edit path with a real
 * settings panel matching the previous editor's own field set (Link,
 * Target, Alt, Width, Radius, Align, License), triggered directly by an
 * image right-click. Fields marked "already existed" in the investigation
 * (Alt/Width/Align) get regression coverage in existing specs already;
 * this file focuses on what's new here (Link/Target/Radius/License) and
 * the panel's own interaction contract.
 */
test.describe("Media details panel", () => {
  test("shows resize handles on left-click and the details editor on right-click", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page);

    const image = surface.locator('[data-smart-type="block_image"]');
    const mediaMenu = page.locator('[data-srte-media-overlay="true"]');
    const popover = page.locator('[data-srte-media-details-popover="true"]');
    const handles = page.locator('[data-srte-media-resize-handle-direction]');

    await image.click();
    await expect(mediaMenu).toHaveCount(0);
    await expect(handles).toHaveCount(8);
    const editorBox = (await surface.boundingBox())!;
    for (const handle of await handles.all()) {
      const box = (await handle.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(editorBox.x);
      expect(box.y).toBeGreaterThanOrEqual(editorBox.y);
      expect(box.x + box.width).toBeLessThanOrEqual(editorBox.x + editorBox.width);
      expect(box.y + box.height).toBeLessThanOrEqual(editorBox.y + editorBox.height);
    }

    await image.click({ button: "right" });
    await expect(popover).toBeVisible();
    await expect(mediaMenu).toHaveCount(0);
    await expect(handles).toHaveCount(8);
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
  });

  test("sets link, radius, and align, applying real visible effects and a working Ctrl/Cmd+click", async ({ page, context }) => {
    // The reference media provider's URLs (https://media.playground.test/...)
    // have no real backend - without a real response, the freshly-inserted
    // image has no intrinsic size while its `error` state is pending,
    // which WebKit renders as a genuine 0x0 box (not a sized "broken
    // image" glyph the way Chromium/Firefox do), racing this test's very
    // next action (an immediate right-click) against a live DNS failure
    // whose timing varies with the sandbox's network conditions - the
    // same pre-existing fragility documented in
    // docs/bugs/webkit-full-suite-timeout-flake.md. This test only right-
    // clicks once up front and never depends on the image's rendered
    // size afterward (unlike the resize-handle test below, deliberately
    // left unmocked), so serving a real 1x1 PNG - the same fix already
    // applied in canonical-authority.spec.ts's own media-upload test -
    // makes the right-click deterministic without changing what's asserted.
    const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await page.route("https://media.playground.test/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: onePixelPng }));
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page);

    const image = surface.locator('[data-smart-type="block_image"]');
    await image.click({ button: "right" });
    const popover = page.locator('[data-srte-media-details-popover="true"]');
    await expect(popover).toBeVisible();

    await popover.locator('[data-srte-media-alt-input]').fill("A test photo");
    // A real, resolvable domain, not the reserved example.test used
    // elsewhere in this file for plain attribute checks - this specific
    // assertion actually navigates (matching canonical-authority.spec.ts's
    // own "Ctrl/Cmd+click on a link opens it" test's exact convention),
    // which example.test cannot do in a network-isolated test run.
    await popover.locator('[data-srte-media-href-input]').fill("https://example.com");
    await popover.locator('[data-srte-media-new-tab-input]').check();
    await popover.locator('[data-srte-media-radius-input]').fill("16");
    await popover.getByRole("button", { name: "Left", exact: true }).click();
    await popover.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(popover).toHaveCount(0);

    await expect(image).toHaveAttribute("alt", "A test photo");
    await expect(image).toHaveAttribute("data-smart-href", "https://example.com");
    await expect(image).toHaveAttribute("data-smart-target", "_blank");
    await expect(image).toHaveCSS("border-radius", "16px");
    await expect(image).toHaveCSS("float", "left");

    // Ctrl/Cmd+click opens the link, the same mechanism a real text link
    // already uses - matches architecture confirmation that this stays a
    // plain data attribute + click handler, not a wrapping <a> in the live
    // DOM (surface/renderer.ts's own reasoning).
    const pagePromise = context.waitForEvent("page");
    await image.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    const newPage = await pagePromise;
    expect(newPage.url()).toContain("example.com");
    await newPage.close();
  });

  test("clears link and align when set back to empty/None", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page);
    const image = surface.locator('[data-smart-type="block_image"]');

    await image.click({ button: "right" });
    const popover = page.locator('[data-srte-media-details-popover="true"]');
    await popover.locator('[data-srte-media-href-input]').fill("https://example.test/source");
    await popover.getByRole("button", { name: "Right", exact: true }).click();
    await popover.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(popover).toHaveCount(0);
    await expect(image).toHaveAttribute("data-smart-href", "https://example.test/source");

    await image.click({ button: "right" });
    await popover.locator('[data-srte-media-href-input]').fill("");
    await popover.getByRole("button", { name: "None", exact: true }).click();
    await popover.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(popover).toHaveCount(0);

    await expect(image).not.toHaveAttribute("data-smart-href");
    await expect(image).toHaveCSS("float", "none");
  });

  test("rejects an unsafe link and keeps the panel open", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page);
    await surface.locator('[data-smart-type="block_image"]').click({ button: "right" });
    const popover = page.locator('[data-srte-media-details-popover="true"]');

    await popover.locator('[data-srte-media-href-input]').fill("javascript:alert(1)");
    await popover.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(popover).toBeVisible();
    await expect(popover.getByRole("alert")).toBeVisible();
  });

  test("sets license fields, including the custom license-type fallback", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page);
    await surface.locator('[data-smart-type="block_image"]').click({ button: "right" });
    const popover = page.locator('[data-srte-media-details-popover="true"]');

    await popover.locator('[data-srte-media-license-description-input]').fill("A lovely test photo");
    await popover.locator('[data-srte-media-license-source-input]').fill("https://example.test/license");
    await popover.locator('[data-srte-media-license-type-select]').selectOption("custom");
    await popover.locator('[data-srte-media-license-type-custom-input]').fill("My Custom License");
    await popover.locator('[data-srte-media-license-version-input]').fill("2.1");
    await popover.locator('[data-srte-media-license-attribution-input]').fill("Jane Doe");
    await popover.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(popover).toHaveCount(0);

    const image = surface.locator('[data-smart-type="block_image"]');
    await expect(image).toHaveAttribute("data-smart-license-description", "A lovely test photo");
    await expect(image).toHaveAttribute("data-smart-license-source-url", "https://example.test/license");
    await expect(image).toHaveAttribute("data-smart-license-type", "My Custom License");
    await expect(image).toHaveAttribute("data-smart-license-version", "2.1");
    await expect(image).toHaveAttribute("data-smart-license-attribution", "Jane Doe");
  });

  test("Cancel and Escape both discard changes without applying them", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
    await page.getByRole("button", { name: "Insert image" }).click();
    await chooseMedia(page);
    const image = surface.locator('[data-smart-type="block_image"]');

    await image.click({ button: "right" });
    const popover = page.locator('[data-srte-media-details-popover="true"]');
    await popover.locator('[data-srte-media-href-input]').fill("https://example.test/should-not-apply");
    await popover.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(popover).toHaveCount(0);
    await expect(image).not.toHaveAttribute("data-smart-href");

    await image.click({ button: "right" });
    await popover.locator('[data-srte-media-href-input]').fill("https://example.test/also-should-not-apply");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(image).not.toHaveAttribute("data-smart-href");
  });

  test("a library-sourced image (picked via search from an existing item) has its license metadata persisted, not discarded at insert time", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    const surface = page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');

    // First upload puts the fixture into the reference provider's library
    // (playground/src/App.tsx attaches deterministic license metadata for
    // this exact filename pattern, simulating a host whose MediaProvider
    // already has license data for a stored asset) - a fresh upload itself
    // has no license yet (MediaProvider.upload's own return type is only
    // {url, id}, correctly with no license field - there IS no license for
    // a brand-new upload). The real "library item with existing metadata"
    // case is picking an *already-stored* item back up via search, exactly
    // like a real host's library would work.
    await page.getByRole("button", { name: "Insert image" }).click();
    let picker = page.getByRole("dialog", { name: "Media library" });
    await picker.locator('input[type="file"]').setInputFiles({ name: "licensed-photo.png", mimeType: "image/png", buffer: Buffer.from("licensed-fixture") });
    await expect(picker).toHaveCount(0);
    // Delete the just-inserted image so a distinct second insert (via
    // search, not upload) is unambiguous to assert on.
    await surface.locator('[data-smart-type="block_image"]').click({ button: "right" });
    await expect(page.locator('[data-srte-media-details-popover="true"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await openToolbarDropdown(page, "More to insert");
    await toolbarMenuItem(page, "Delete selected media").click();
    await expect(surface.locator('[data-smart-type="block_image"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Insert image" }).click();
    picker = page.getByRole("dialog", { name: "Media library" });
    await picker.getByRole("button", { name: "Library", exact: true }).click();
    // The grid tile's own accessible name is empty (its <img> has no alt -
    // MediaManager.tsx: `alt={it.alt || ""}`, and this reference provider
    // never sets one) - locate via the tile's title attribute (its
    // non-interactive parent <div>, MediaManager.tsx's own `it.title ||
    // it.url`) instead. Search is debounced 300ms after the tab switch
    // (MediaManager.tsx's own useEffect); the tile is present once results
    // arrive, but the button itself collapses to 0x0 (a fake-byte test
    // fixture never decodes to a real image, and the button has no padding
    // besides that <img>) - a test-environment artifact, not a real
    // defect, so its onClick is dispatched directly rather than relying on
    // Playwright's coordinate-based click, which a genuinely zero-size
    // element has no valid point for at all (even with force:true).
    const tileButton = picker.locator('[title="licensed-photo.png"] button').first();
    await expect(tileButton).toHaveCount(1);
    await tileButton.dispatchEvent("click");
    await expect(picker).toHaveCount(0);

    const image = surface.locator('[data-smart-type="block_image"]');
    // CanonicalAuthorityEditor.tsx's selectFromMediaManager copies
    // item.license straight onto the inserted atom - confirmed directly on
    // the atom's own attributes, not just what the panel happens to show.
    await expect(image).toHaveAttribute("data-smart-license-attribution", "Jane Doe");
    await expect(image).toHaveAttribute("data-smart-license-type", "CC BY");
    await expect(image).toHaveAttribute("data-smart-license-source-url", "https://example.test/license");
    await expect(image).toHaveAttribute("data-smart-license-description", "A lovely test photo");

    await image.click({ button: "right" });
    const popover = page.locator('[data-srte-media-details-popover="true"]');
    await expect(popover.locator('[data-srte-media-license-attribution-input]')).toHaveValue("Jane Doe");
    await expect(popover.locator('[data-srte-media-license-type-select]')).toHaveValue("CC BY");
    await popover.getByRole("button", { name: "Cancel", exact: true }).click();
  });
});
