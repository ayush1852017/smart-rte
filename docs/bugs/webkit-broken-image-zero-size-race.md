# WebKit renders a freshly-inserted (still-loading) image at 0x0 until its network request actually fails, racing immediate click/visibility assertions

**Status:** Fixed (two affected tests)
**Area:** test infra / browser (WebKit) / media e2e tests
**First reported:** 2026-09-07, while verifying the line-height feature's full e2e suite ([line-height-support](line-height-support.md)) - not a report about line-height itself; a pre-existing test race the line-height change's extra per-transaction work (a few more field checks inside `serializeCanonicalListHtml`, called from `onHtmlChange` after every transaction) pushed over the edge.
**Related files:** `packages/react/e2e/canonical-toolbar-routing.spec.ts`, `packages/react/e2e/media-details.spec.ts`, `packages/react/playground/src/App.tsx` (the reference `MediaProvider`).

## Symptom

Two WebKit-only e2e failures appeared in a full-suite run that were **not** among this project's previously-documented flakes ([webkit-full-suite-timeout-flake](webkit-full-suite-timeout-flake.md)):
- `canonical-toolbar-routing.spec.ts` › "routes lists, links, tables, atoms, resize, import, and export through retained state" - `expect(image).toBeVisible()` failed with `Received: hidden` after the full 5000ms retry budget.
- `media-details.spec.ts` › "sets link, radius, and align, applying real visible effects and a working Ctrl/Cmd+click" - `image.click({ button: "right" })` timed out after 30s, logging 50+ retries of "element is not visible".

Both inserted an image via the playground's reference `MediaProvider`, whose upload deliberately returns a fake `https://media.playground.test/...` URL with no real backend (`playground/src/App.tsx`'s own comment: "blob previews are intentionally transient only"). That domain reserved-TLD (`.test`, RFC 2606) never resolves, confirmed directly (`curl` in this sandbox: `Could not resolve host`).

## Root cause

Chromium/Firefox render a broken `<img>` (no explicit `width`/`height`, load failed) with a default nonzero "broken image" glyph box immediately. **WebKit renders it at a genuine 0x0 box** for as long as the image's load is still in flight, and only gives it a nonzero box once the network request has actually finished failing - confirmed directly via `getComputedStyle` inside the failing test (`width: "0px", height: "0px"`, `naturalWidth/Height: 0`, `complete: true` yet still 0x0) and by adding an explicit 2-second wait before the assertion, which made the box become nonzero and the test pass reliably.

This is a pre-existing, latent race in both tests: they call `image.click(...)`/`expect(image).toBeVisible()` **immediately** after the upload dialog closes, with no wait for the DNS failure to actually resolve. It happened not to be observed before because DNS-failure timing in this sandbox is fast enough, most of the time, to resolve within the assertion's own 5-second (or click's 30-second) internal retry budget. Reproduced and bisected empirically (reverting each changed file from the in-progress line-height work one at a time) to confirm the trigger: the line-height change added a few extra field reads inside `blockAttributes`/`parsedBlockAttrs` (`packages/core/src/foundation/list/formats.ts`), called on every transaction via `canonicalEditorRuntime.ts:224`'s `onHtmlChange(serializeCanonicalListHtml(...))` (which the playground always wires, per `App.tsx`'s `onHtmlChange={(html) => console.log(...)}`). This is genuinely trivial added work, not an algorithmic regression - but it was enough extra wall-clock cost across this test's many preceding operations (link, three list-type toggles, table, formula) to consistently push the image-insertion moment later relative to the fixed-size assertion window, changing whether the DNS failure had already resolved by the time the assertion started polling.

This is the same *family* of failure as [webkit-full-suite-timeout-flake](webkit-full-suite-timeout-flake.md) (a WebKit test racing real timing instead of an explicit readiness signal) but a **different root cause** (network-DNS-failure timing vs. React mount/focus timing) - not the same bug resurfacing.

## Fix

Neither test's own logic was ever wrong to assert visibility/clickability on a freshly-inserted image - the real bug is that image loading was left to a live, unmocked network call. `canonical-authority.spec.ts`'s own "uploads an image..." test had already established the right fix for this exact provider (`page.route("https://media.playground.test/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: onePixelPng }))`, serving a real 1x1 PNG) - applied here to the same two now-affected tests, each scoped to just that one test (not a blanket `beforeEach` for the whole file), since one *other* test in `media-details.spec.ts` ("shows resize handles on left-click...") genuinely depends on the browser's own broken-image glyph having a real multi-pixel size for its 8 resize handles to have room to render distinctly - mocking a 1x1 real image there broke that test in all three browsers (`toHaveCount(8)` / bounding-box-within-editor assertions), confirmed and reverted before landing the fix. The two tests that were fixed only ever assert attributes (`width="180"`, `border-radius:16px`, href/target) that are set explicitly via toolbar/popover actions, never the image's natural rendered size, so mocking is safe for them specifically.

## Regression coverage

- `canonical-toolbar-routing.spec.ts` › "routes lists, links, tables, atoms, resize, import, and export through retained state": WebKit, isolated, `--repeat-each=3`, 3/3 passed (previously failed reliably, 100% reproduction, with the line-height change applied and no mock).
- `media-details.spec.ts` › "sets link, radius, and align...": same, 3/3 passed.
- Full `canonical-toolbar-routing.spec.ts` + `media-details.spec.ts` run, all three browsers, 4 workers: 108/108 passed (including "shows resize handles on left-click...", confirming the narrow scoping didn't regress it).

## Related/similar issues

[webkit-full-suite-timeout-flake](webkit-full-suite-timeout-flake.md) - same general shape (a WebKit test racing implicit timing instead of an explicit signal), different specific cause; both point at the same underlying lesson for this codebase's WebKit e2e coverage: any test that depends on real network behavior (even a deliberately-fake, always-failing URL) needs to either mock the response or explicitly wait for the failure state, never assume a fixed assertion timeout is enough headroom.
