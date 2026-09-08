# A test's `getByRole` query occasionally resolves to zero elements immediately after a toolbar dropdown opens, even though the element is genuinely present

**Status:** Fixed
**Area:** react (e2e test only - `canonical-authority.spec.ts`; no product code involved)
**First reported:** 2026-09-08, surfaced while verifying an unrelated feature (list-preset toggle behavior) - the full e2e suite showed "applies every exposed list preset through toolbar routing" failing, in a way that reproduced deterministically once triggered, unlike the project's other known flakes.
**Related files:** none - a new, distinct flake class from the already-documented `webkit-full-suite-timeout-flake.md`/`webkit-broken-image-zero-size-race.md` (both WebKit-specific network/DOM-size races); this one reproduced in Chromium and has nothing to do with either.

## Investigation

Bisected carefully before concluding this was pre-existing: reverted every uncommitted change (via `git stash`, confirmed back to the exact last commit) and rebuilt/restarted the dev server (including clearing Vite's dependency cache) - the failure **still reproduced** on the clean, committed codebase. This ruled out every in-progress change as the cause and confirmed a genuine, pre-existing test fragility, not a regression.

Root-caused by direct measurement: right after `openToolbarDropdown` clicks a `<details>`'s `<summary>` (firing its `toggle` event), the test immediately calls `page.getByRole("combobox", { name: "List preset" }).locator("option").evaluateAll(...)` - a **read**, not a Playwright "action." Confirmed directly that a raw CSS locator (`page.locator('select[aria-label="List preset"]')`) found the element immediately, not disabled, with all 13 options - but the role-based query resolved to zero elements. Adding a bare 500ms wait before the role query made it resolve correctly. This means Chromium's accessibility-tree computation (which `getByRole` depends on) can lag a tick behind the DOM/CSS state the `toggle` event already produced - `.count()`/`.evaluateAll()` resolve once against whatever the accessibility tree currently reports and never retry, unlike Playwright's own auto-retrying assertions (`expect(locator).toBeVisible()`) or actions (`.click()`, `.selectOption()`).

This explains why only this one test (of several using the exact same `<select>`) was affected: it's the only one in this suite that reads from the role-based locator with a non-retrying method immediately after opening the dropdown, rather than performing a retrying action/assertion first.

## Fix

Added `await expect(listPresetCombobox).toBeVisible();` immediately after opening the dropdown, before the non-retrying `.evaluateAll()` read - `toBeVisible()` auto-retries until the accessibility tree actually reports the element, giving the same robustness the other tests already had incidentally (by virtue of using `.selectOption()`, an auto-retrying action, as their first interaction instead of a bare read).

## Regression coverage

`applies every exposed list preset through toolbar routing`: 3/3 passed on repeated runs after the fix, on a build where it had failed deterministically (3/3) beforehand. No product code touched - this is a test-only hardening fix.

## Related/similar issues

[webkit-full-suite-timeout-flake](webkit-full-suite-timeout-flake.md) - same general lesson (a test racing implicit browser-internal timing instead of an explicit readiness signal) but a different browser (Chromium, not WebKit) and a different underlying mechanism (accessibility-tree computation lag, not DOM size or network timing) - filed separately rather than folded in, since the fix and root cause don't generalize to each other.
