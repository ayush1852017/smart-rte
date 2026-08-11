# Phase 8b gate 13 intent classification

This inventory is the input to the retained-versus-canonical replay. An intent
is comparable when the pre-takeover retained engine had the capability, even if
the current product UI was not the most convenient route. An exclusion is only
accepted when the retained engine genuinely had no equivalent capability.

Gate 13 replay status: all 42 rows marked `yes` below are now exercised by the
browser retained-vs-canonical route in Chromium, Firefox, and WebKit, with
normalized ID-stripped structure compared after the intent. The eleven intents
added in Delta 4 also have semantic-selection checkpoints. Twelve inherited
table/atom rows remain structure-only because their existing comparator route
does not expose an honest retained selection; that limitation is recorded in
the delta report rather than hidden. The seven `no` rows remain owner-approved
exclusions and are not counted as comparable coverage.

| Intent | Retained counterpart exists? | If not, why not |
|---|---:|---|
| `mark.bold` | yes | Retained inline command `toggleBold`. |
| `mark.italic` | yes | Retained inline command `toggleItalic`. |
| `mark.underline` | yes | Retained inline command `toggleUnderline`. |
| `mark.strike` | yes | Retained inline command `toggleStrike`. |
| `mark.code` | yes | Retained inline command `toggleInlineCode`. |
| `mark.superscript` | yes | Retained inline command `toggleSuperscript`. |
| `mark.subscript` | yes | Retained inline command `toggleSubscript`. |
| `mark.textColor` | yes | Retained inline command `applyTextColor`. |
| `mark.backgroundColor` | yes | Retained inline command `applyBackgroundColor`. |
| `mark.fontSize` | yes | Retained inline command `applyFontSize`. |
| `mark.fontFamily` | yes | Retained inline command `applyFontFamily`; replay enables the existing legacy option. |
| `mark.link` | yes | Retained inline link command. |
| `block.setType` | yes | Retained block `setBlockType`. |
| `block.setAttributes` | yes | Retained alignment command. |
| `block.wrap` | yes | Retained blockquote toggle. |
| `block.unwrap` | yes | Retained blockquote toggle. |
| `block.move` | yes | Retained block move command (including the previously reported list-item UI regression). |
| `block.indent` | yes | Retained block indent command. |
| `block.outdent` | yes | Retained block indent/outdent command. |
| `list.create` | yes | Retained list toggle. |
| `list.setPreset` | yes | Retained list toggle accepts the preset and applies its style family. |
| `list.setStyle` | yes | Retained list toggle accepts explicit list styles. |
| `list.indent` | yes | Retained list indent command. |
| `list.outdent` | yes | Retained list outdent command. |
| `list.move` | yes | Retained block/list move path existed; the product no-op is a parity finding, not an exclusion. |
| `list.move.reverse` | yes | Same retained move path in the opposite direction. |
| `list.create.numbered` | yes | Retained ordered-list toggle. |
| `list.setChecked` | yes | Retained checklist toggle and item checked command. |
| `list.restartNumbering` | no | Retained engine had no restart-numbering capability. |
| `list.continueNumbering` | no | Retained engine had no continue-numbering capability. |
| `list.unwrap` | yes | Retained list toggle unwraps an existing list. |
| `table.insert` | yes | Retained `table.insert`. |
| `table.mergeCells` | yes | Retained `table.cell.merge`. |
| `table.splitCell` | yes | Retained `table.cell.split`. |
| `table.insertRow` | yes | Retained `table.row.add`. |
| `table.removeRow` | yes | Retained `table.row.remove`. |
| `table.insertColumn` | yes | Retained `table.column.add`. |
| `table.removeColumn` | yes | Retained `table.column.remove`. |
| `table.setHeader` | yes | Retained header-cell/row/column commands. |
| `table.moveRow` | no | Retained table engine had no row-reordering capability. |
| `table.moveColumn` | no | Retained table engine had no column-reordering capability. |
| `table.remove` | yes | Retained `table.remove`. |
| `atom.insert.image` | no | This generated intent exercises the Phase 8b host-provider picker/upload; retained had only its local file/image path, not the provider contract. |
| `atom.resize` | yes | Retained image resize path exists; replay uses a deterministic existing image fixture. |
| `atom.update` | yes | Retained image attribute update path exists. |
| `atom.delete` | yes | Retained image deletion path exists. |
| `atom.insert.video` | no | Retained engine never supported video insertion. |
| `atom.insert.audio` | no | Retained engine never supported audio insertion. |
| `atom.insert.formula` | yes | Retained formula insertion path exists. |

The seven excluded generated intents are therefore `list.restartNumbering`,
`list.continueNumbering`, `table.moveRow`, `table.moveColumn`,
`atom.insert.image`, `atom.insert.video`, and `atom.insert.audio`. Provider-backed
media, rather than media in general, is the reason for the image insertion
exclusion. DOCX/PDF browser workflows are outside the 49 generated editing
intents and are guarded separately.

The ten list additions in this closure are `list.create`, `list.setPreset`,
`list.setStyle`, `list.indent`, `list.outdent`, `list.move`,
`list.move.reverse`, `list.create.numbered`, `list.setChecked`, and
`list.unwrap`; `table.insert` is the eleventh addition. Existing five-case list
smoke coverage remains separately reported from these named replays.
