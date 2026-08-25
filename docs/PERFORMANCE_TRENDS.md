# Canonical Editing Performance Trends

Input-to-paint at 10,000 mounted blocks is a standing per-phase metric. These
headless development-build measurements are trend indicators, not production
budgets. Record browser, sample count, median, p95, and worst sample in future
phases rather than reporting one favorable run.

Phase 8b's same-browser production/standalone flame-chart investigation is
recorded in `PHASE8B_PERFORMANCE_PROFILE.md`. It found synchronous full-state
cloning and clean-HTML serialization in the product wrapper, not renderer or CSS
work. After correction the 10,000-block Chromium surfaces converged to roughly
18–20 ms standalone versus 19–21 ms production in the isolated profile.

| Phase | Chromium | Firefox | WebKit | Notes |
|---|---:|---:|---:|---|
| 2.5 | 18.1 ms | within frame in the recorded run | within frame in the recorded run | First end-to-end measurement. |
| 4 | 19.7 ms passing rerun; 20.5 ms observed first run | 10.0 ms | 17.0 ms | Chromium is at the assertion boundary; the single samples are too noisy for a regression estimate. |
| 5 | median 24.0 ms; p95/worst 41.9 ms | median 11.0 ms; p95/worst 14.0 ms | median 19.0 ms; p95/worst 25.0 ms | Five samples per browser. Chromium crossed both investigation thresholds for the first phase; Phase 6 must repeat the measurement before the two-successive-phase trigger fires. |
| 6 pre-work (10k) | median 21.7 ms; p95/worst 36.5 ms | median 11.0 ms; p95/worst 13.0 ms | median 17.0 ms; p95/worst 23.0 ms | Standalone five-sample baseline before table work. Chromium crosses the median threshold for the second phase, so the Phase 11 `content-visibility` investigation is now pulled forward for scheduling; the model/table work must not be blamed without a headed trace. |
| 6 final (10k) | median 22.3 ms; p95/worst 39.6 ms | median 23.0 ms; p95/worst 38.0 ms | median 21.0 ms; p95/worst 38.0 ms | Five samples from the final full-suite run. All engines show contention/noise; Chromium remains over the two-phase trigger and requires a headed trace rather than attribution to model work. |
| 7 isolated (10k) | median 24.6 ms; p95/worst 40.7 ms | median 13.0 ms; p95/worst 25.0 ms | median 27.0 ms; p95/worst 32.0 ms | Five samples per browser with only the nine performance cases running. The 10k mounted-DOM tail remains over the investigation threshold; Phase 7 model/atom work does not explain the cold-start-dominated spread. |

## Phase 6 pre-work: 2,000 blocks

| Browser | Raw samples (ms) | Median | p95 | Worst |
|---|---|---:|---:|---:|
| Chromium | 24.8, 5.0, 6.2, 4.3, 13.9 | 6.2 | 24.8 | 24.8 |
| Firefox | 6, 3, 3, 3, 4 | 3.0 | 6.0 | 6.0 |
| WebKit | 12, 5, 5, 6, 5 | 5.0 | 12.0 | 12.0 |

The representative 2,000-block median is comfortably below the 18 ms concern
line. The Chromium issue remains concentrated in the extreme 10,000-mounted-
block case. Schedule the now-triggered headed `content-visibility` trace, but
do not block table model work on it.

Product-owner manual smoke on 2026-08-03 confirmed that selection, insertion,
deletion, undo, and redo remained responsive at `?canonical=1&blocks=10000` on
the available macOS/Safari environment. No manual latency number was captured.

Starting in Phase 5, run at least five samples per browser and report median,
p95, and worst. Bring the deferred `content-visibility` investigation forward
from Phase 11 if Chromium's median exceeds 20 ms or p95 reaches 24 ms in two
successive phases. Do not attribute the delta to model work without a trace;
Phase 2.5 already showed model apply/resolution below 1 ms.

Phase 5 raw samples (ms): Chromium `41.9, 24.0, 23.1, 28.8, 19.5`;
Firefox `14, 11, 12, 10, 10`; WebKit `25, 23, 19, 18, 17`. These are
headless development-build measurements and include timer/rAF quantization.

## Phase 6 final series

| Fixture | Browser | Raw samples (ms) | Median | p95 | Worst |
|---|---|---|---:|---:|---:|
| 2,000 blocks | Chromium | 15.1, 9.6, 4.1, 14.6, 4.3 | 9.6 | 15.1 | 15.1 |
| 2,000 blocks | Firefox | 8, 4, 4, 4, 6 | 4 | 8 | 8 |
| 2,000 blocks | WebKit | 19, 12, 5, 6, 5 | 6 | 19 | 19 |
| 10,000 blocks | Chromium | 39.6, 21.4, 22.3, 28.4, 19.7 | 22.3 | 39.6 | 39.6 |
| 10,000 blocks | Firefox | 31, 20, 23, 38, 23 | 23 | 38 | 38 |
| 10,000 blocks | WebKit | 38, 23, 20, 21, 20 | 21 | 38 | 38 |
| 50×50 table | Chromium | 35, 13.7, 13.4, 13, 12.7 | 13.4 | 35 | 35 |
| 50×50 table | Firefox | 11, 11, 13, 14, 11 | 11 | 14 | 14 |
| 50×50 table | WebKit | 17, 9, 10, 11, 9 | 10 | 17 | 17 |

The first 50×50 implementation measured roughly 84–169 ms median because the renderer recomputed all header associations after every text edit. Restricting that synchronization to structural/span/header changes reduced the final medians to 10–13.4 ms. Chromium's first sample remains a cold-start outlier; the steady samples are 12.7–13.7 ms.

## Phase 7 isolated series

| Fixture | Browser | Raw samples (ms) | Median | p95 | Worst |
|---|---|---|---:|---:|---:|
| 2,000 blocks | Chromium | 28.6, 5.2, 14.5, 5.0, 14.7 | 14.5 | 28.6 | 28.6 |
| 2,000 blocks | Firefox | 12, 6, 5, 5, 5 | 5 | 12 | 12 |
| 2,000 blocks | WebKit | 33, 7, 7, 6, 6 | 7 | 33 | 33 |
| 10,000 blocks | Chromium | 40.7, 23.6, 31.0, 24.6, 22.8 | 24.6 | 40.7 | 40.7 |
| 10,000 blocks | Firefox | 25, 13, 14, 13, 13 | 13 | 25 | 25 |
| 10,000 blocks | WebKit | 32, 30, 27, 23, 23 | 27 | 32 | 32 |
| 50×50 table | Chromium | 50.4, 13.9, 18.2, 13.3, 13.1 | 13.9 | 50.4 | 50.4 |
| 50×50 table | Firefox | 7, 6, 7, 5, 4 | 6 | 7 | 7 |
| 50×50 table | WebKit | 37, 7, 7, 8, 12 | 8 | 37 | 37 |

The 2,000-block medians remain materially below the 10,000-block tail, though
Chromium's 14.5 ms median is higher than Phase 6's 9.6 ms run. Cold first samples
dominate p95 for Chromium and WebKit. The already-triggered headed
`content-visibility` trace remains the correct next diagnostic; these headless
development measurements do not justify attributing the cost to atom commands.

## Phase 11 Tier 3 — renderer-integrated content-visibility, benchmarked and rejected

Per `docs/PHASE_ROADMAP_8B_12B.md`'s instruction ("any design here must be renderer-aware or the idea is dropped"), a design keyed off `surface/renderer.ts`'s existing reference-identity diff (`syncContentVisibility`) was built and benchmarked, not just proposed: a top-level block only gets `content-visibility: auto` when the renderer's own diff already proved it untouched *this* render pass, and never when it's the actively-selected block — correctly avoiding the naive experiment's flaw of stamping the containment cost onto the block being typed into on every keystroke.

**Result: still does not beat baseline**, measured via `packages/react/e2e/canonical-authority.spec.ts`'s "benchmarks the renderer-integrated content-visibility design against production" (Chromium, headed, 10,000 blocks, same 5-sample typing-latency harness as the tables above), comparing a production runtime (no content-visibility) against a second runtime instance with the option enabled, both mounted from the same synthetic document:

| | Sample 1 (cold) | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Baseline (off) | 36.6 | 33.6 | 26.8 | 24.3 | 25.8 |
| Renderer-integrated (on) | 1156.8 | 52.9 | 45.7 | 39.5 | 37.9 |

The first sample's ~1.15s spike is the cost of the initial `content-visibility`/`contain-intrinsic-block-size` write across ~9,999 elements on first mount. Steady-state samples (37.9–52.9ms) are still 40–90% slower than baseline (24.3–36.6ms) even with the active block correctly excluded — the CSS containment machinery's own per-render bookkeeping cost exceeds its off-screen-skip benefit for this editor's actual render path, not just for the naive blanket version. This confirms Phase 8b's original disproof was not an artifact of the naive implementation's specific mistake (touching the active block); a more careful, genuinely renderer-aware version has the same result.

**Disposition:** not adopted. The implementation (`surface/renderer.ts`'s `syncContentVisibility`, `CanonicalEditorRuntimeOptions.contentVisibility`) is real, tested, and kept in the codebase as opt-in and default-`false` — zero behavior change for every existing caller — both as the documented record of this investigation and in case a future renderer architecture change (e.g. genuine virtualization) revisits the question under different conditions. It is not enabled anywhere in the shipped product.
