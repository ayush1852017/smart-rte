import type { SmartListPreset, SmartListStyle } from "./model.js";
import {
  FOUNDATION_SMART_LIST_PRESETS,
  foundationListStyleForPresetDepth,
  isFoundationSmartListPreset,
  type FoundationSmartListKind,
  type FoundationSmartListPresetDefinition,
} from "./foundation/list/presets.js";

export type SmartListKind = FoundationSmartListKind;

/** Public compatibility shape for the canonical foundation preset catalog. */
export type SmartListPresetDefinition = Omit<FoundationSmartListPresetDefinition, "id" | "styles"> & {
  id: SmartListPreset;
  styles: readonly SmartListStyle[];
};

export const SMART_LIST_PRESETS: readonly SmartListPresetDefinition[] = FOUNDATION_SMART_LIST_PRESETS;

export const isSmartListPreset = (value: unknown): value is SmartListPreset => isFoundationSmartListPreset(value);

const presetMap = new Map(SMART_LIST_PRESETS.map((preset) => [preset.id, preset]));

export const getSmartListPreset = (id: SmartListPreset) => presetMap.get(id)!;

export const listStyleForPresetDepth = (id: SmartListPreset, depth: number): SmartListStyle =>
  foundationListStyleForPresetDepth(id, depth);
