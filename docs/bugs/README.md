# Bug ledger

One markdown file per distinct bug/issue/wrong-behaviour ever encountered in this project. This is the permanent, canonical record of "what has already gone wrong and how it was resolved." See the standing rule in `CLAUDE.md` — it must be consulted before investigating any new report, and updated after every fix.

This folder is a reference, not a narrative — optimize for "someone skims this in 30 seconds and knows whether their new bug matches something here," not for readability as prose.

## File naming

One file per issue: `docs/bugs/<kebab-case-short-name>.md`. Short, descriptive, greppable.

## Format

```md
# <Title: short description of the symptom>

**Status:** Fixed | Not a bug (working as designed) | Open | Needs re-verification
**Area:** <list / table / block / mark / atom / clipboard / renderer / selection / toolbar / etc.>
**First reported:** <date, or "unknown — backfilled">
**Related files:** <one-line pointer to the closest prior report doc, if one exists>

## Symptom

What was observed, from the reporter's perspective. Plain description, not a diagnosis.

## Reproduction

Exact steps, as specific as what was actually used to confirm it. If multiple reproduction shapes were tried (including ones that did NOT reproduce it), list those too — that's often as valuable as the one that worked.

## Root cause

The actual underlying cause, at whatever layer it was found. Not the symptom; the cause. If a hypothesis was tested and rejected before the real cause was found, note that too.

## Fix

What changed, and where (file paths, function/module names). If the fix was "not a bug, this is correct behaviour," say that explicitly instead of forcing a "fix" section to exist.

## Regression coverage

What test(s) now guard against this recurring — file and test name if known. If none exist yet, say so explicitly.

## Related/similar issues

Link to other files in this folder that share a root cause, a layer, or a symptom family, even if they turned out to be unrelated on investigation — false-positive connections are worth recording so they aren't re-suspected from scratch next time.
```

## When a bug's status changes across multiple reports

Some issues in this project were fixed, then found still broken (or found to be a stale-build artifact rather than a real regression), then fixed again. When backfilling or updating a file like this, capture the **full arc** in Status/Root cause/Fix — not just the final state. A bug marked "Fixed" after initially being marked "could not reproduce" should say so; that pattern is exactly what this ledger exists to catch faster next time.
