# Smart RTE — conventions for coding agents

## Check `docs/bugs/` before investigating any reported bug

**Before investigating or fixing any reported bug, issue, or unexpected behaviour, check `docs/bugs/` first.**

Search for files whose title, symptom, or area matches the new report. If a matching or closely related file exists:

- If it's marked **Fixed**, check whether the current report is (a) a genuine regression of that fix, (b) a stale-build/environment artifact (see `docs/bugs/stale-dist-build-confusion.md` first), or (c) a different bug that merely looks similar. State explicitly which, before proceeding.
- If it's marked **Not a bug**, check whether the reported behaviour actually matches what was previously confirmed as correct — if so, this is very likely a misunderstanding or a UI-discoverability issue, not a defect, and should be investigated as such rather than re-litigated as a functional bug.
- If it's marked **Open**, this may be the same known gap resurfacing — connect the new report to it explicitly rather than starting a fresh investigation from zero.

After any bug is fixed (or confirmed not to be a bug), **create or update its file in `docs/bugs/`** following the format in `docs/bugs/README.md`, before considering the work done. A fix without an updated ledger entry is incomplete.

This rule exists because this project has repeatedly re-investigated the same or adjacent issues multiple times, and because at least one major source of false "still broken" reports (a stale build artifact) went undiagnosed for several rounds. The ledger is the mechanism for not repeating that.
