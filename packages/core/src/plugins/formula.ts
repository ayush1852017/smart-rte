import { deleteFormula, insertFormula } from "../legacyCommands/formula.js";
import type { SmartRtePlugin } from "../plugin.js";

export const createFormulaPlugin = (): SmartRtePlugin => ({
  id: "formula",
  commands: {
    [insertFormula.id]: insertFormula,
    [deleteFormula.id]: deleteFormula,
  },
});

export const formulaPlugin = createFormulaPlugin();
