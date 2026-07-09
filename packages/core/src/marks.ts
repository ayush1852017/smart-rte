import type { SmartMark } from "./model.js";

export type InlineMarkType = Extract<SmartMark, { type: string }>['type'];

export const hasMark = (marks: readonly SmartMark[] | undefined, type: InlineMarkType) =>
  Boolean(marks?.some((mark) => mark.type === type));

export const addMark = (marks: readonly SmartMark[] | undefined, mark: SmartMark): SmartMark[] => [
  ...(marks || []).filter((existing) => existing.type !== mark.type),
  mark,
];

export const removeMark = (marks: readonly SmartMark[] | undefined, type: InlineMarkType): SmartMark[] | undefined => {
  const next = (marks || []).filter((mark) => mark.type !== type);
  return next.length > 0 ? next : undefined;
};
