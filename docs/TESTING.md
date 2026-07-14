# Smart RTE Testing

## Required checks

Run these before release:

```bash
pnpm --filter smartrte-core test
pnpm --filter smartrte-core build
pnpm --filter smartrte-core lint
pnpm --filter smartrte-react test
pnpm --filter smartrte-react build
pnpm --filter smartrte-react lint
```

## Regression fixtures

Every editor bug needs a fixture covering input HTML, resolved selection,
command, serialized output, and undo/redo where applicable.

High-risk coverage includes:

- selected paragraphs beside code blocks
- nested lists
- table-cell list conversion
- table merge/split and undo
- quotes and code blocks at document boundaries
- paste from Word and Google Docs
- editor-only wrapper removal during export

Compatibility fixtures live in `packages/core/test/fixtures/html`. New parser,
serializer, or normalizer behavior must add a fixture before it is enabled in
the React adapter.

Markdown fixtures live in `packages/core/test/fixtures/markdown`. They cover
CommonMark/GFM-specific structure, including nested lists and tables, and are
not interchangeable with HTML fixtures. HTML fixtures verify preservation of
the supplied structure rather than guessed repairs.

Until an ESLint flat configuration is introduced, package `lint` commands run
TypeScript with `--noEmit`. They fail on static type errors and do not suppress
failures.
