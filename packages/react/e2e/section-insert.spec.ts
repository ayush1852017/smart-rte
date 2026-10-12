import { expect, test, type Page } from "@playwright/test";

/**
 * Section-aware host insertion (1.3.0): a host panel inserts a figure at the
 * end of a named section when the user never placed the caret there, and
 * can tell a user-placed caret from the editor's default one.
 */
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Section = { headingId: string; text: string };
type RuntimeWindow = Window & {
  __smartProductCanonical?: {
    insertImage: (input: Record<string, unknown>, opts?: Record<string, unknown>) => { ok: boolean; reason?: string };
    listSections: () => Section[];
    hasUserCaret: () => boolean;
    getSectionContext: () => { heading: { text: string } | null; caretSetByUser: boolean };
  };
  loadRawHtml?: (html: string) => void;
};

const surface = (page: Page) => page.locator('[data-smart-authority="canonical"] [contenteditable="true"]');
const order = (page: Page) => surface(page).evaluate((root) => [...root.children]
  .map((child) => child.getAttribute("data-smart-type") === "block_image" ? "IMG"
    : child.getAttribute("data-smart-projection") ? null : child.textContent?.trim() || null)
  .filter(Boolean));

const load = async (page: Page, html: string) => {
  await page.goto("/?canonicalAuthority=1&blocks=1");
  await expect(surface(page)).toBeVisible();
  await page.evaluate((value) => (window as RuntimeWindow).loadRawHtml!(value), html);
};

test.describe("section-aware insertion", () => {
  test("inserts at the end of a section without the user clicking into the editor", async ({ page }) => {
    await load(page, "<p>Intro</p><h2>Methods</h2><p>We measured.</p><h3>Setup</h3><p>Rig.</p><h2>Results</h2><p>It worked.</p>");
    // The playground focuses the editor on load; a host panel then takes focus.
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "host-panel";
      document.body.appendChild(input);
      input.focus();
    });
    const result = await page.evaluate((src) => {
      const editor = (window as RuntimeWindow).__smartProductCanonical!;
      const methods = editor.listSections().find((section) => section.text === "Methods")!;
      return { userCaret: editor.hasUserCaret(), insert: editor.insertImage({ src, alt: "Chart", caption: "Figure 2" }, { position: { sectionEnd: methods.headingId } }) };
    }, PIXEL);
    expect(result.userCaret).toBe(false);
    expect(result.insert).toEqual({ ok: true, nodeId: expect.any(String) });
    // Right before the next heading of the same level - not at the top, where the default caret is.
    await expect.poll(() => order(page)).toEqual(["Intro", "Methods", "We measured.", "Setup", "Rig.", "IMG", "Results", "It worked."]);
    await expect(surface(page).locator('[data-smart-projection="image-caption"]')).toHaveText("Figure 2");
    await expect(page.locator("#host-panel")).toBeFocused();
  });

  test("hasUserCaret turns true when the user clicks into the editor, and getSectionContext reports it", async ({ page }) => {
    await load(page, "<h2>Methods</h2><p>We measured.</p><h2>Results</h2><p>It worked.</p>");
    const read = () => page.evaluate(() => {
      const editor = (window as RuntimeWindow).__smartProductCanonical!;
      const context = editor.getSectionContext();
      return { userCaret: editor.hasUserCaret(), heading: context.heading?.text ?? null, caretSetByUser: context.caretSetByUser };
    });
    expect(await read()).toEqual({ userCaret: false, heading: "Methods", caretSetByUser: false });
    await surface(page).getByText("It worked.").click();
    await expect.poll(read).toEqual({ userCaret: true, heading: "Results", caretSetByUser: true });
    // Reloading content resets it.
    await page.evaluate(() => (window as RuntimeWindow).loadRawHtml!("<h2>Fresh</h2><p>Doc</p>"));
    expect((await read()).userCaret).toBe(false);
  });
});
