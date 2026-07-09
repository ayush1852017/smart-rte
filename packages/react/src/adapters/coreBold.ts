import { getCoreInlineMarkResult, isCoreInlineMarkEnabled, type CoreInlineMarkResult } from "./inlineMarkCoreExecution.js";

export const isCoreBoldEnabled = () =>
  isCoreInlineMarkEnabled("bold");

/** Executes only the core bold command. Callers own DOM writes and legacy fallback. */
export type CoreBoldResult = CoreInlineMarkResult;

export const getCoreBoldResult = (root: HTMLElement): CoreBoldResult | null => getCoreInlineMarkResult(root, "bold");
