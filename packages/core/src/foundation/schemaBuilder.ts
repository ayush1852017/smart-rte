import type { MarkSpec, NodeSpec } from "./types.js";

/**
 * Pure schema-shape construction, extracted out of schema.ts so it has zero
 * dependency on plugin/ - plugin/registry.ts needs createSchema, and
 * schema.ts's own foundationSchema is computed via the plugin registry
 * (plugin/builtins.ts), so createSchema could not stay defined in schema.ts
 * without a schema.ts <-> plugin/ import cycle. schema.ts re-exports
 * everything here so no existing external import site needs to change.
 */

export type Expression =
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
}) => {
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
