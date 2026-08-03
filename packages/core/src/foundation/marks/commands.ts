import { isTextNode } from "../identity.js";
import { nodeAtPath } from "../positions.js";
import { normalizeLinkInput, sanitizeLinkTarget } from "../security/urlPolicy.js";
import { canonicalMarkAttrs, markKey } from "./canonical.js";
import { resolveMarkRun } from "./resolveMarkRun.js";
import type { InlineRangeScope, ResolvedScope } from "../scope/types.js";
import type { SmartDocument, SmartMark, SmartOperation, SmartRange } from "../types.js";
import type {
  MarkApplyParams, MarkClearAllParams, MarkCommand, MarkCommandContext,
  MarkRemoveParams, MarkSetAttrsParams, MarkToggleParams,
  LinkEditParams, MarkApplicationReport,
} from "./types.js";

const inlineScopes = (scope: ResolvedScope): InlineRangeScope[] => {
  if (scope.kind === "inline-range") return [scope];
  if (scope.kind !== "mixed") return [];
  return scope.parts.flatMap(inlineScopes);
};

const markFor = (params: MarkApplyParams, ctx: MarkCommandContext): SmartMark => {
  const spec = ctx.schema.marks[params.markType];
  if (!spec) throw new Error(`Unknown mark type "${params.markType}".`);
  let attrs = canonicalMarkAttrs(params.markType, params.attrs);
  if (params.markType === "link") {
    const href = normalizeLinkInput(String(params.attrs?.href || "")).href;
    if (!href) throw new Error("Link mark requires a safe URL.");
    attrs = { href, ...(sanitizeLinkTarget(params.attrs?.target as string | undefined) ? { target: sanitizeLinkTarget(params.attrs?.target as string) } : {}) };
  }
  if (attrs === null) throw new Error(`Invalid attributes for mark "${params.markType}".`);
  const errors = Object.entries(spec.attributes || {}).filter(([name, attribute]) =>
    attribute.required && attrs?.[name] === undefined || attrs?.[name] !== undefined && attribute.validate && !attribute.validate(attrs[name]));
  if (errors.length) throw new Error(`Invalid attributes for mark "${params.markType}": ${errors[0][0]}.`);
  return { type: params.markType, ...(Object.keys(attrs).length ? { attrs } : {}) };
};

const textMarksInRange = (document: SmartDocument, range: SmartRange): SmartMark[] => {
  const owner = nodeAtPath(document, range.from.path);
  if (!owner || isTextNode(owner) || range.from.path.some((part, index) => part !== range.to.path[index])) return [];
  let offset = 0;
  const marks: SmartMark[] = [];
  (owner.children || []).forEach((node) => {
    const width = isTextNode(node) ? node.text.length : 1;
    if (isTextNode(node) && offset < range.to.offset && offset + width > range.from.offset) marks.push(...(node.marks || []));
    offset += width;
  });
  return [...new Map(marks.map((mark) => [markKey(mark), mark])).values()];
};

const ranges = (scope: ResolvedScope, ctx: MarkCommandContext): SmartRange[] => inlineScopes(scope).flatMap((part) =>
  part.runs.filter((run) => run.to > run.from).flatMap((run) => {
    const content = ctx.positions.contentRangeOf(run.ownerNodeId);
    return content ? [{ from: { path: [...content.from.path], offset: run.from }, to: { path: [...content.to.path], offset: run.to } }] : [];
  }));

const markAllowedInOwner = (document: SmartDocument, range: SmartRange, markType: string, ctx: MarkCommandContext) => {
  const owner = nodeAtPath(document, range.from.path);
  if (!owner || isTextNode(owner)) return false;
  const allowed = ctx.schema.nodes[owner.type]?.marks;
  return allowed !== "" && (allowed === undefined || allowed === "_all" || allowed.includes(markType));
};

/** Reports atoms skipped by mark application without changing the command contract. */
export const reportMarkApplication = (
  document: SmartDocument,
  scope: ResolvedScope,
  markType: string,
  ctx: MarkCommandContext,
): MarkApplicationReport => {
  const ownerIds = new Set<string>();
  const skippedOwners = new Set<string>();
  const skipped = new Set<string>();
  for (const part of inlineScopes(scope)) for (const run of part.runs) {
    ownerIds.add(run.ownerNodeId);
    const content = ctx.positions.contentRangeOf(run.ownerNodeId);
    if (content && !markAllowedInOwner(document, content, markType, ctx)) skippedOwners.add(run.ownerNodeId);
    if (!run.containsAtoms) continue;
    const owner = content ? nodeAtPath(document, content.from.path) : undefined;
    if (!owner || isTextNode(owner)) continue;
    let offset = 0;
    for (const child of owner.children || []) {
      const width = isTextNode(child) ? child.text.length : 1;
      if (!isTextNode(child) && offset < run.to && offset + width > run.from) {
        const allowed = ctx.schema.nodes[child.type]?.marks;
        if (allowed !== "_all" && (!Array.isArray(allowed) || !allowed.includes(markType))) skipped.add(child.id);
      }
      offset += width;
    }
  }
  return {
    ownerCount: ownerIds.size,
    ownerIdsSkipped: [...skippedOwners],
    atomOwnersSkipped: [...skipped],
    partial: skipped.size > 0 || skippedOwners.size > 0,
  };
};

const removalsFor = (document: SmartDocument, range: SmartRange, types: ReadonlySet<string>): SmartOperation[] =>
  textMarksInRange(document, range).filter((mark) => types.has(mark.type)).map((mark) => ({ type: "removeMark", range, mark }));

export const applyMarkCommand: MarkCommand<MarkApplyParams> = (document, scope, params, ctx) => {
  const mark = markFor(params, ctx);
  const excluded = new Set([mark.type, ...(ctx.schema.marks[mark.type]?.excludes || [])]);
  return ranges(scope, ctx).filter((range) => markAllowedInOwner(document, range, params.markType, ctx)).flatMap((range) => [
    ...removalsFor(document, range, excluded),
    { type: "addMark" as const, range, mark },
  ]);
};

export const removeMarkCommand: MarkCommand<MarkRemoveParams> = (document, scope, params, ctx) =>
  ranges(scope, ctx).flatMap((range) => removalsFor(document, range, new Set([params.markType])));

export const toggleMarkCommand: MarkCommand<MarkToggleParams> = (document, scope, params, ctx) =>
  params.coverage === "all"
    ? removeMarkCommand(document, scope, params, ctx)
    : applyMarkCommand(document, scope, params, ctx);

export const setMarkAttrsCommand: MarkCommand<MarkSetAttrsParams> = applyMarkCommand;

export const clearAllMarksCommand: MarkCommand<MarkClearAllParams> = (document, scope, _params, ctx) =>
  ranges(scope, ctx).flatMap((range) => textMarksInRange(document, range).map((mark) => ({ type: "removeMark", range, mark })));

const collapsedLinkRun = (document: SmartDocument, scope: ResolvedScope) => {
  const inline = inlineScopes(scope)[0];
  return inline?.collapsed && inline.storedMarkAnchor
    ? resolveMarkRun(document, inline.storedMarkAnchor.pos, "link")
    : null;
};

export const removeLinkCommand: MarkCommand<MarkRemoveParams> = (document, scope, params, ctx) => {
  const run = collapsedLinkRun(document, scope);
  return run
    ? [{ type: "removeMark", range: run.range, mark: run.mark }]
    : removeMarkCommand(document, scope, { markType: params.markType || "link" }, ctx);
};

export const editLinkCommand: MarkCommand<LinkEditParams> = (document, scope, params, ctx) => {
  const run = collapsedLinkRun(document, scope);
  const attrs = { href: params.href, ...(params.target ? { target: params.target } : {}) };
  if (!run) return applyMarkCommand(document, scope, { markType: "link", attrs }, ctx);
  const replacement = markFor({ markType: "link", attrs }, ctx);
  return [
    { type: "removeMark", range: run.range, mark: run.mark },
    { type: "addMark", range: run.range, mark: replacement },
  ];
};

export const markCommands = {
  "mark.apply": applyMarkCommand,
  "mark.remove": removeMarkCommand,
  "mark.toggle": toggleMarkCommand,
  "mark.setAttrs": setMarkAttrsCommand,
  "mark.clearAll": clearAllMarksCommand,
  "link.remove": removeLinkCommand,
  "link.edit": editLinkCommand,
} as const;
