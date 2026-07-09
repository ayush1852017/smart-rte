import { afterEach, describe, expect, it } from "vitest";
import { isCoreInlineMarkFlagEnabled, isShadowModeFlagEnabled, type SmartRteInternalFlags } from "./internalFlags.js";

type SmartRteFlagGlobal = typeof globalThis & {
  __SMART_RTE_INTERNAL_FLAGS__?: SmartRteInternalFlags;
  __SMART_RTE_CORE_BOLD__?: boolean;
  __SMART_RTE_CORE_ITALIC__?: boolean;
  __SMART_RTE_CORE_UNDERLINE__?: boolean;
  __SMART_RTE_CORE_SUPERSCRIPT__?: boolean;
  __SMART_RTE_CORE_SUBSCRIPT__?: boolean;
  __SMART_RTE_SHADOW_MODE__?: boolean;
  process?: { env?: { NODE_ENV?: string } };
};

const flagGlobal = globalThis as SmartRteFlagGlobal;

const clearFlags = () => {
  delete flagGlobal.__SMART_RTE_INTERNAL_FLAGS__;
  delete flagGlobal.__SMART_RTE_CORE_BOLD__;
  delete flagGlobal.__SMART_RTE_CORE_ITALIC__;
  delete flagGlobal.__SMART_RTE_CORE_UNDERLINE__;
  delete flagGlobal.__SMART_RTE_CORE_SUPERSCRIPT__;
  delete flagGlobal.__SMART_RTE_CORE_SUBSCRIPT__;
  delete flagGlobal.__SMART_RTE_SHADOW_MODE__;
};

describe("Smart RTE internal feature flags", () => {
  afterEach(clearFlags);

  it("keeps core inline execution disabled by default", () => {
    clearFlags();

    expect(isCoreInlineMarkFlagEnabled("bold")).toBe(false);
    expect(isCoreInlineMarkFlagEnabled("italic")).toBe(false);
    expect(isCoreInlineMarkFlagEnabled("underline")).toBe(false);
    expect(isCoreInlineMarkFlagEnabled("superscript")).toBe(false);
    expect(isCoreInlineMarkFlagEnabled("subscript")).toBe(false);
  });

  it("enables all inline mark commands through the grouped coreInlineMarks flag", () => {
    flagGlobal.__SMART_RTE_INTERNAL_FLAGS__ = { coreInlineMarks: true };

    expect(isCoreInlineMarkFlagEnabled("bold")).toBe(true);
    expect(isCoreInlineMarkFlagEnabled("italic")).toBe(true);
    expect(isCoreInlineMarkFlagEnabled("underline")).toBe(true);
    expect(isCoreInlineMarkFlagEnabled("superscript")).toBe(true);
    expect(isCoreInlineMarkFlagEnabled("subscript")).toBe(true);
  });

  it("allows individual flags to enable one command without enabling the group", () => {
    flagGlobal.__SMART_RTE_INTERNAL_FLAGS__ = { coreItalic: true };

    expect(isCoreInlineMarkFlagEnabled("bold")).toBe(false);
    expect(isCoreInlineMarkFlagEnabled("italic")).toBe(true);
    expect(isCoreInlineMarkFlagEnabled("underline")).toBe(false);
  });

  it("lets individual flags override grouped inline mark behavior", () => {
    flagGlobal.__SMART_RTE_INTERNAL_FLAGS__ = { coreInlineMarks: true, coreSubscript: false };

    expect(isCoreInlineMarkFlagEnabled("bold")).toBe(true);
    expect(isCoreInlineMarkFlagEnabled("subscript")).toBe(false);
  });

  it("retains old internal globals as fallback compatibility flags", () => {
    flagGlobal.__SMART_RTE_CORE_BOLD__ = true;
    flagGlobal.__SMART_RTE_CORE_SUPERSCRIPT__ = true;

    expect(isCoreInlineMarkFlagEnabled("bold")).toBe(true);
    expect(isCoreInlineMarkFlagEnabled("italic")).toBe(false);
    expect(isCoreInlineMarkFlagEnabled("superscript")).toBe(true);
  });

  it("prefers the new internal config over old globals", () => {
    flagGlobal.__SMART_RTE_CORE_BOLD__ = true;
    flagGlobal.__SMART_RTE_INTERNAL_FLAGS__ = { coreBold: false };

    expect(isCoreInlineMarkFlagEnabled("bold")).toBe(false);
  });

  it("supports shadowMode through the internal config", () => {
    flagGlobal.__SMART_RTE_INTERNAL_FLAGS__ = { shadowMode: false };
    expect(isShadowModeFlagEnabled()).toBe(false);

    flagGlobal.__SMART_RTE_INTERNAL_FLAGS__ = { shadowMode: true };
    expect(isShadowModeFlagEnabled()).toBe(true);
  });
});
