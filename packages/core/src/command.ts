import type { SmartDocument } from "./model.js";
import type { SmartSelection } from "./selection.js";
import type { SmartTransaction } from "./transaction.js";

export interface CommandContext {
  document: SmartDocument;
  selection: SmartSelection;
  now?: () => number;
}

export interface SmartCommand<Input = unknown> {
  id: string;
  isEnabled(context: CommandContext, input?: Input): boolean;
  execute(context: CommandContext, input?: Input): SmartTransaction;
}
