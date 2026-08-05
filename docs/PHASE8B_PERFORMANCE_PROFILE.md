# Phase 8b production/standalone performance profile

Date: 2026-08-05. Browser: Chromium. Fixture: 10,000 canonical paragraph
blocks. Both surfaces received the same synthetic `beforeinput(insertText)` path,
ten times, with one animation frame observed after each input. The opt-in
Playwright profiler at `e2e/canonical-performance-profile.spec.ts` emits Chrome
`.cpuprofile` artifacts and metric summaries when run with `SRTE_PROFILE=1`.

## Finding

The production delta was JavaScript orchestration, not layout, React rendering,
CSS, or the canonical renderer:

- `FoundationEditor.subscribe` cloned the complete 10,000-block state for every
  committed transaction. `get state` accounted for roughly 9–18 ms per input.
- `ClassicEditorAuthority` immediately called `runtime.getValue()` on every
  change, causing another complete state clone solely to prepare rollback.
- The transitional `onHtmlChange` path serialized all 10,000 blocks
  synchronously inside the input frame.
- Layout totals across ten inputs were similar: standalone 31.7 ms and product
  38.0 ms. No React render appeared among the hot functions.

Before correction, steady standalone samples were about 18–20 ms while product
samples were about 42–47 ms. Disabling only the HTML callback reduced product
samples to about 28–31 ms, confirming that both the state clone and serialization
were material.

## Correction

- Commit listeners now receive the canonical readonly document reference. The
  public `editor.state` snapshot remains cloned.
- The rollback envelope is captured once at the authority boundary, rather than
  once per edit.
- Transitional clean-HTML callbacks are coalesced with a 250 ms idle-after-input
  debounce. Canonical `onChange` remains synchronous per committed transaction.

After correction, standalone steady samples were 18–20 ms and production was
19–21 ms. Script totals over ten inputs converged from 102.3/339.7 ms
(standalone/product) to 102.3/105.8 ms. The remaining difference is measurement
noise plus the product wrapper's small selection/layout overhead, not a 2–3×
architectural delta.

The earlier child-level `content-visibility` experiment is not a remedy: it made
the 10,000-block case worse. No virtualization or CSS containment change is
warranted by this profile.
