# Plugin architecture

Smart RTE has one runtime authority for editor capabilities. A feature is a
core plugin: it owns its schema contribution, commands, normalization rules,
and optional React UI contributions. The React editor resolves the same plugin
set for both toolbar visibility and command execution, so disabling a feature
cannot leave an active button pointing at an unavailable command.

## Standard preset

Use `features` when you want the built-in preset with selected capabilities
disabled:

```tsx
<ClassicEditor
  features={{
    table: false,
    media: false,
    formula: false,
    checklist: true,
  }}
/>
```

Use `plugins` when the application needs an exact runtime. This replaces the
standard preset rather than extending it:

```tsx
import { formulaPlugin } from "smartrte-core";

<ClassicEditor plugins={[formulaPlugin]} />
```

Dependencies are resolved and validated before the editor is created. For
example, `checklistPlugin` requires `listPlugin`; duplicate IDs, missing
dependencies, circular dependencies, and duplicate command IDs fail fast.

## Custom React plugin

Plugins can contribute commands and UI without modifying `ClassicEditor`:

```tsx
const reviewPlugin = {
  id: "review",
  commands: {
    "review.insert": {
      id: "review.insert",
      execute: ({ selection }) => ({
        id: "review.insert",
        source: "user",
        operations: [],
        selectionBefore: selection,
        selectionAfter: selection,
        addToHistory: true,
        timestamp: Date.now(),
      }),
    },
  },
  react: {
    toolbar: [{
      id: "review-button",
      commandId: "review.insert",
      label: "Review",
    }],
  },
};

<ClassicEditor plugins={[reviewPlugin]} />
```

Toolbar, keyboard shortcut, context-menu, and format contributions are
validated against registered commands. Contributions support deterministic
`order`, visibility, enabled, and active predicates.

## Formats are independent plugins

Import/export adapters are also runtime contributions. Built-in HTML,
Markdown, DOCX, and PDF adapters can be filtered with `formats`, while a
plugin can add a proprietary adapter through `react.formats` or applications
can pass `formatDefinitions` directly.

Keep document transformations in adapters and keep editing behavior in core
plugins. This separation allows an application to ship a small editor preset
without forking serialization or command code.
