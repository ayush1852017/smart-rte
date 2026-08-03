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
import { listNodeSpecs } from "./list/schema.js";
import { canonicalMarkOrder, compareMarks } from "./marks/canonical.js";
import { hardBreakNodeSpec, inlineMarkSpecs } from "./marks/schema.js";

type Expression =
  | { kind: "name"; value: string }
  | { kind: "sequence"; items: Expression[] }
  | { kind: "choice"; items: Expression[] }
  | { kind: "repeat"; item: Expression; min: number; max: number };

const tokenize = (source: string): string[] => {
  const tokens = source.match(/[A-Za-z_][A-Za-z0-9_-]*|[()|+*?]/g) || [];
  if (tokens.join("").length !== source.replace(/\s+/g, "").length) {
    throw new Error(`Invalid content expression "${source}".`);
  }
  return tokens;
};

export const parseContentExpression = (source: string): Expression => {
  const tokens = tokenize(source);
  let cursor = 0;
  const parseChoice = (): Expression => {
    const items = [parseSequence()];
    while (tokens[cursor] === "|") {
      cursor += 1;
      items.push(parseSequence());
    }
    return items.length === 1 ? items[0] : { kind: "choice", items };
  };
  const parseSequence = (): Expression => {
    const items: Expression[] = [];
    while (cursor < tokens.length && tokens[cursor] !== ")" && tokens[cursor] !== "|") {
      let item: Expression;
      if (tokens[cursor] === "(") {
        cursor += 1;
        item = parseChoice();
        if (tokens[cursor] !== ")") throw new Error(`Unclosed group in content expression "${source}".`);
        cursor += 1;
      } else {
        const value = tokens[cursor++];
        if (!value || /[+*?()|]/.test(value)) throw new Error(`Expected node name in content expression "${source}".`);
        item = { kind: "name", value };
      }
      const quantifier = tokens[cursor];
      if (quantifier === "+" || quantifier === "*" || quantifier === "?") {
        cursor += 1;
        item = {
          kind: "repeat",
          item,
          min: quantifier === "+" ? 1 : 0,
          max: quantifier === "?" ? 1 : Number.POSITIVE_INFINITY,
        };
      }
      items.push(item);
    }
    return items.length === 1 ? items[0] : { kind: "sequence", items };
  };
  const expression = parseChoice();
  if (cursor !== tokens.length) throw new Error(`Unexpected token in content expression "${source}".`);
  return expression;
};

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

const freezeSpec = <T extends NodeSpec | MarkSpec>(spec: T): Readonly<T> => {
  const attributes = spec.attributes
    ? Object.freeze(Object.fromEntries(Object.entries(spec.attributes).map(([name, attribute]) => [name, Object.freeze({ ...attribute })])))
    : undefined;
  return Object.freeze({
    ...spec,
    ...(attributes ? { attributes } : {}),
    ...(Array.isArray((spec as NodeSpec).marks) ? { marks: Object.freeze([...(spec as NodeSpec).marks as string[]]) } : {}),
    ...(Array.isArray((spec as MarkSpec).excludes) ? { excludes: Object.freeze([...(spec as MarkSpec).excludes as string[]]) } : {}),
  }) as Readonly<T>;
};

export interface SchemaContribution {
  nodes?: readonly NodeSpec[];
  marks?: readonly MarkSpec[];
}

export const createSchema = (options: {
  nodes: readonly NodeSpec[];
  marks?: readonly MarkSpec[];
  topNode?: string;
  version: number;
  extensions?: readonly SchemaContribution[];
}): SmartSchema => {
  const nodes: Record<string, Readonly<NodeSpec>> = {};
  const marks: Record<string, Readonly<MarkSpec>> = {};
  const addNode = (spec: NodeSpec) => {
    if (nodes[spec.type]) throw new Error(`Duplicate node type "${spec.type}".`);
    if (spec.content) parseContentExpression(spec.content);
    nodes[spec.type] = freezeSpec({ ...spec });
  };
  const addMark = (spec: MarkSpec) => {
    if (marks[spec.type]) throw new Error(`Duplicate mark type "${spec.type}".`);
    marks[spec.type] = freezeSpec({ ...spec });
  };
  options.nodes.forEach(addNode);
  options.marks?.forEach(addMark);
  options.extensions?.forEach((extension) => {
    extension.nodes?.forEach(addNode);
    extension.marks?.forEach(addMark);
  });
  const topNode = options.topNode || "doc";
  if (!nodes[topNode] || nodes[topNode].group !== "document") throw new Error(`Invalid top node "${topNode}".`);
  return Object.freeze({
    nodes: Object.freeze(nodes),
    marks: Object.freeze(marks),
    topNode,
    version: options.version,
  });
};

const stringAttr: AttributeSpec = { validate: (value) => typeof value === "string" };

export const foundationSchema = createSchema({
  version: 2,
  nodes: [
    { type: "doc", group: "document", content: "block+" },
    { type: "paragraph", group: "block", content: "inline*" },
    { type: "heading", group: "block", content: "inline*", attributes: { level: { required: true, default: 1, validate: (v) => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 6 } } },
    ...listNodeSpecs,
    { type: "text", group: "inline", marks: "_all" },
    hardBreakNodeSpec,
    { type: "unknown", group: "block", atomic: true, isolating: true, selectable: true, attributes: {
      originalType: { required: true, ...stringAttr },
      originalGroup: { required: true, validate: (v) => v === "block" || v === "inline" },
      raw: { required: true },
      editable: { default: false, validate: (v) => v === false },
    } },
  ],
  marks: [...inlineMarkSpecs],
});

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
        const allowed = spec.marks !== "" && (!Array.isArray(spec.marks) || spec.marks.includes(mark.type));
        const attributeErrors: ValidationError[] = [];
        if (markSpec) validateAttributes(mark.attrs, markSpec.attributes, [...path, index], attributeErrors);
        const excluded = Boolean(markSpec?.excludes?.some((type) => accepted.some((candidate) => candidate.type === type)));
        if (markSpec && allowed && !attributeErrors.length && !excluded) accepted.push(mark);
        else repairs.push({ path: [...path, index], code: "remove-invalid-mark", message: `Removed invalid or disallowed mark "${mark.type}".`, before: mark });
      });
      return accepted.length ? { ...child, marks: accepted } : { type: "text", text: child.text };
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
    const repaired: SmartElementNode = { type: source.type, id, ...(Object.keys(attrs).length ? { attrs } : {}), ...(spec.content ? { children } : {}) };
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

export const serializePersistedDocument = (value: { schemaVersion: number; revision: number; document: SmartDocument }): string =>
  JSON.stringify(value);

export const parsePersistedDocument = (json: string): { schemaVersion: number; revision: number; document: SmartDocument } => {
  const parsed = JSON.parse(json) as { schemaVersion: number; revision: number; document: SmartDocument };
  if (!Number.isInteger(parsed.schemaVersion) || !Number.isInteger(parsed.revision) || !parsed.document) {
    throw new Error("Invalid persisted editor document envelope.");
  }
  return parsed;
};
