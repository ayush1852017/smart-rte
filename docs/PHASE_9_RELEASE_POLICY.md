# Phase 9 §2.6 — Semver, changelog, and publish policy

## Version

Both packages move from independent 0.x counters to a coordinated `1.0.0-beta.1`:

- `smartrte-core`: `0.2.1` → `1.0.0-beta.1`
- `smartrte-react`: `0.3.4` → `1.0.0-beta.1`

A major bump (not a minor/patch continuation of the 0.x line) is the correct call, not a stylistic one. Per Phase 9 §1.1's finding, **every version ever published to npm for either package (through 0.2.1 / 0.3.4) predates the canonical document model entirely** — those releases shipped the old DOM-authoritative editor. This release is the first to ship the canonical engine, `CanonicalAuthorityEditor` as the sole production editor, the framework-agnostic `packages/core`, the format-codec rewrite, and live KaTeX. Continuing the old 0.x counter would understate the change; every consumer's runtime behavior changes, not just internals. `-beta.1` reflects that this is genuinely new to real usage, not a repeat of a code path already exercised in production. `smartrte-react`'s `smartrte-core` dependency is declared as `workspace:^`, which pnpm resolves to the real published range at publish time — no manual pin needed.

## Changelog

Consolidated `1.0.0-beta.1` entries were added to both `packages/core/CHANGELOG.md` and `packages/react/CHANGELOG.md`, each with an explicit **BREAKING CHANGE** lead line. These summarize the cumulative, never-before-released state (the canonical model, format codecs, KaTeX, the public API surface cleanup from §2.5) rather than every internal phase gate — the many `docs/PHASE_*_COMPLETION_REPORT.md` files remain the detailed record of how each piece was built and verified; the changelog is the user-facing "what's different from what you have now" summary.

## Do not publish to `latest` until

This list is what stands between `1.0.0-beta.1` and a real `npm publish --tag latest`. It reflects genuine, previously-documented gaps carried forward from this session and earlier phases, not new criteria invented for this document.

1. **Phase 9 §3 (13 exit gates) verified and §4 (completion report) written.** Not yet done as of this document — the next items in this phase.
2. **The 29 e2e tests deferred at Phase 8b closeout are resolved or explicitly re-accepted.** `docs/PHASE_8B_FINAL_CLOSEOUT.md` retired 5 test files (30 tests) covering list/table/formatting/format-runtime/remaining workflows with only 1 confirmed duplicate; owner instruction was to track the other 29 as follow-up, prioritizing table Tab/Shift+Arrow navigation and undo-coalescing. That follow-up has not happened. Publishing to `latest` without it means shipping to real consumers with less verified e2e coverage than the pre-canonical editor had.
3. **Live KaTeX rendering gets a real browser visual check.** Phase 9 §2.4 shipped with 5 passing unit tests and a clean e2e suite, but the Chrome browser extension was not connected in this environment, so no one has actually looked at rendered math in a live browser this phase. Low risk given the unit coverage, but it's a `trust:false`/`strict:"error"` security-relevant surface and a first-time-ever live-rendering feature; worth a real look before default-on for every consumer.
4. **NVDA + Chrome manual accessibility validation**, flagged as outstanding across Phase 4 (mixed `aria-pressed`/toolbar), Phase 5 (block transforms), Phase 6 (table mode), and Phase 7 (atom announcements), and never closed. All four phases passed on axe + Safari/VoiceOver only. This is a repeated, explicitly-acknowledged gap, not an oversight being raised for the first time here.
5. **A native Windows Word clipboard capture**, flagged in Phase 8a as an owner-waived residual risk and explicitly named there as "a Phase 11/pre-production hardening item." The current paste-normalization fidelity for Word content is verified against macOS Word and a Mammoth-derived synthetic fixture, not a real Windows clipboard payload.

None of these block `-beta.1` itself — a pre-release channel exists precisely so real integration testing can happen against something installable before the above is fully closed. They block calling this **stable** and moving the npm `latest` tag to it.

## Publish mechanics (for whoever runs this for real)

- Publish both packages with `npm publish --tag beta` (or pnpm's equivalent), never `--tag latest`, until the criteria above are closed.
- This document does not publish anything — no `npm publish` was run as part of Phase 9 §2.6. Publishing is a real, external, hard-to-reverse action outside what an in-repo phase task should do unilaterally.
