# Browser Input Quirks Registry

This registry records browser-specific input behavior discovered by automated
or physical-device testing. Every workaround must name its browser behavior,
the canonical intent it preserves, and its verification.

| ID | Browser/input | Observed behavior | Canonical policy | Verification | Owner/status |
|---|---|---|---|---|---|
| `webkit-shift-enter-beforeinput` | WebKit Shift+Enter | WebKit did not consistently emit `beforeinput` with `inputType=insertLineBreak`; the model therefore received no `hard_break`. | Own Shift+Enter at `keydown`, call the same atomic `hard_break` insertion path, and prevent the later native event. | `canonical-surface.spec.ts`, Chromium/Firefox/WebKit. | Phase 4, active. |
| `android-composition-mutation-fallback` | Chrome Android IME | `beforeinput` is not reliable for every mobile composition path. | Observe only the composing subtree; reconcile mapping-aware tokens at `compositionend`; never render into the composing owner. | Synthetic ownership tests pass. Physical Gboard/Samsung validation is pending. | Phase 2.5/4, pending device evidence. |

New entries require a regression test where automation can reproduce the
behavior. Physical-only findings must record device, OS, browser, keyboard/IME,
language, and outcome in `MANUAL_VALIDATION_SESSION.md`.
