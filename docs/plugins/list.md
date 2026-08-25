# list plugin

**Version:** 1.0.0

### `list.continueNumbering`

Removes an explicit numbering restart, letting this item continue the count from the preceding item.


### `list.create`

Wraps the selected blocks in a new list (or converts an existing list's items) using the given preset.

**Options:**

| Name | Required | Description |
|---|---|---|
| `preset` | no | The list preset id, e.g. "bulleted" or "numbered". |


### `list.indent`

Nests the selected list items one level deeper under the preceding sibling item.


### `list.move`

Moves the selected list items up or down among their siblings.

**Options:**

| Name | Required | Description |
|---|---|---|
| `direction` | yes | "up" or "down". |


### `list.outdent`

Moves the selected list items one level shallower, or unwraps them entirely if already at the top level.


### `list.restartNumbering`

Restarts an ordered list's numbering at the given value from this item onward.

**Options:**

| Name | Required | Description |
|---|---|---|
| `start` | yes | The number to restart counting from. |


### `list.setChecked`

Toggles a checklist item's checked state.

**Options:**

| Name | Required | Description |
|---|---|---|
| `checked` | yes | The new checked state. |


### `list.setPreset`

Changes the selected list's preset (e.g. bulleted, numbered, checklist), restyling its markers accordingly.

**Options:**

| Name | Required | Description |
|---|---|---|
| `preset` | no | The new preset id. |


### `list.setStyle`

Changes the selected list's marker style (e.g. disc, decimal, lower-alpha) independent of its preset.


### `list.unwrap`

Removes the selected list items from their list, promoting their content back to plain blocks.

