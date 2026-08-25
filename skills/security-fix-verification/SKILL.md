---
name: security-fix-verification
description: Use this skill whenever fixing, reviewing, or claiming to close a security vulnerability, data-integrity bug, or any defect where silent/incomplete failure is possible (crashes, data loss, injection, DoS, unguarded recursion, unvalidated input). Trigger on any work touching dependency vulnerabilities, sanitization, parsing untrusted input, or a `docs/bugs/` entry tagged security or data-loss.
---

# Security and Data-Integrity Fix Verification

## The rule

**A fix verified only against unit tests, an isolated function call, or a linter/audit tool passing is not verified.** It must be proven against the real attack, through the real production entry point, using a real crafted malicious input — not a synthetic proxy for one.

This is not caution for its own sake. It is a project-proven pattern: in one investigation (Smart RTE's mammoth/xmldom DoS chain, 2026-08-13 to 2026-08-18), this exact gap — a fix that passed every unit test and looked clean at the isolated-function level — silently failed to stop the real attack, **three separate times in a row**. Each time, the only thing that caught it was re-running the actual disclosed proof-of-concept through the actual production call path.

## What "verified" means, concretely

For any security or data-integrity fix, before calling it done:

1. **Reproduce the original failure first**, with a real malicious/pathological input (a crafted file, a deeply nested payload, an actual injection string) — not a description of what the input would look like. Confirm it actually fails on the pre-fix code.
2. **Apply the fix.**
3. **Re-run the exact same malicious input through the exact same production entry point** the real user/attacker would hit — not a lower-level function, not an isolated library call, not a mocked path. If the entry point is `importDocxDocumentWithMammoth(buffer)`, the verification calls that function, not `xmldom.parseFromString()` directly.
4. **Confirm the failure no longer occurs, and state what happens instead** (clean rejection, safe fallback, graceful degradation) — not just "no longer crashes."
5. **Only then** do unit tests, linters, and dependency audits serve their proper role: as regression guards for *future* changes, not as the proof the fix works *now*.

Skipping step 3 and stopping at step 2/5 is the single most common way a security fix looks complete and isn't.

## Signs you're about to make this mistake

- "The test suite passes" is your last verification step, with no separate real-attack replay.
- You fixed the layer where the bug was *found* (e.g., a dependency's own function) without checking whether the *calling code* still reaches a pathological case a different way.
- A dependency audit tool reports zero findings, and you treat that as sufficient — audits catch known, disclosed issues; they do not catch every reachable defect, especially ones the tool doesn't have a signature for (e.g., a library's own hand-written unguarded recursion, as opposed to a CVE in a transitive dependency).
- You're relying on "this should fix it" reasoning about *why* the fix works, without empirically re-attacking to confirm.

## After a fix is confirmed: check for siblings, don't assume you found the only instance

If a fix closes one instance of a bug class (e.g., one unguarded recursive function), explicitly ask: **is this pattern likely to exist elsewhere in the same codebase or dependency?** A single instance found once is often not the only instance — audit for other candidates matching the same shape before declaring the whole surface safe. If a full audit isn't warranted, say so explicitly and record why, rather than silently assuming completeness.

## Reporting standard

When reporting a security/data-integrity fix as closed, state explicitly:
- What the real attack/input was.
- That it was re-run against the real entry point post-fix.
- What happened (not just "no longer fails").
- Whether you checked for sibling instances of the same bug class, and what you found.

A report that says "tests pass, audit clean" without these four things has not actually claimed the fix works — it has claimed the tests pass, which is a different and weaker claim.