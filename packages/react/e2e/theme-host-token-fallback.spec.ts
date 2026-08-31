import { expect, test } from "@playwright/test";
import { openToolbarDropdown, toolbarMenuItem } from "./toolbarHelpers.js";

/**
 * docs/bugs/srte-surface-subtle-not-host-theme-aware.md
 *
 * Every neutral --srte-* token (background, foreground, muted, border) is
 * defined as var(--host-token, fallback) so the editor correctly follows a
 * *host's own* light/dark CSS variables even if .srte-dark never gets
 * applied to this specific editor instance for some host-side wiring
 * reason. --srte-surface-subtle (blockquote/table-header background) and
 * --srte-modal-bg/--srte-modal-text (MediaManager, comments, suggestions,
 * version history panels) were bare hardcoded hex values with no such
 * fallback - the one gap in an otherwise consistent pattern. Reported live:
 * a real host had html.dark set (and its own --card/--foreground/--muted
 * correctly dark), but .srte-dark wasn't reaching the editor - blockquote
 * text (which used the host-aware --srte-foreground) came out dark-mode
 * correct, while its background (--srte-surface-subtle, no host awareness)
 * stayed at its light default, producing near-white text on a light-gray
 * box.
 */
test.describe("theme tokens follow a host's own dark mode, even without .srte-dark", () => {
  const installHostDarkTokens = async (page: import("@playwright/test").Page) => {
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      const style = document.createElement("style");
      style.textContent = `
        :root { --card: #ffffff; --foreground: #0f172a; --muted: #f1f5f9; --border: #e2e8f0; }
        .dark { --card: #1e293b; --foreground: #f8fafc; --muted: #334155; --border: #334155; }
      `;
      document.head.appendChild(style);
    });
  };

  test("blockquote background and text both resolve to the host's dark tokens, not a light default, even with .srte-dark absent", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.waitForSelector(".srte-toolbar");
    await installHostDarkTokens(page);

    const editable = page.locator(".srte-editor[contenteditable]");
    await editable.click();
    await page.getByRole("button", { name: "Quote" }).click();
    await page.keyboard.type("A dark-mode-readable blockquote.");

    const info = await page.evaluate(() => {
      const bq = document.querySelector('[contenteditable="true"] blockquote')!;
      const cs = getComputedStyle(bq);
      return {
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        hasSrteDarkClass: document.querySelector(".srte-editor")?.classList.contains("srte-dark") ?? false,
      };
    });

    expect(info.hasSrteDarkClass).toBe(false);
    // The host's dark --muted (#334155) and --foreground (#f8fafc) - not the
    // package's own hardcoded light defaults (#f3f4f6 background / a dark
    // text color that would be unreadable against it).
    expect(info.backgroundColor).toBe("rgb(51, 65, 85)");
    expect(info.color).toBe("rgb(248, 250, 252)");
  });

  test("table header background follows the same host-token fallback", async ({ page }) => {
    await page.goto("/?canonicalAuthority=1&blocks=1");
    await page.waitForSelector(".srte-toolbar");
    await installHostDarkTokens(page);

    await page.getByRole("button", { name: "Insert table", exact: true }).click();
    await page.locator('[data-srte-table-size-cell="2x2"]').click();
    await openToolbarDropdown(page, "Table tools");
    await toolbarMenuItem(page, "Header row").click();

    const backgroundColor = await page.evaluate(() => {
      const th = document.querySelector('[contenteditable="true"] th')!;
      return getComputedStyle(th).backgroundColor;
    });
    expect(backgroundColor).toBe("rgb(51, 65, 85)");
  });
});
