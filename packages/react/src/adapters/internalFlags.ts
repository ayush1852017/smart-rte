import type { CoreInlineMark } from "./inlineMarkCoreExecution.js";

export interface SmartRteInternalFlags {
  coreBold?: boolean;
  coreItalic?: boolean;
  coreUnderline?: boolean;
  coreSuperscript?: boolean;
  coreSubscript?: boolean;
  coreInlineMarks?: boolean;
  shadowMode?: boolean;
}

type SmartRteGlobal = typeof globalThis & {
  __SMART_RTE_INTERNAL_FLAGS__?: SmartRteInternalFlags;
  __SMART_RTE_CORE_BOLD__?: boolean;
  __SMART_RTE_CORE_ITALIC__?: boolean;
  __SMART_RTE_CORE_UNDERLINE__?: boolean;
  __SMART_RTE_CORE_SUPERSCRIPT__?: boolean;
  __SMART_RTE_CORE_SUBSCRIPT__?: boolean;
  __SMART_RTE_SHADOW_MODE__?: boolean;
  process?: { env?: { NODE_ENV?: string } };
};

const markFlagNames: Record<CoreInlineMark, keyof SmartRteInternalFlags> = {
  bold: "coreBold",
  italic: "coreItalic",
  underline: "coreUnderline",
  superscript: "coreSuperscript",
  subscript: "coreSubscript",
};

const legacyMarkFlagNames: Record<CoreInlineMark, keyof SmartRteGlobal> = {
  bold: "__SMART_RTE_CORE_BOLD__",
  italic: "__SMART_RTE_CORE_ITALIC__",
  underline: "__SMART_RTE_CORE_UNDERLINE__",
  superscript: "__SMART_RTE_CORE_SUPERSCRIPT__",
  subscript: "__SMART_RTE_CORE_SUBSCRIPT__",
};

const getGlobal = () => globalThis as SmartRteGlobal;

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export const getSmartRteInternalFlags = (): SmartRteInternalFlags =>
  getGlobal().__SMART_RTE_INTERNAL_FLAGS__ || {};

export const isCoreInlineMarkFlagEnabled = (mark: CoreInlineMark): boolean => {
  const flags = getSmartRteInternalFlags();
  const individual = readBoolean(flags[markFlagNames[mark]]);
  if (individual !== undefined) return individual;
  const grouped = readBoolean(flags.coreInlineMarks);
  if (grouped !== undefined) return grouped;
  return getGlobal()[legacyMarkFlagNames[mark]] === true;
};

export const isShadowModeFlagEnabled = (): boolean => {
  const configured = readBoolean(getSmartRteInternalFlags().shadowMode);
  if (configured !== undefined) return configured;
  const global = getGlobal();
  if (global.process?.env) return global.process.env.NODE_ENV !== "production";
  return global.__SMART_RTE_SHADOW_MODE__ === true;
};
