import type { Attrs, SmartMark } from "../types.js";

const namedColors: Readonly<Record<string, string>> = Object.freeze({
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
  blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080",
  transparent: "#00000000",
});

export const stableValue = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(",")}}`;
  return JSON.stringify(value);
};

export const markKey = (mark: SmartMark): string => `${mark.type}:${stableValue(mark.attrs || {})}`;
export const compareMarks = (left: SmartMark, right: SmartMark): number =>
  left.type.localeCompare(right.type) || stableValue(left.attrs || {}).localeCompare(stableValue(right.attrs || {}));
export const canonicalMarkOrder = (marks: readonly SmartMark[] | undefined): SmartMark[] =>
  [...(marks || [])].sort(compareMarks).map((mark) => ({ type: mark.type, ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}) }));

export const canonicalColor = (input: unknown): string | null => {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (namedColors[value]) return namedColors[value];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const raw = hex[1].length === 3 ? hex[1].split("").map((part) => part + part).join("") : hex[1];
    return `#${raw}`;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/.exec(value);
  if (!rgb) return null;
  const parts = rgb.slice(1, 4).map(Number);
  if (parts.some((part) => part > 255)) return null;
  const base = `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  if (rgb[4] === undefined || Number(rgb[4]) === 1) return base;
  return `${base}${Math.round(Number(rgb[4]) * 255).toString(16).padStart(2, "0")}`;
};

export const canonicalFontSize = (input: unknown): number | null => {
  const raw = typeof input === "number" ? input : typeof input === "string"
    ? (() => {
      const match = /^(\d+(?:\.\d+)?)(px|pt)?$/i.exec(input.trim());
      if (!match) return Number.NaN;
      return Number(match[1]) * (match[2]?.toLowerCase() === "pt" ? 4 / 3 : 1);
    })()
    : Number.NaN;
  return Number.isFinite(raw) && raw >= 1 && raw <= 512 ? Number(raw.toFixed(3)) : null;
};

export const canonicalFontFamily = (input: unknown): string | null => {
  if (typeof input !== "string") return null;
  const value = input.split(",").map((family) => family.trim().replace(/^(['"])(.*)\1$/, "$2").replace(/\s+/g, " ").toLowerCase())
    .filter(Boolean).join(", ");
  return value || null;
};

export const canonicalMarkAttrs = (markType: string, attrs: Attrs | undefined): Attrs | null => {
  if (markType === "textColor" || markType === "backgroundColor") {
    const value = canonicalColor(attrs?.value);
    return value ? { value } : null;
  }
  if (markType === "fontSize") {
    const valuePx = canonicalFontSize(attrs?.valuePx);
    return valuePx === null ? null : { valuePx };
  }
  if (markType === "fontFamily") {
    const value = canonicalFontFamily(attrs?.value);
    return value ? { value } : null;
  }
  return attrs ? Object.fromEntries(Object.entries(attrs).sort(([left], [right]) => left.localeCompare(right))) : {};
};
