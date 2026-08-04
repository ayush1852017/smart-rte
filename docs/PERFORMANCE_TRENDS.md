# Canonical Editing Performance Trends

Input-to-paint at 10,000 mounted blocks is a standing per-phase metric. These
headless development-build measurements are trend indicators, not production
budgets. Record browser, sample count, median, p95, and worst sample in future
phases rather than reporting one favorable run.

| Phase | Chromium | Firefox | WebKit | Notes |
|---|---:|---:|---:|---|
| 2.5 | 18.1 ms | within frame in the recorded run | within frame in the recorded run | First end-to-end measurement. |
| 4 | 19.7 ms passing rerun; 20.5 ms observed first run | 10.0 ms | 17.0 ms | Chromium is at the assertion boundary; the single samples are too noisy for a regression estimate. |
| 5 | median 24.0 ms; p95/worst 41.9 ms | median 11.0 ms; p95/worst 14.0 ms | median 19.0 ms; p95/worst 25.0 ms | Five samples per browser. Chromium crossed both investigation thresholds for the first phase; Phase 6 must repeat the measurement before the two-successive-phase trigger fires. |

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
