import { assertUniqueNodeIds, cloneNode, createNodeId, isTextNode } from "./identity.js";
import type {
  AttributeSpec,
  MarkSpec,
  NodeGroup,
  NodeSpec,
  Repair,
  SmartDocument,
  SmartElementNode,
  SmartMark,
  SmartNode,
  SmartSchema,
  ValidationError,
} from "./types.js";
import { repairTableGeometry, validateTableGeometry } from "./table/grid.js";
import { canonicalMarkOrder, compareMarks } from "./marks/canonical.js";
import { hardBreakNodeSpec } from "./marks/schema.js";
import { builtInPlugins } from "./plugin/builtins.js";
import { createPluginRegistry, type PluginRegistry } from "./plugin/registry.js";
import { parseContentExpression, type Expression, type SchemaContribution } from "./schemaBuilder.js";

export { createSchema, parseContentExpression, type SchemaContribution } from "./schemaBuilder.js";

const groupForNode = (node: SmartNode, schema: SmartSchema): NodeGroup | undefined => {
  if (node.type === "unknown") {
    const group = !isTextNode(node) ? node.attrs?.originalGroup : undefined;
    return group === "inline" || group === "block" ? group : "block";
  }
  return schema.nodes[node.type]?.group;
};

const matchesName = (node: SmartNode | undefined, name: string, schema: SmartSchema) =>
  Boolean(node && (node.type === name || groupForNode(node, schema) === name));

const matchExpression = (
  expression: Expression,
  children: readonly SmartNode[],
  start: number,
  schema: SmartSchema,
): Set<number> => {
  if (expression.kind === "name") return matchesName(children[start], expression.value, schema)
    ? new Set([start + 1])
    : new Set();
  if (expression.kind === "choice") {
    const result = new Set<number>();
    expression.items.forEach((item) => matchExpression(item, children, start, schema).forEach((end) => result.add(end)));
    return result;
  }
  if (expression.kind === "sequence") {
    let positions = new Set([start]);
    expression.items.forEach((item) => {
      const next = new Set<number>();
      positions.forEach((position) => matchExpression(item, children, position, schema).forEach((end) => next.add(end)));
      positions = next;
    });
    return positions;
  }
  const result = new Set<number>();
  let frontier = new Set([start]);
  if (expression.min === 0) result.add(start);
  for (let count = 1; frontier.size && count <= expression.max && count <= children.length + 1; count += 1) {
    const next = new Set<number>();
    frontier.forEach((position) => matchExpression(expression.item, children, position, schema).forEach((end) => {
      if (end !== position) next.add(end);
    }));
    frontier = next;
    if (count >= expression.min) frontier.forEach((position) => result.add(position));
  }
  return result;
};

export const contentMatches = (expression: string, children: readonly SmartNode[], schema: SmartSchema): boolean =>
  matchExpression(parseContentExpression(expression), children, 0, schema).has(children.length);

const stringAttr: AttributeSpec = { validate: (value) => typeof value === "string" };

/**
 * Node/mark types no feature-family plugin owns and that must exist
 * regardless of which plugins are registered: the document root, plain
 * text, hard breaks, and `unknown` itself - the disable-safety passthrough
 * node type (see repair() below), which would be a chicken-and-egg problem
 * if any plugin had to own it.
 */
export const baseSchema: SchemaContribution = {
  nodes: [
    { type: "doc", group: "document", content: "block+" },
    { type: "text", group: "inline", marks: "_all" },
    hardBreakNodeSpec,
    { type: "unknown", group: "block", atomic: true, isolating: true, selectable: true, attributes: {
      originalType: { required: true, ...stringAttr },
      originalGroup: { required: true, validate: (v) => v === "block" || v === "inline" },
      raw: { required: true },
      editable: { default: false, validate: (v) => v === false },
    } },
  ],
  marks: [
    /**
     * The mark-side equivalent of the "unknown" node type above: a
     * base-registered (not plugin-owned) passthrough for a mark type the
     * current schema doesn't recognize, preserving it verbatim through
     * repair() instead of silently dropping it (see repair()'s
     * mark-filtering loop below and restoreUnknownMarks()).
     */
    { type: "unknown-mark", attributes: {
      originalType: { required: true, ...stringAttr },
      originalAttrs: {},
    } },
  ],
};

/**
 * The "all built-ins" preset, now derived from the plugin registry
 * (plugin/registry.ts, plugin/builtins.ts) rather than a hand-maintained
 * literal - Phase 10's runtime plugin registration applies to the default
 * editor construction too, not just custom plugin lists. Computed once and
 * exported alongside `foundationSchema` so editor.ts can default
 * FoundationEditorOptions.commands/keyboardShortcuts to the same registry
 * instance instead of recomputing it.
 */
export const foundationRegistry: PluginRegistry = createPluginRegistry(builtInPlugins, { baseSchema, schemaVersion: 2 });
export const foundationSchema: SmartSchema = foundationRegistry.schema;

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const validateAttributes = (
  value: Record<string, unknown> | undefined,
  specs: Record<string, AttributeSpec> | undefined,
  path: number[],
  errors: ValidationError[],
) => {
  Object.entries(specs || {}).forEach(([name, spec]) => {
    const present = Boolean(value && own(value, name));
    if (spec.required && !present && spec.default === undefined) {
      errors.push({ path: [...path], code: "missing-attribute", message: `Required attribute "${name}" is missing.` });
    } else if (present && spec.validate && !spec.validate(value?.[name])) {
      errors.push({ path: [...path], code: "invalid-attribute", message: `Attribute "${name}" is invalid.` });
    }
  });
};

export const validate = (document: SmartDocument, schema: SmartSchema = foundationSchema): ValidationError[] => {
  const errors: ValidationError[] = [];
  const ids = new Set<string>();
  const visit = (node: SmartNode, path: number[], parentSpec?: Readonly<NodeSpec>) => {
    const spec = schema.nodes[node.type];
    if (!spec) {
      errors.push({ path, code: "unknown-node-type", message: `Node type "${node.type}" is not registered.` });
      return;
    }
    if (isTextNode(node)) {
      if (typeof node.text !== "string") errors.push({ path, code: "invalid-text", message: "Text content must be a string." });
      node.marks?.forEach((mark) => {
        const markSpec = schema.marks[mark.type];
        if (!markSpec) errors.push({ path, code: "unknown-mark", message: `Mark type "${mark.type}" is not registered.` });
        else {
          if (parentSpec?.marks === "" || Array.isArray(parentSpec?.marks) && !parentSpec.marks.includes(mark.type)) {
            errors.push({ path, code: "disallowed-mark", message: `Mark "${mark.type}" is not allowed in "${parentSpec.type}".` });
          }
          validateAttributes(mark.attrs, markSpec.attributes, path, errors);
          const excluded = markSpec.excludes || [];
          if (node.marks?.some((candidate) => candidate !== mark && excluded.includes(candidate.type))) {
            errors.push({ path, code: "excluded-mark", message: `Mark "${mark.type}" excludes another active mark.` });
          }
        }
      });
      if (node.marks?.some((mark, index) => index > 0 && compareMarks(node.marks![index - 1], mark) > 0)) {
        errors.push({ path, code: "noncanonical-mark-order", message: "Text marks must be stored in canonical type/attribute order." });
      }
      return;
    }
    if (!node.id) errors.push({ path, code: "missing-id", message: "Every non-text node requires an id." });
    else if (ids.has(node.id)) errors.push({ path, code: "duplicate-id", message: `Duplicate node id "${node.id}".` });
    else ids.add(node.id);
    validateAttributes(node.attrs, spec.attributes, path, errors);
    const children = node.children || [];
    if (spec.atomic && children.length) errors.push({ path, code: "atomic-content", message: "Atomic nodes cannot contain children." });
    if (spec.content && !contentMatches(spec.content, children, schema)) {
      errors.push({ path, code: "invalid-content", message: `Children do not match "${spec.content}".` });
    } else if (!spec.content && children.length) {
      errors.push({ path, code: "unexpected-content", message: `Node "${node.type}" does not allow children.` });
    }
    children.forEach((child, index) => visit(child, [...path, index], spec));
    if (node.type === "table") validateTableGeometry(node).forEach((issue) => errors.push({
      path, code: `table-${issue.code}`, message: issue.message,
    }));
  };
  visit(document, []);
  return errors;
};

const emptyParagraph = (): SmartElementNode => ({ type: "paragraph", id: createNodeId(), children: [] });
const inferChildGroup = (parentType: string): "inline" | "block" =>
  parentType === "paragraph" || parentType === "heading" ? "inline" : "block";

export const repair = (
  input: SmartDocument,
  schema: SmartSchema = foundationSchema,
): { doc: SmartDocument; repairs: Repair[] } => {
  const repairs: Repair[] = [];
  const usedIds = new Set<string>();
  const repairNode = (source: SmartNode, path: number[], expectedGroup: "inline" | "block" | "document"): SmartNode => {
    if (!schema.nodes[source.type]) {
      const unknown: SmartElementNode = {
        type: "unknown",
        id: !isTextNode(source) && source.id && !usedIds.has(source.id) ? source.id : createNodeId(),
        attrs: { originalType: source.type, originalGroup: expectedGroup === "inline" ? "inline" : "block", raw: cloneNode(source), editable: false },
      };
      usedIds.add(unknown.id);
      repairs.push({ path, code: "preserve-unknown", message: `Preserved unregistered node "${source.type}" as unknown.`, before: source, after: unknown });
      return unknown;
    }
    if (isTextNode(source)) return { type: "text", text: String(source.text ?? ""), ...(source.marks?.length ? { marks: canonicalMarkOrder(source.marks) } : {}) };
    let id = source.id;
    if (!id || usedIds.has(id)) {
      const before = id;
      id = createNodeId();
      repairs.push({ path, code: before ? "duplicate-id" : "missing-id", message: "Assigned a unique stable node id.", before, after: id });
    }
    usedIds.add(id);
    const spec = schema.nodes[source.type];
    const attrs = { ...(source.attrs || {}) };
    Object.entries(spec.attributes || {}).forEach(([name, attribute]) => {
      const valid = !own(attrs, name) || !attribute.validate || attribute.validate(attrs[name]);
      if ((!own(attrs, name) || !valid) && attribute.default !== undefined) {
        const before = attrs[name];
        attrs[name] = structuredClone(attribute.default);
        repairs.push({ path, code: "repair-attribute", message: `Applied the default for attribute "${name}".`, before, after: attrs[name] });
      } else if (!valid && !attribute.required) {
        const before = attrs[name];
        delete attrs[name];
        repairs.push({ path, code: "remove-invalid-attribute", message: `Removed invalid attribute "${name}".`, before });
      }
    });
    const group = inferChildGroup(source.type);
    let children = (source.children || []).map((child, index) => repairNode(child, [...path, index], group));
    children = children.map((child, index) => {
      if (!isTextNode(child) || !child.marks?.length) return child;
      const accepted: SmartMark[] = [];
      child.marks.forEach((mark) => {
        const markSpec = schema.marks[mark.type];
        if (!markSpec) {
          // Unlike a mark that's registered but locally disallowed/invalid
          // (handled below, and still correctly dropped), a mark type the
          // schema has never heard of is preserved verbatim as an
          // unknown-mark sentinel - the mark-side counterpart of repair()'s
          // node-side "preserve-unknown" passthrough - rather than deleted.
          const unknown: SmartMark = { type: "unknown-mark", attrs: { originalType: mark.type, ...(mark.attrs ? { originalAttrs: mark.attrs } : {}) } };
          accepted.push(unknown);
          repairs.push({ path: [...path, index], code: "preserve-unknown-mark", message: `Preserved unrecognized mark "${mark.type}" as unknown-mark.`, before: mark, after: unknown });
          return;
        }
        const allowed = spec.marks !== "" && (!Array.isArray(spec.marks) || spec.marks.includes(mark.type));
        const attributeErrors: ValidationError[] = [];
        validateAttributes(mark.attrs, markSpec.attributes, [...path, index], attributeErrors);
        const excluded = Boolean(markSpec.excludes?.some((type) => accepted.some((candidate) => candidate.type === type)));
        if (allowed && !attributeErrors.length && !excluded) accepted.push(mark);
        else repairs.push({ path: [...path, index], code: "remove-invalid-mark", message: `Removed invalid or disallowed mark "${mark.type}".`, before: mark });
      });
      const ordered = canonicalMarkOrder(accepted);
      return ordered.length ? { ...child, marks: ordered } : { type: "text", text: child.text };
    });
    const preserveMisplaced = (node: SmartNode, original: SmartNode, originalGroup: "inline" | "block"): SmartElementNode => {
      const unknown: SmartElementNode = {
        type: "unknown",
        id: createNodeId(),
        attrs: { originalType: original.type, originalGroup, raw: cloneNode(original), editable: false },
      };
      usedIds.add(unknown.id);
      repairs.push({ path, code: "preserve-misplaced", message: `Preserved misplaced "${node.type}" content as unknown.`, before: original, after: unknown });
      return unknown;
    };
    if (source.type === "doc") {
      children = children.map((child, index) => {
        if (groupForNode(child, schema) === "block") return child;
        return { type: "paragraph", id: createNodeId(), children: [isTextNode(child) ? child : preserveMisplaced(child, source.children?.[index] || child, "inline")] };
      });
      if (children.length === 0) {
        children = [emptyParagraph()];
        repairs.push({ path, code: "empty-document", message: "Inserted an empty paragraph into the document." });
      }
    }
    if (source.type === "paragraph" || source.type === "heading") {
      children = children.map((child, index) => groupForNode(child, schema) === "inline"
        ? child
        : preserveMisplaced(child, source.children?.[index] || child, "inline"));
    }
    if (source.type === "list" && children.length === 0) {
      children = [{ type: "list_item", id: createNodeId(), children: [emptyParagraph()] }];
      repairs.push({ path, code: "empty-list", message: "Inserted an empty list item." });
    } else if (source.type === "list") {
      children = children.map((child) => child.type === "list_item"
        ? child
        : {
          type: "list_item",
          id: createNodeId(),
          children: [groupForNode(child, schema) === "block" ? child : { type: "paragraph", id: createNodeId(), children: [child] }],
        });
    }
    if (source.type === "list_item") {
      if (!children.length) {
        children = [emptyParagraph()];
        repairs.push({ path, code: "empty-list-item", message: "Inserted an empty paragraph into the list item." });
      } else children = children.map((child) => groupForNode(child, schema) === "block"
        ? child
        : { type: "paragraph", id: createNodeId(), children: [child] });
    }
    // A quote is a block container, so an empty imported quote still needs a
    // real editable owner.  Renderer-only <br> projections cannot provide a
    // canonical position for Enter, deletion, or selection mapping.
    if (source.type === "blockquote" && children.length === 0) {
      children = [emptyParagraph()];
      repairs.push({ path, code: "empty-blockquote", message: "Inserted an empty paragraph into the blockquote." });
    }
    let repaired: SmartElementNode = { type: source.type, id, ...(Object.keys(attrs).length ? { attrs } : {}), ...(spec.content ? { children } : {}) };
    if (source.type === "table") {
      const geometry = repairTableGeometry(repaired);
      repaired = geometry.table;
      geometry.repairs.forEach((issue) => repairs.push({ path, code: `table-${issue.code}`, message: issue.message, before: source, after: repaired }));
    }
    return repaired;
  };
  const root = repairNode(input, [], "document");
  if (isTextNode(root) || root.type !== schema.topNode) {
    const wrapped: SmartDocument = { type: "doc", id: createNodeId(), children: [isTextNode(root) ? emptyParagraph() : root] };
    repairs.push({ path: [], code: "repair-root", message: `Wrapped content in top node "${schema.topNode}".`, before: root, after: wrapped });
    return { doc: wrapped, repairs };
  }
  const doc = root as SmartDocument;
  assertUniqueNodeIds(doc);
  return { doc, repairs };
};

/**
 * The reverse of repair()'s "preserve-unknown" case: a node whose type is
 * now recognized by `schema` (e.g. its owning plugin was re-enabled) is
 * restored verbatim from the `unknown` wrapper's `raw` attribute, recursing
 * into the restored subtree in case it too contains a now-restorable
 * `unknown` node. This is the disable-safety round trip's other half -
 * repair() already existed and demotes unrecognized content to `unknown`
 * without any Phase 10 changes; this direction did not exist before.
 */
export const restoreUnknownNodes = (document: SmartDocument, schema: SmartSchema): SmartDocument => {
  const restoreNode = (node: SmartNode): SmartNode => {
    if (isTextNode(node)) return node;
    if (node.type === "unknown") {
      const originalType = node.attrs?.originalType;
      const raw = node.attrs?.raw as SmartNode | undefined;
      if (typeof originalType === "string" && schema.nodes[originalType] && raw) return restoreNode(cloneNode(raw));
    }
    return node.children ? { ...node, children: node.children.map(restoreNode) } : node;
  };
  const restored = restoreNode(document) as SmartDocument;
  assertUniqueNodeIds(restored);
  return restored;
};

/**
 * The mark-side counterpart of restoreUnknownNodes(): a text node's
 * "unknown-mark" sentinels (see repair()'s mark-filtering loop above) are
 * restored to their real mark type once `schema` recognizes it again,
 * re-sorted into canonical order since the restored type string can sort
 * differently than "unknown-mark" did.
 */
export const restoreUnknownMarks = (document: SmartDocument, schema: SmartSchema): SmartDocument => {
  const restoreNode = (node: SmartNode): SmartNode => {
    if (isTextNode(node)) {
      if (!node.marks?.length) return node;
      const restored = node.marks.map((mark) => {
        if (mark.type !== "unknown-mark") return mark;
        const originalType = mark.attrs?.originalType;
        if (typeof originalType !== "string" || !schema.marks[originalType]) return mark;
        const originalAttrs = mark.attrs?.originalAttrs as Record<string, unknown> | undefined;
        return { type: originalType, ...(originalAttrs ? { attrs: originalAttrs } : {}) };
      });
      return { ...node, marks: canonicalMarkOrder(restored) };
    }
    return node.children ? { ...node, children: node.children.map(restoreNode) } : node;
  };
  return restoreNode(document) as SmartDocument;
};

export const serializePersistedDocument = (value: { schemaVersion: number; revision: number; document: SmartDocument }): string =>
  JSON.stringify(value);

export const parsePersistedDocument = (json: string): { schemaVersion: number; revision: number; document: SmartDocument } => {
  const parsed = JSON.parse(json) as { schemaVersion: number; revision: number; document: SmartDocument };
  if (!Number.isInteger(parsed.schemaVersion) || !Number.isInteger(parsed.revision) || !parsed.document) {
    throw new Error("Invalid persisted editor document envelope.");
  }
  return parsed;
};
