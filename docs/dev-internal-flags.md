# Smart RTE Internal Flags

These flags are internal diagnostics and migration controls. They are not public
React props, are not part of the package API, and may change or be removed before
the core engine becomes the default runtime.

Preferred internal configuration:

```ts
globalThis.__SMART_RTE_INTERNAL_FLAGS__ = {
  coreBold: true,
  coreItalic: true,
  coreUnderline: true,
  coreSuperscript: true,
  coreSubscript: true,
  coreInlineMarks: true,
  shadowMode: true,
};
```

`coreInlineMarks` enables all currently migrated inline mark commands. Individual
command flags can override it for targeted testing:

```ts
globalThis.__SMART_RTE_INTERNAL_FLAGS__ = {
  coreInlineMarks: true,
  coreSubscript: false,
};
```

All core execution flags default to `false`, so existing consumers continue using
the legacy editor runtime unless an internal test explicitly opts in.

Older internal globals are still accepted as fallback compatibility flags:

```ts
globalThis.__SMART_RTE_CORE_BOLD__ = true;
globalThis.__SMART_RTE_CORE_ITALIC__ = true;
globalThis.__SMART_RTE_CORE_UNDERLINE__ = true;
globalThis.__SMART_RTE_CORE_SUPERSCRIPT__ = true;
globalThis.__SMART_RTE_CORE_SUBSCRIPT__ = true;
globalThis.__SMART_RTE_SHADOW_MODE__ = true;
```

When both the preferred config and old globals are present, the preferred config
wins.
