# Phase 8b reopen: checkbox, mixed list scope, and list presets

All checks below use `?canonicalAuthority=1`. No authority promotion or
rollback-bridge deletion was performed.

## Findings

### Checkbox

The canonical projected-checkbox route now works when the checklist is created
through the toolbar and the visible projected button is clicked. The route is
`packages/core/src/foundation/surface/input.ts:550-580`; it resolves the
containing list item by ID and commits `setListChecked` without replacing the
current text selection. Renderer state is projected at
`packages/core/src/foundation/surface/renderer.ts:112-130`.

There was a separate, reproducible text-input defect: the Space key path at
`packages/core/src/foundation/surface/input.ts:1249-1268` intercepted every
Space typed inside a checkable item and toggled the item. It now does not own
text-entry Space; the projected checkbox remains a real button, so Space/Enter
on that control use native button activation and the click route above.

The failure was not reproduced after rebuilding the package artifacts:

- toolbar-create → projected checkbox → checked → unchecked: 3/3 browsers;
- model-initialized checklist → bounding-box mouse click → checked →
  unchecked: 3/3 browsers.
- typing `Buy milk` through a real Space key in a checklist item: 3/3 browsers.

The likely reason the earlier manual result persisted is that the playground
imports `smartrte-core`/`smartrte-react` package `dist` entry points. Source
changes do not reach that page until the packages are rebuilt. The React E2E
script now rebuilds core and React before Playwright at
`packages/react/package.json` (`e2e` script), preventing stale artifacts from
being mistaken for current behavior.

### Mixed list scope

The exact nested selection/partial-unwrap scenario resolves to a real mixed
scope and remains actionable after the second Outdent. The toolbar flattens
list parts at `packages/react/src/components/CanonicalAuthorityEditor.tsx:98-101`
and computes list legality at `:183-204`; list commands already consume mixed
list parts at `packages/core/src/foundation/list/commands.ts:53-59`.

The regression passes in Chromium, Firefox, and WebKit (3/3). If a manual
selection has no same-level predecessor, Indent is correctly disabled by the
Phase 3 legality rule; Outdent remains enabled whenever a list part remains.
The post-unwrap content is preserved by `unwrapOne` at
`packages/core/src/foundation/list/commands.ts:152-175`.

### Presets

The previous report fixed command routing but missed the live renderer
contract. The theme's custom marker selectors use `data-srte-list-preset` and
`data-srte-list-depth`, while the renderer projected only the `data-smart-*`
names and no depth. Consequently the model attribute changed but the browser
continued to render default disc/decimal markers.

`FoundationSubtreeRenderer.syncNodeAttributes` now projects both attribute
names plus the current nested-list depth at
`packages/core/src/foundation/surface/renderer.ts:75-116`. The theme now
defines marker rules for decimal, upper-alpha, upper-roman,
decimal-leading-zero, bullet-disc/circle, and the existing custom bullet
presets at `packages/react/src/theme.ts:248-337`.

The UI also no longer exposes the historical `bullet-circle` alias. The one
canonical catalog now lives in `packages/core/src/foundation/list/presets.ts`;
the public `packages/core/src/listPresets.ts` is a compatibility facade. The
foundation schema and list commands reject IDs outside that catalog, and the
HTML parser ignores an unknown preset rather than creating an invalid model
attribute.

The browser regression now checks model attrs, DOM depth, and computed
`::marker` content for all configured presets, including nested lists:
`packages/react/e2e/canonical-authority.spec.ts:1444-1519`. All 12 preset cases
pass in all three browsers.

### Nested list marker cascade

Remaining gap after the above: changing a list's preset or style only rewrote
the directly-selected `list` node's own `attrs`. Nested lists live inside
`list_item` children and carry their own independent `preset`/`style` attrs,
and the theme's marker CSS is keyed on `[data-srte-list-preset][data-srte-list-depth]`
on each list element individually — a nested list does not inherit its
ancestor's preset through the DOM, so it kept rendering its old marker family
after the outer list's type changed. The existing "applies every exposed
list preset to a nested list" browser test did not catch this because it
applies the preset directly to the nested list's own selection, not to an
ancestor list containing it.

Fixed at `packages/core/src/foundation/list/commands.ts` (`setListPreset`,
`setListStyle`): both now walk into every nested list inside the selected
list's subtree via `withNestedListsRestyled` and apply the same preset/style
to each, preserving all node IDs (only `attrs` change). `checkable` is
deliberately **not** cascaded — converting an outer list to a checklist must
not silently make every nested sublist checkable too; that remains scoped to
the directly selected list only, matching prior behavior.

Regression coverage: `packages/core/src/foundation/list/commands.test.ts`,
"cascades preset and style changes into nested lists so their markers stay
consistent" — asserts a three-level nested list (outer → child → grandchild)
all pick up the new preset/style while node identity is preserved, and that
`checkable` stays scoped to the outer list only.

## Verification

- `pnpm run build`: core and React dist rebuilt successfully.
- `pnpm run lint`: passed, including both TypeScript checks and contract gates.
- Core: 51 files / 457 tests passed (adds one nested-list-cascade regression).
- React: 43 files / 240 tests passed.
- Focused preset + mixed-scope + checkbox browser cases: 12/12 passed.
- Toolbar-created projected-checkbox cases: 3/3 passed.
- New checklist-space and exact preset-option regressions: 6/6 passed.
- `scripts/check-phase3-contract.mjs` passes.
- No tests removed.

Not yet verified in a live browser: the nested-cascade fix above is confirmed
by a unit test on the pure command (`commands.test.ts`) but no Playwright
regression was added to check the rendered `::marker` content of a nested
list after changing its ancestor's preset through the toolbar. Recommend
extending "applies every exposed list preset to a nested list through toolbar
routing" (`canonical-authority.spec.ts`) to select the *outer* list and assert
the nested list's computed marker changes too, since the current version only
targets the nested list directly.

Please hard-refresh the running page after the rebuild (or restart its Vite
process) before retesting: `http://localhost:5173/?canonicalAuthority=1`.
