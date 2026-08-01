import type { SmartListPreset, SmartListStyle } from "./model.js";

export type SmartListKind = "bullet" | "ordered";

export interface SmartListPresetDefinition {
  id: SmartListPreset;
  kind: SmartListKind;
  label: string;
  styles: readonly SmartListStyle[];
  /** Optional literal markers used by HTML renderers at successive depths. */
  markers?: readonly string[];
  /** Ordered markers include the complete ancestor counter path. */
  outline?: boolean;
  /** Suffix rendered after ordered counters. */
  suffix?: "." | ")";
}

export const SMART_LIST_PRESETS: readonly SmartListPresetDefinition[] = [
  { id: "ordered-decimal", kind: "ordered", label: "1. / a. / i.", styles: ["decimal", "lower-alpha", "lower-roman"], suffix: "." },
  { id: "ordered-decimal-paren", kind: "ordered", label: "1) / a) / i)", styles: ["decimal", "lower-alpha", "lower-roman"], suffix: ")" },
  { id: "ordered-outline", kind: "ordered", label: "1. / 1.1. / 1.1.1.", styles: ["decimal", "decimal", "decimal"], suffix: ".", outline: true },
  { id: "ordered-upper-alpha", kind: "ordered", label: "A. / a. / i.", styles: ["upper-alpha", "lower-alpha", "lower-roman"], suffix: "." },
  { id: "ordered-upper-roman", kind: "ordered", label: "I. / A. / 1.", styles: ["upper-roman", "upper-alpha", "decimal"], suffix: "." },
  { id: "ordered-leading-zero", kind: "ordered", label: "01. / a. / i.", styles: ["decimal-leading-zero", "lower-alpha", "lower-roman"], suffix: "." },
  { id: "bullet-disc", kind: "bullet", label: "● / ○ / ■", styles: ["disc", "circle", "square"] },
  { id: "bullet-diamond", kind: "bullet", label: "❖ / ➢ / ■", styles: ["disc", "circle", "square"], markers: ["❖", "➢", "■"] },
  { id: "bullet-square", kind: "bullet", label: "□ / ▣ / ▪", styles: ["square", "square", "square"], markers: ["□", "▣", "▪"] },
  { id: "bullet-arrow", kind: "bullet", label: "➜ / ◆ / ●", styles: ["disc", "circle", "square"], markers: ["➜", "◆", "●"] },
  { id: "bullet-star", kind: "bullet", label: "★ / ○ / ■", styles: ["disc", "circle", "square"], markers: ["★", "○", "■"] },
  { id: "bullet-arrow-circle", kind: "bullet", label: "➢ / ○ / ■", styles: ["disc", "circle", "square"], markers: ["➢", "○", "■"] },
] as const;

const presetMap = new Map(SMART_LIST_PRESETS.map((preset) => [preset.id, preset]));

export const isSmartListPreset = (value: unknown): value is SmartListPreset =>
  typeof value === "string" && presetMap.has(value as SmartListPreset);

export const getSmartListPreset = (id: SmartListPreset) => presetMap.get(id)!;

export const listStyleForPresetDepth = (id: SmartListPreset, depth: number): SmartListStyle => {
  const styles = getSmartListPreset(id).styles;
  return styles[Math.min(Math.max(0, depth), styles.length - 1)];
};
