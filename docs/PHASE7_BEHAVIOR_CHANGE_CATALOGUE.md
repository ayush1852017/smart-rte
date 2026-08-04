# Phase 7 atom behaviour-change catalogue

This catalogue was committed before the product legacy media/formula fallbacks
were deleted. Equivalence remains normalized structure with IDs stripped plus
semantic selection; operation streams are not compared. Logs contain only
scenario hashes and classifications.

## Corrections of legacy behaviour

| Change | Legacy | Canonical | Reason |
|---|---|---|---|
| Unsafe resource URLs | Accepted non-empty `javascript:` and HTML `data:` image sources. | Rejects them at the shared URL-policy command boundary. | Prevent script-bearing document content and unsafe serialization. |
| Formula trust | Product KaTeX invocation used defaults without an explicit trust contract. | Calls KaTeX with `trust: false` and `strict: "error"`; the foundation renderer emits text/attributes only. | User formula source must never enable HTML/trust commands or evaluation. |
| Missing image alternatives | Insert paths silently manufactured the word `image`. | Image commands require an explicit string; product insertion prompts when no library alternative exists, and blank is a deliberate decorative choice. | Silent empty/generic alternatives are an accessibility defect. |
| Block-atom Backspace | DOM deletion could remove a large embed immediately. | First press selects; second press deletes. Inline atoms still delete directly. | Protect large content while keeping inline behavior natural. |
| Composition crossing atoms | Flat `textContent` reconciliation lost offsets after an atom. | Atoms are opaque one-unit tokens; any crossing mutation is rejected and the canonical owner restored. | Preserves atom identity, marks, and cursor offsets. |
| Upload failure/deletion | Failure could disappear with transient UI and late completion could target stale DOM. | Error remains document content; completion checks the stable node ID and drops a stale result. | Prevent data loss and resurrection after undo/delete. |

## Retained corpus result

Seed `0xA70B2027`, 2,100 unit scenarios: 600 structurally equivalent, 900
equivalent-serialization differences, and 600 expected-normalization
corrections (300 unsafe resource URL, 300 unsafe data MIME). There were zero
unexplained semantic, data-loss, or unknown results. The three-browser replay
uses 700 scenarios per browser and is reported separately at the exit gate.
