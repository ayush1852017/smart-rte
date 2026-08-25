# block plugin

**Version:** 1.0.0

### `block.code.indentTab`

Inserts a literal tab character at the caret when it is inside a code block; produces no operations otherwise.


### `block.indent`

Increases the selected blocks' indent level.

**Options:**

| Name | Required | Description |
|---|---|---|
| `amount` | no | How many levels to indent by (default 1). |


### `block.move`

Moves the selected contiguous blocks up or down among their siblings.

**Options:**

| Name | Required | Description |
|---|---|---|
| `direction` | yes | "up" or "down". |


### `block.outdent`

Decreases the selected blocks' indent level.

**Options:**

| Name | Required | Description |
|---|---|---|
| `amount` | no | How many levels to outdent by (default 1). |


### `block.setAttributes`

Sets attributes (e.g. alignment, indent level) on the selected blocks.

**Options:**

| Name | Required | Description |
|---|---|---|
| `attrs` | yes | The attributes to set. |

**Examples:**

- Center-align the selected blocks: `{"attrs":{"align":"center"}}`


### `block.setType`

Converts the selected blocks to a different type (paragraph, heading, or code block), preserving IDs and inline content where the target type allows it.

**Options:**

| Name | Required | Description |
|---|---|---|
| `type` | yes | The target block type. |
| `attrs` | no | Attributes for the new type, e.g. heading level. |

**Examples:**

- Convert the selection to a level-2 heading: `{"type":"heading","attrs":{"level":2}}`


### `block.unwrap`

Removes the enclosing blockquote (or other wrapper) from the selected blocks, promoting their content back out.


### `block.wrap`

Wraps the selected blocks in a blockquote, one wrapper per contiguous group.

**Options:**

| Name | Required | Description |
|---|---|---|
| `type` | yes | Currently only "blockquote". |
| `wrapperIds` | yes | Caller-provided ids, one per wrapper node created. |

