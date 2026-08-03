import type { LegacySmartMark } from "./model.js";

export type InlineMarkType = Extract<LegacySmartMark, { type: string }>['type'];

export const hasMark = (marks: readonly LegacySmartMark[] | undefined, type: InlineMarkType) =>
  Boolean(marks?.some((mark) => mark.type === type));

export const addMark = (marks: readonly LegacySmartMark[] | undefined, mark: LegacySmartMark): LegacySmartMark[] => [
  ...(marks || []).filter((existing) => existing.type !== mark.type),
  mark,
];

export const removeMark = (marks: readonly LegacySmartMark[] | undefined, type: InlineMarkType): LegacySmartMark[] | undefined => {
  const next = (marks || []).filter((mark) => mark.type !== type);
  return next.length > 0 ? next : undefined;
};
