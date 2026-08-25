# marks plugin

**Version:** 1.0.0

### `link.edit`

Sets or replaces the link mark's href/target on the current selection, or on the link run at a collapsed caret inside one.

**Options:**

| Name | Required | Description |
|---|---|---|
| `href` | yes | The link URL. |
| `target` | no | The link's target attribute, e.g. "_blank". |

**Examples:**

- Turn the selection into a link: `{"href":"https://example.com"}`


### `link.remove`

Removes the link mark from the current selection, or from the link run at a collapsed caret inside one.


### `mark.apply`

Applies a mark (e.g. bold, link) to the current inline selection, removing any mutually-excluded mark first.

**Options:**

| Name | Required | Description |
|---|---|---|
| `markType` | yes | The mark type to apply, e.g. "bold" or "link". |
| `attrs` | no | Mark attributes, if the mark type requires any (e.g. link's href). |


### `mark.clearAll`

Removes every mark present on the current inline selection, regardless of type.


### `mark.remove`

Removes a mark type from the current inline selection.

**Options:**

| Name | Required | Description |
|---|---|---|
| `markType` | yes | The mark type to remove. |


### `mark.setAttrs`

Sets a mark's attributes on the current selection (an alias of mark.apply - re-applying overwrites existing attributes).

**Options:**

| Name | Required | Description |
|---|---|---|
| `markType` | yes | The mark type to update. |
| `attrs` | no | The new attributes. |


### `mark.toggle`

Applies a mark, or removes it if the selection is already fully covered by it (params.coverage === "all").

**Options:**

| Name | Required | Description |
|---|---|---|
| `markType` | yes | The mark type to toggle. |
| `attrs` | no | Mark attributes, if the mark type requires any. |
| `coverage` | no | "all" when the selection is already fully covered by this mark - toggles it off instead of re-applying it. |

**Examples:**

- Toggle bold on the current selection: `{"markType":"bold"}`
- Toggle bold off, given the selection is already fully bold: `{"markType":"bold","coverage":"all"}`

