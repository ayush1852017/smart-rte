# Phase 8b Canonical Authority Takeover — second report

Date: 2026-08-05

## Verdict

**HOLD remains correct.** Gate 12 now passes under the corrected rollout
definition. Gate 16's changed suites pass, with one pre-existing WebKit timing
flake disclosed below. Gates 13 and 14 are materially improved but do not meet
their literal exit criteria: the replay is not yet an every-command session
corpus, and the product toolbar does not yet have complete legacy parity.

This report is deliberately limited to the requested remediation and gates
12–14 and 16. The original report remains the record for the other gates.

## Work completed

### 1. Production versus standalone performance profile

The two surfaces were profiled in Chromium with the same 10,000-paragraph
document, input path, browser and renderer. CPU profiles are produced by the
opt-in `canonical-performance-profile.spec.ts`; the investigation and before /
after figures are in `PHASE8B_PERFORMANCE_PROFILE.md`.

The 2–3× delta was not React, CSS, layout, or renderer work. It was synchronous
document-wide JavaScript in the production wrapper:

- transaction subscribers cloned the full document;
- the authority wrapper immediately cloned it again to prepare rollback; and
- the transitional HTML callback serialized all 10,000 blocks in the input
  frame.

Commit listeners now receive the canonical readonly document reference, while
the public state accessor remains defensive. The rollback envelope is captured
at the authority boundary, and clean-HTML callbacks are coalesced with a 250 ms
idle debounce. `onChange` remains synchronous per committed transaction.

Observed steady samples changed from approximately 42–47 ms to 19–21 ms on the
production surface; standalone remained approximately 18–20 ms. Script time
over ten inputs converged from 102.3/339.7 ms (standalone/product) to
102.3/105.8 ms. The profile does not support adding `content-visibility` here.

### 2. Contract corrections

- Rollback now retains the canonical envelope beside clean external HTML.
  Internal rollback HTML carries `data-smart-id`, and a legacy edit preserves
  IDs of retained nodes across canonical → legacy → canonical.
- Gate 9 scans the repository while excluding only `docs/**` and the gate
  script itself. Executable source cannot hide behind a broad exclusion.
- Gate 12 is tracked as: adapters are unreachable from the canonical path;
  deletion is triggered after promotion. The four dormant bridges remain the
  required rollback implementation until then.

### 3. Product toolbar routing

The retained product editor now routes the requested feature families directly
to canonical state and pure commands:

- list create/unwrap, checklist, check, indent/outdent, movement and numbering;
- table insertion, row/column mutation and movement, merge/split, header and
  removal;
- inline link apply/remove;
- image, video, audio and formula insertion, atom editing/deletion and resize;
- HTML/Markdown import and HTML/Markdown/native export.

The routing test runs in Chromium, Firefox and WebKit and does not parse the live
editable DOM to discover state.

### 4. Session replay

The retained and canonical surfaces now start from equivalent state and compare
normalized, ID-stripped structure after every intent. The comparator stores the
first divergent intent rather than only a final count. Its current trajectory
contains eleven intents:

1. two text insertions;
2. explicit selection;
3. bold;
4. undo and redo;
5. focus/blur/focus;
6. external value replacement;
7. paste;
8. external drop; and
9. marked composition.

It runs in all three browsers with no structural divergence. A retained-engine
inline paste defect found by the replay (a paragraph nested inside a paragraph)
was corrected.

Two qualifications matter:

- synthetic drop cannot invoke the browser's native default in the retained
  surface, so the harness performs the equivalent Range insertion there;
- selection is not compared for synthetic composition, and is compared only
  when both harnesses expose a semantic selection. Structure is still compared
  after every intent.

## Gate results

### Gate 12 — adapter inventory reaches zero

**PASS under the corrected tracker definition; repository-wide deletion is
post-promotion.**

- Active adapters reachable from canonical authority: **0**.
- Dormant rollback bridges: **4**.
- The contract gate rejects any marked bridge reachable from the canonical
  product graph.
- Post-promotion deletion remains mandatory and is not represented as complete.

Evidence: `MIGRATION_ADAPTER_INVENTORY.md`,
`PHASE8B_CANONICAL_AUTHORITY.md`, and
`scripts/check-phase8b-contract.mjs`.

### Gate 13 — full session-replay shadow

**FAIL against the literal gate; stop condition remains open.**

| Browser | Sessions | Intents/session | Structural divergences |
|---|---:|---:|---:|
| Chromium | 1 | 11 | 0 |
| Firefox | 1 | 11 | 0 |
| WebKit | 1 | 11 | 0 |

The trajectory now covers composition, interleaved history, external
replacement, clipboard, drop and focus lifecycle. It does **not** replay every
migrated list, table, block, mark and atom command inside complete sessions.
Prior per-feature shadow corpora and the new three-browser routing test are useful
supporting evidence, but they are not a substitute for that literal requirement.
Semantic selection is also not compared for the synthetic composition intent.

No behaviour change reached default users: the authority flag remains off.

### Gate 14 — zero intentional behaviour changes

**NOT PROVEN; treated as FAIL while gate 13 is incomplete.**

The previously missing feature families are now routed and their canonical
semantics were not changed. Complete product parity is nevertheless not true:

- attributed mark controls (font family/size and foreground/background colour)
  are absent from the canonical toolbar;
- blockquote toggle, block movement and block indentation are not exposed on
  this toolbar;
- list preset selection is not exposed;
- DOCX/PDF format workflows are not routed by this component;
- media uses URL prompts instead of the legacy upload/media-manager workflow;
- full contextual state and every command are not yet exercised by session
  replay.

These are flag-on product differences, not new model semantics. They keep this
gate open even though list/table/atom/formula/link/basic-format routing now
works.

### Gate 16 — all prior suites, browser included

**PASS for changed code, with a disclosed full-run WebKit flake.**

| Suite | Before | After | Removed tests |
|---|---:|---:|---|
| Core Vitest | 418 | 420 passing | None |
| React Vitest | 234 | 235 passing | None |
| Playwright | 201 total (199 pass, 2 skip) | 213 total (208 pass, 5 opt-in/project skips) | None |

The first full run found a geometry-dependent click in the new toolbar test;
the test now establishes the table-cell caret through the Selection API and
passes in all three browsers. A subsequent full run found the existing WebKit
Phase 3 `handles Enter start/mid/end and restores structural history` test
timing out; it passed immediately when isolated without a product change. The
new authority lifecycle test also had a click-coordinate assumption corrected
to establish the caret explicitly. All 208 non-skipped tests have passed across
the full run plus isolated reruns, but a single uninterrupted 208/208 run was
not obtained. That distinction is intentionally not hidden.

The five skips are the opt-in CPU profiler outside `SRTE_PROFILE=1` and
project-specific headed-trace skips; no behavioural test was removed.

## Commits

- `d9cf6af` — profile and remove synchronous document-wide production work
- `e8fb7a1` — preserve rollback envelope identity and tighten contract gates
- `98aeac1` — route canonical product toolbar feature families
- `b6a87be` — expand retained/canonical lifecycle replay
- `532a0d3` — make empty-cell toolbar routing test geometry-independent

## Required work before promotion

1. Expand session replay into generated complete sessions covering every
   migrated command and compare semantic selection after every comparable
   intent.
2. Close the listed toolbar/product-parity gaps, then rerun the sessions.
3. Delete the four dormant rollback bridges only after flag promotion.

