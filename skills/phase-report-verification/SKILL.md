---
name: phase-report-verification
description: Use this skill when producing any completion report, closeout report, or status update for a piece of work in this project — a phase, a bug fix, a scoping pass, or any deliverable someone else will make a decision from. Trigger any time you are about to write "done," "complete," "passing," or a gate/checklist result.
---

# Phase and Completion Report Standard

## The one rule underneath all of this

**Surface deviations and gaps rather than summarising favourably.** Every other rule below is an instance of this one. A report exists so the reader can make a correct decision without re-doing your work — that only holds if the report tells them what actually happened, including the parts that don't look good.

## Required shape

Unless told otherwise, structure a completion report as:

- **Verdict, up front.** Complete / Partial / Blocked, in one line, before any detail.
- **What was implemented**, described concretely (interfaces, file paths, actual code/config — not just prose summary).
- **Deviations from the original spec/plan**, each with: what was different, why, and the blast radius of reversing it later. Deviations are not failures to hide — they are information the reader needs.
- **Locked decisions** — anywhere the spec was ambiguous and a real call was made, state what was decided and why, so it doesn't get silently re-decided differently later.
- **Exit gate / checklist results**, gate by gate, with the actual evidence (test file, count, seed) — not just pass/fail. Property tests must disclose case count and seed; "a property test ran" without a count is not evidence.
- **Known gaps** — anything left incomplete, stubbed, deferred, or uncertain. Say so plainly, including things you're "not fully confident about."
- **Scope leakage check** — did anything outside the requested scope get touched? Name it, even if it seemed like a reasonable adjacent fix.

## The honesty rules that matter most in practice

1. **Never round a partial result up to a pass.** "253/258 passed, 5 stopped mid-run" is not "all tests passing." State the real number and whether the run was interrupted, not resumed and re-counted as clean.
2. **Report suite counts before *and* after, and name every removed test.** A test count going down is not automatically a problem — but it must always be explained (moved, superseded, coverage relocated) rather than left as an unexplained delta the reader has to notice themselves.
3. **A gate that wasn't actually checked is not "passed."** If a gate was satisfied "by inference" or "should be true given X," say that explicitly — do not report it in the same list, with the same visual weight, as a gate that was directly verified.
4. **When a fix reveals a bigger or different problem than expected, report the bigger problem — don't quietly narrow the scope to what was easy to fix and call the original item done.** If investigation shows the real issue is broader than the ticket, that finding is more valuable than a narrowly-satisfied checkbox.
5. **State what you did NOT do, as plainly as what you did.** "No implementation was attempted for X, per explicit scope" is a complete and useful sentence. Silence on an unaddressed item reads as either forgetting it or hoping no one asks.
6. **If something you built or fixed contradicts an earlier report (yours or someone else's), say so explicitly and reconcile it** — don't let two documents quietly disagree with no note connecting them.

## Calibrating findings you didn't go looking for

If you discover something outside the current task's scope while working (a second bug, a stale assumption, a gap in test coverage), report it — but keep it clearly separated from the task's own results, with your own assessed severity, not folded silently into the main narrative as if it were expected.

## What NOT to do

- Do not write a report that would let a reader believe something is more finished than it is, even if every individual sentence is technically true.
- Do not omit a negative finding because the overall verdict is otherwise positive.
- Do not present a hypothesis ("this is probably why") as a confirmed fact — mark it as reasoning versus verified evidence.