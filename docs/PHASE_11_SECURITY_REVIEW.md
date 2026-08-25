# Phase 11 security review + live CVE check

**Date:** 2026-08-19. First `pnpm audit` ever run against this repo's resolved dependency tree (confirmed — no prior audit output exists anywhere in `docs/`).

## 1. `pnpm audit` results

**43 advisories found** (1 low, 13 moderate, 27 high, 1 critical) before any fix; **42 remain** (1 low, 13 moderate, 26 high, 1 critical) after item 2 below.

**Triage method:** for each advisory, traced its dependency path back to determine whether it reaches a package actually shipped in `smartrte-core`/`smartrte-react`'s published `dependencies`, versus only reachable through `devDependencies` (vitest, eslint, storybook) or the unpublished `packages/react/playground` app.

### 1.1 — Real, shipped-dependency finding: fixed

`underscore@1.13.7` (CVE-2026-27601, high severity, unlimited recursion in `_.flatten`/`_.isEqual` — a stack-overflow DoS, structurally the same class of bug as the mammoth recursion issues already investigated in Phase 9), reached via `packages/core > mammoth@1.11.0 > underscore@1.13.7` and the same chain in `packages/react` — **a real runtime dependency path**, not dev-only, since `mammoth` is a genuine `dependencies` entry (DOCX import) in both packages.

**Fixed**: added `"underscore": "^1.13.8"` to the root `package.json`'s `pnpm.overrides` (alongside the existing `@xmldom/xmldom` override, same established pattern for pinning a vulnerable transitive dependency of `mammoth`). Confirmed via `pnpm why underscore` that all three resolution paths (`mammoth`, `mammoth > lop`, `mammoth > lop > duck`) now resolve to `1.13.8`. Patch-level bump per the advisory's own compatibility note ("upgrading from 1.9+ to any later 1.x should be feasible with little or no effort"); core suite re-run clean (595/595) after the bump.

### 1.2 — Everything else: dev-tooling-only, not shipped

The remaining 42 advisories (vitest, storybook, vite, esbuild, rollup, postcss, eslint/typescript-eslint's minimatch/js-yaml/ajv/brace-expansion/picomatch/flatted chains, ws, uuid, nanoid, @babel/core) all resolve exclusively through `devDependencies` or `packages/react/playground` (an unpublished internal dev app) — none appear in `smartrte-core` or `smartrte-react`'s published `dependencies`. Explicitly checked the one path that looked like it might be an exception (`packages/react > jsdom@25.0.1 > ws@8.18.3`) — `jsdom` is a `devDependencies` entry (`packages/react/package.json:72`, used only for the vitest DOM test environment), not shipped.

The one **critical** advisory (`vitest`: arbitrary file read when the Vitest UI server is exposed to the network) was checked for reachability regardless, since "critical" warrants it even in dev tooling: both packages' `test` scripts run `vitest run` (`core/package.json:42`) and `vitest run --passWithNoTests` (`react/package.json:49`) — plain CLI runs, never `--ui` or `--api.host`. Not exploitable in how this repo actually runs its tests.

**Not fixed in this pass, and not recommended to force now**: bumping the dev toolchain (storybook 8→9, eslint/typescript-eslint majors, vite majors) to clear the remaining advisories is a real but separate maintenance task with its own compatibility risk, disconnected from anything a published-package consumer is exposed to. Recommend tracking it as ordinary dependency maintenance, not urgent security work.

## 2. Mammoth revisit trigger re-check

`docs/PHASE_9_MAMMOTH_FINAL_DECISION.md:47` named an explicit revisit trigger: *"before Phase 11's security review if one is planned... has anything changed about mammoth's reachable surface, has a new candidate been found through routine use or further investigation."* This is that check.

**Re-verified, not re-investigated from scratch:**
- `git log` confirms the final-decision document itself was committed in the same commit (`477a135`) as the last mammoth-touching fix (`findLevel`'s iterative conversion) — the most recent commit touching any DOCX/mammoth code in this repo's history. Nothing in the DOCX import surface (`packages/core/src/foundation/formats/docx/`) has changed since that decision was recorded.
- Answer to the trigger's own question: **no** — mammoth's reachable surface is unchanged since Phase 9's investigation closed it. The accepted-risk position recorded there (2 root-fixed, 9 guard-covered-and-confirmed-structural, 1 unreachable, 0 known live gaps) still holds.
- **New, unrelated to the prior investigation**: `mammoth@1.11.0` is not the latest upstream release (`1.12.1` is, per `npm view mammoth versions`). Not acted on in this pass — a version bump would require re-running the entire recursion-guard analysis against the new release's source (the existing `patches/mammoth@1.11.0.patch` and `nestingGuard.ts`'s structural-coverage argument are both pinned to 1.11.0's exact internals) and re-verifying the patch still applies. Flagged as a deliberate, separately-scoped follow-up, per the final-decision document's own reasoning against unscoped changes made "under no active pressure."

**Conclusion: no reopening of the mammoth investigation is warranted.** The revisit trigger fired (Phase 11's security review happened), was checked, and confirms the prior decision still holds.

## 3. Recommendations for future passes

- Track a dependency-maintenance pass for the dev toolchain (storybook/eslint/vite majors) separately from security work — real advisories, zero shipped-package exposure, ordinary upkeep.
- When `mammoth` is next deliberately upgraded (not in this pass), re-run the recursion-guard analysis against the new version before adopting it, not just diff the changelog.
- Re-run `pnpm audit` as a standing step before any `latest`-tag publish, per `docs/PHASE_9_RELEASE_POLICY.md`'s existing criterion — this review establishes the baseline, not a one-time check.
