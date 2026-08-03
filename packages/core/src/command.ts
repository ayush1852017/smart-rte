import type { LegacySmartDocument } from "./model.js";
import type { LegacySmartSelection } from "./selection.js";
import type { LegacySmartTransaction } from "./transaction.js";

export interface LegacyCommandContext {
  document: LegacySmartDocument;
  selection: LegacySmartSelection;
  now?: () => number;
}

export interface SmartCommand<Input = unknown> {
  id: string;
  isEnabled(context: LegacyCommandContext, input?: Input): boolean;
  execute(context: LegacyCommandContext, input?: Input): LegacySmartTransaction;
}
