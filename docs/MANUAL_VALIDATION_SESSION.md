# Manual Validation Session — Required Before Phase 4 Sign-off

**Status:** macOS/Safari smoke session completed 2026-08-03; remaining device
combinations explicitly accepted as residual risk for Phase 5 entry.

Run the accessibility and physical-device IME checks together in one 60–90
minute session against the canonical surface (`?canonical=1`). Record device,
OS, browser/keyboard versions, failures, and short screen recordings for any
divergence. This session remains an explicit Phase 4 sign-off item until a
human fills in the results below.

## IME matrix

- Android phone + Gboard Hindi: compose, update candidates, cancel, replace a
  selection, and backspace through conjuncts.
- Android phone + Gboard Tamil: the same sequence.
- Samsung Keyboard where available: composition cancellation and backspace.
- macOS Safari + Indic IME: composition, selection replacement, cancellation.
- One physical CJK candidate-window flow.
- For every case, verify text/selection, one-step undo, and
  `composingDomWriteCount === 0`.

## Accessibility matrix

- NVDA + Chrome: navigate nested ordered/unordered lists; create, indent,
  outdent, reorder, and toggle a checklist item; verify one concise level
  announcement and stable focus.
- VoiceOver + Safari: repeat the same flow.
- Confirm checklist controls are announced as checkboxes while each `li`
  remains exposed as a list item.
- For inline tools, verify pressed and mixed/indeterminate toolbar state,
  Ctrl/Cmd+B/I/U/K, link announcements, focus retention, and that colour is not
  the sole indicator of toolbar state.

## Results

| Combination | Tester/date | Result | Evidence/issues |
|---|---|---|---|
| Gboard Hindi | Unscheduled | Pending | — |
| Gboard Tamil | Unscheduled | Pending | — |
| Samsung Keyboard | Unscheduled | Pending | — |
| Safari Indic IME | Unscheduled | Pending | — |
| Physical CJK IME | Unscheduled | Pending | — |
| NVDA + Chrome | Unscheduled | Pending | — |
| VoiceOver + Safari | Product owner / 2026-08-03 | Pass, version not recorded | Text selection, insertion, deletion, undo/redo, toolbar interaction, and dropdown operation passed. `Control+Option+Space` is assigned to language switching in the test environment; `Control+Option+Shift+Down Arrow` successfully enters the dropdown and arrow-key operation works. |
| Canonical 10,000-block smoke | Product owner / 2026-08-03 | Pass | `?canonical=1&blocks=10000` remained usable for selection, insertion, deletion, undo, and redo. This is a functional observation, not a latency measurement. |

## Phase-entry decision

On 2026-08-03 the product owner explicitly approved proceeding after the
successful available-device smoke session. NVDA + Chrome and physical
Indic/CJK IME combinations were not represented as passed; they remain tracked
residual risks and must be completed when the required hardware is available.
