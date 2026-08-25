# atom plugin

**Version:** 1.0.0

### `atom.delete`

Deletes the selected atom.


### `atom.insert`

Inserts an atom node (image, formula, video, or audio) at the given position.

**Options:**

| Name | Required | Description |
|---|---|---|
| `declaration` | yes | Which atom type to insert, from atomDeclarations (schema.ts). |
| `nodeId` | yes | Caller-provided id for the new node. |
| `attrs` | yes | The new node's attributes (e.g. src, alt for an image). |
| `ownerId` | no | The inline container to insert into - required for inline atoms. |
| `offset` | no | The inline offset to insert at. |
| `parentId` | no | The block container to insert into - required for block atoms. |
| `index` | no | The block index to insert at. |


### `atom.resize`

Resizes the selected atom, optionally preserving its aspect ratio.

**Options:**

| Name | Required | Description |
|---|---|---|
| `width` | yes | The new width. |
| `height` | yes | The new height. |
| `minWidth` | no | A minimum width to clamp to. |
| `minHeight` | no | A minimum height to clamp to. |
| `preserveAspectRatio` | no | Whether to scale height proportionally to width (or vice versa). |


### `atom.update`

Updates the selected atom's attributes.

**Options:**

| Name | Required | Description |
|---|---|---|
| `attrs` | yes | The new attributes. |

