import {
  applyTransaction,
  normalizeCompatibilityHtml,
  type LegacyCommandContext,
  type SmartCommand,
  type SmartEditorState,
  type LegacySmartTransaction,
} from "smartrte-core/legacy";
import { isShadowModeFlagEnabled } from "./internalFlags.js";

export interface ShadowComparison {
  commandId: string;
  matches: boolean;
  legacyHtml: string;
  coreHtml: string;
}

const semanticHtml = (html: string) => normalizeCompatibilityHtml(html)
  .replace(/<(\/?)b(?=[\s>])/g, "<$1strong")
  .replace(/<(\/?)i(?=[\s>])/g, "<$1em")
  .replace(/<(\/?)strike(?=[\s>])/g, "<$1s");

export const isShadowModeEnabled = () => {
  return isShadowModeFlagEnabled();
};

/** Compares canonicalized HTML only; it never changes editor state or output. */
export const compareShadowHtml = (commandId: string, legacyHtml: string, coreHtml: string): ShadowComparison => ({
  commandId,
  matches: semanticHtml(legacyHtml) === semanticHtml(coreHtml),
  legacyHtml: semanticHtml(legacyHtml),
  coreHtml: semanticHtml(coreHtml),
});

export const reportShadowDifference = (comparison: ShadowComparison): void => {
  if (!isShadowModeEnabled() || comparison.matches) return;
  console.warn(`[Smart RTE shadow mode] ${comparison.commandId} produced a semantic HTML mismatch.`, comparison);
};

/**
 * Executes a core command in memory for diagnostics. The caller owns the
 * legacy output; this helper never persists or applies the core result.
 */
export const runShadowCommand = <Input>(args: {
  command: SmartCommand<Input>;
  context: LegacyCommandContext;
  input?: Input;
  state: SmartEditorState;
  legacyHtml: string;
  serialize: (state: SmartEditorState) => string;
}): LegacySmartTransaction | null => {
  if (!isShadowModeEnabled() || !args.command.isEnabled(args.context, args.input)) return null;
  const transaction = args.command.execute(args.context, args.input);
  const coreHtml = args.serialize(applyTransaction(args.state, transaction));
  reportShadowDifference(compareShadowHtml(args.command.id, args.legacyHtml, coreHtml));
  return transaction;
};
