import type { NodeSpec } from "../types.js";
import { isFoundationSmartListPreset } from "./presets.js";

const optionalString = { validate: (value: unknown) => typeof value === "string" };
const optionalPreset = { validate: isFoundationSmartListPreset };
const optionalBoolean = { validate: (value: unknown) => typeof value === "boolean" };
const positiveInteger = { validate: (value: unknown) => Number.isInteger(value) && Number(value) >= 1 };

export const listNodeSpecs = [
  {
    type: "list",
    group: "block",
    semanticRole: "list",
    content: "list_item+",
    attributes: {
      preset: optionalPreset,
      style: optionalString,
      start: positiveInteger,
      checkable: { default: false, ...optionalBoolean },
    },
  },
  {
    type: "list_item",
    group: "block",
    semanticRole: "list-item",
    content: "block+",
    attributes: {
      checked: { default: false, ...optionalBoolean },
      numberOverride: positiveInteger,
    },
  },
] as const satisfies readonly NodeSpec[];
