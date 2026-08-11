export type FoundationSmartListKind = "bullet" | "ordered";

export type FoundationSmartListStyle =
  | "disc" | "circle" | "square"
  | "decimal" | "decimal-leading-zero"
  | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";

export type FoundationSmartListPreset =
  | "bullet-disc" | "bullet-diamond" | "bullet-square" | "bullet-arrow" | "bullet-star" | "bullet-arrow-circle"
  | "ordered-decimal" | "ordered-decimal-paren" | "ordered-outline"
  | "ordered-upper-alpha" | "ordered-upper-roman" | "ordered-leading-zero";

export interface FoundationSmartListPresetDefinition {
  id: FoundationSmartListPreset;
  kind: FoundationSmartListKind;
  label: string;
  styles: readonly FoundationSmartListStyle[];
  markers?: readonly string[];
  outline?: boolean;
  suffix?: "." | ")";
}

/** The only list preset catalog accepted by canonical commands and schema. */
export const FOUNDATION_SMART_LIST_PRESETS: readonly FoundationSmartListPresetDefinition[] = [
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

const presetMap = new Map(FOUNDATION_SMART_LIST_PRESETS.map((preset) => [preset.id, preset]));

export const isFoundationSmartListPreset = (value: unknown): value is FoundationSmartListPreset =>
  typeof value === "string" && presetMap.has(value as FoundationSmartListPreset);

export const foundationListStyleForPresetDepth = (
  id: FoundationSmartListPreset,
  depth: number,
): FoundationSmartListStyle => {
  const styles = presetMap.get(id)!.styles;
  return styles[Math.min(Math.max(0, depth), styles.length - 1)];
};
