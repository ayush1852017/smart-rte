# Gate 13: atom corpus shows 5 of 7 scenarios diverging between retained and canonical — never previously reported in writing

**Status:** Needs re-verification — the divergences themselves are classified as non-semantic (`equivalent-serialization`/`expected-normalization`), but this metric does not appear to have been called out or reviewed in any prior written Gate 13/14 report, despite being emitted by the same replay run those reports are based on.
**Area:** atom / test infra (retained-vs-canonical replay)
**First reported:** 2026-08-12 (this re-audit — flagging that it existed unreported, not that it's new)

## Symptom

The same replay harness that produces the "42 comparable intents" table also emits a separate `atomCorpus` result: of 7 atom scenarios compared between retained and canonical, only 2 are fully equivalent. The other 5 diverge — 3 classified `equivalent-serialization`, 2 classified `expected-normalization`.

## Reproduction

Automated: `pnpm --filter smartrte-react exec playwright test e2e/canonical-authority.spec.ts -g "retained/canonical command replay"`, read the `gate-13-browser-replay` test annotation's `atomCorpus` field. Confirmed identical across all three browsers in the 2026-08-12 re-audit: `{"scenarios":7,"equivalent":2,"divergences":{"equivalent-serialization":3,"expected-normalization":2}}`.

**Not yet done:** identifying *which* of the 7 atom scenarios are the 5 divergent ones, or whether this ratio (5/7 diverging) has been stable or changed over time — no prior written report discusses this metric at all, so there's no historical baseline to compare against.

## Root cause

Not investigated. The classifications themselves (`equivalent-serialization`, `expected-normalization`) suggest non-semantic differences of the same general kind as the main 11-intent table, but this hasn't been confirmed by actually reading the per-scenario diffs.

## Fix

None — not attempted in this pass.

## Regression coverage

The replay harness itself, same as the other Gate 13 files — but note this specific metric isn't asserted on (`expect(result.listCorpus.divergences).toEqual({})` exists in the test; no equivalent hard assertion was found for `atomCorpus` divergences during this audit, meaning a regression here could currently pass CI silently).

## Related/similar issues

- [gate13-block-quote-code-selection-mapping-difference](gate13-block-quote-code-selection-mapping-difference.md), [gate13-table-normalization-differences](gate13-table-normalization-differences.md), [gate13-list-command-selection-and-style-differences](gate13-list-command-selection-and-style-differences.md) — the other Gate 13 clusters, all of which at least have some written history; this one has none.
- **Recommendation, not yet actioned**: before the promotion decision, someone should identify which 5 of 7 atom scenarios diverge and get them classified/reviewed the same way the 11 main intents were, since "never reviewed" is a weaker state than "reviewed and accepted."
