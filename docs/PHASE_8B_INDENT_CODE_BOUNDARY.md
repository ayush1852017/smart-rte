# Phase 8b follow-up: indent/outdent and converted code-block boundaries

All checks in this note ran against the canonical-authority surface (`?canonicalAuthority=1`). The flag was on for every browser scenario; no flag promotion or rollback-bridge deletion was performed.

## 1. Depth-zero subset selection and Indent/Outdent

### Reproduction and classification

The exact pre-unwrap shape was exercised: a subset of two items was selected while nested, then Outdent was pressed twice. After the second press the selected items were at depth zero but still children of the outer list. The resolved scope remained `list-selection`, and the outer list retained the expected sibling and selected-item IDs.

At that point both controls were enabled in Chromium, Firefox, and WebKit. The focused regression passed in all three browsers. This is case **(a), but it is not a defect**: the implementation correctly distinguishes “depth zero, still in a list” from “the list has already been unwrapped.” Case **(c)** was not reproduced.

If the observed state was after one additional Outdent, it is case **(b)**. That operation intentionally unwraps the depth-zero item. The resulting selection is a plain block, so list Indent and Outdent do not apply; the list-creation control (Bullets/Numbering) is the applicable route. A subset whose first selected item is the list’s first child also correctly has Indent disabled because there is no preceding same-level sibling to indent under.

### Root cause / implementation review

No production defect was found and no production fix was warranted.

- Toolbar legality is derived in [CanonicalAuthorityEditor.tsx:173-186](../packages/react/src/components/CanonicalAuthorityEditor.tsx) and the button states are wired at lines 558-559. `canIndent` is independent of Outdent and is true when the selected run has a preceding sibling; Outdent remains available for any `list-selection`, including the depth-zero unwrap action.
- The pure command has the same contract: `indentList` rejects a run without a preceding sibling ([list/commands.ts:209-235](../packages/core/src/foundation/list/commands.ts)), while `outdentList` unwraps at depth zero ([list/commands.ts:237 onward](../packages/core/src/foundation/list/commands.ts)). There is no coupled “both disabled at maximum depth” rule.

The test added at [canonical-authority.spec.ts:1079-1129](../packages/react/e2e/canonical-authority.spec.ts) constructs a genuinely nested list, selects only the B/C subset, verifies the intermediate depth states, then asserts at depth zero that both controls remain enabled, the scope is still `list-selection`, and the list IDs are preserved. It passed 6/6 focused browser cases (three browsers × the two new scenarios).

### Retained comparison

Retained list/toolbar suites pass. The retained path has no equivalent canonical semantic-scope inspection for this exact subset/depth-zero state, and no retained defect was observed. No retained code was changed.

## 2. Converted code block: content-end and document-end reachability

### Reproduction and classification

The conversion path was exercised by selecting existing paragraph text and changing the Block type to `code_block`. It was tested both when the converted block was the final document node and when a paragraph followed it.

Both requested positions were reachable:

1. The caret could be placed at the end of the code block’s own text. The model selection was `{ path: [0], offset: 10 }`, the native selection was collapsed, and typing `!` produced exactly `convert me!` with the selection advancing to offset 11.
2. The same content-end check passed when the code block was not final, and the following paragraph remained unchanged.

Therefore neither failure mode **(i)** (unreachable end inside the code block) nor a conversion-specific mapping failure was reproduced. The final-node “position after the code block” is a different contract: a code block is itself an editable owner, unlike a quote/table/atomic boundary. The current boundary normalizer intentionally does not add a sibling paragraph after every code block. Escape is provided by the existing code-block behavior (Ctrl/Cmd+Enter, or Enter on a trailing empty line), not by inventing an outside position that would change code-block semantics.

### Root cause / implementation review

No production defect was found and no boundary-normalizer change was made.

- [boundaries.ts:19-42](../packages/core/src/foundation/boundaries.ts) classifies blockquotes, tables, atomic nodes, and isolating blocks as outside-edge boundary blocks, while `isEditableBlock` explicitly includes `code_block`. That is why a code block remains an editable owner rather than receiving an automatic paragraph sibling.
- Conversion is identity-preserving: [block/commands.ts:82-113](../packages/core/src/foundation/block/commands.ts) removes disallowed marks and emits `setNodeType`, retaining the node and its text children.
- Code-block positions are resolved as text-owner offsets ([positions.ts:21-47](../packages/core/src/foundation/positions.ts)); the renderer maps and restores the native selection after the transaction ([surface/renderer.ts:584 onward](../packages/core/src/foundation/surface/renderer.ts)).
- The documented escape path is implemented in [block/input.ts:21-73](../packages/core/src/foundation/block/input.ts) and is covered by the existing core input tests.

Adding a paragraph after every final code block would be a behavior/schema change, not a repair to the reported end-of-content bug. It should only be considered with an explicit contract change.

The regression at [canonical-authority.spec.ts:1131-1180](../packages/react/e2e/canonical-authority.spec.ts) covers conversion at document end and away from document end, asserts both model and native caret state, types at the end, and verifies the non-final following block. It passed in Chromium, Firefox, and WebKit.

### Retained comparison

Retained block/format suites pass. There is no retained canonical-authority conversion/caret counterpart that exposes a different result, and no retained defect was observed. No retained code was changed.

## Regression accounting

| Suite | Before this follow-up | After this follow-up | Removed tests |
|---|---:|---:|---|
| Core Vitest | 51 files / 452 passed | 51 files / 452 passed | None |
| React Vitest | 43 files / 240 passed | 43 files / 240 passed | None |
| Playwright browser | 318 scheduled / 307 passed / 6 failed / 5 skipped | **324 scheduled / 313 passed / 6 failed / 5 skipped** | None |

The six browser failures are unchanged known failures in the generated command-session and broad toolbar-routing scenarios (Chromium, Firefox, and WebKit variants). They time out on the intentionally disabled atom “Grow selected atom” / Resize+ route; no new failure was introduced by these two regressions. The focused run for the two new scenarios was 6/6 passed. The recurring WebKit list-Enter timeout was not part of this focused pair and did not change this run.

`pnpm run lint`, the full core and React suites, and `git diff --check` pass. The only changes for this work order are the two browser regressions; no production behavior needed alteration because both reported states already satisfy the current contracts.

## Status

The depth-zero subset state is verified as working. The converted-code-block caret is verified at its content end in both final and non-final positions. Promotion remains an owner decision, and the rollback bridges remain in place.
