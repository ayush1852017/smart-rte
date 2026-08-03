import { isTextNode } from "../identity.js";
import type {
  ResolvedPos,
  SmartDocument,
  SmartElementNode,
  SmartMark,
  SmartNode,
  SmartPos,
  SmartRange,
  SmartSchema,
  SmartSelection,
} from "../types.js";
import type {
  AtomicNodeScope,
  BlockRangeScope,
  ContainerTreeScope,
  EmptyScope,
  InlineRangeScope,
  ListSelectionScope,
  MixedScope,
  ResolvedScope,
  ScopeBase,
  ScopeIndex,
  ScopeRequest,
  ScopeResult,
  SelectionDescription,
  TableGridScope,
  PositionLookup,
} from "./types.js";

interface Entry {
  node: SmartElementNode;
  path: number[];
  parent: Entry | null;
  children: Entry[];
  index: number;
  depth: number;
  preorder: number;
  open: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  inlineOwner: boolean;
  group: "document" | "block" | "inline";
  atomic: boolean;
  isolating: boolean;
  role: StructuralRole | null;
  inlineChildren: Array<{ node: SmartNode; from: number; to: number }>;
}

type StructuralRole = "list" | "list-item" | "table" | "table-row" | "table-cell";

interface Endpoint {
  resolved: ResolvedPos;
  entry: Entry;
  rank: number;
  isolation: Entry | null;
}

interface Index {
  root: Entry;
  entries: Entry[];
  byId: Map<string, Entry>;
  byPath: Map<string, Entry>;
  blocks: Entry[];
  blockSet: Set<Entry>;
  atoms: Entry[];
}

interface ResolutionContext {
  index: Index;
  schema: SmartSchema;
  original: SmartRange;
  range: SmartRange;
  from: Endpoint;
  to: Endpoint;
  clamped: boolean;
  clampReason?: ScopeBase["clampReason"];
}

const pathKey = (path: readonly number[]) => path.join("/");
const copyPos = (pos: SmartPos): SmartPos => ({ path: [...pos.path], offset: pos.offset });
const copyRange = (range: SmartRange): SmartRange => ({ from: copyPos(range.from), to: copyPos(range.to) });
const typeKey = (type: string) => type.toLowerCase().replace(/-/g, "_");
const fallbackRole = (type: string): StructuralRole | null => {
  const key = typeKey(type);
  if (key === "list") return "list";
  if (key === "list_item" || key === "listitem") return "list-item";
  if (key === "table") return "table";
  if (key === "table_row" || key === "tablerow") return "table-row";
  if (["table_cell", "table_header", "table_header_cell", "tablecell"].includes(key)) return "table-cell";
  return null;
};
/** The single semantic-role resolution boundary: explicit role, then legacy type fallback. */
const roleOf = (node: SmartElementNode, schema: SmartSchema): StructuralRole | null =>
  schema.nodes[node.type]?.semanticRole ?? fallbackRole(node.type);
const isList = (entry: Entry) => entry.role === "list";
const isListItem = (entry: Entry) => entry.role === "list-item";
const isTable = (entry: Entry) => entry.role === "table";
const isTableRow = (entry: Entry) => entry.role === "table-row";
const isTableCell = (entry: Entry) => entry.role === "table-cell";

const schemaGroup = (node: SmartElementNode, schema: SmartSchema) => {
  if (node.type === "unknown") {
    return node.attrs?.originalGroup === "inline" ? "inline" : "block";
  }
  return schema.nodes[node.type]?.group ?? "block";
};

const contentAcceptsInline = (node: SmartElementNode, schema: SmartSchema) => {
  const expression = schema.nodes[node.type]?.content;
  return Boolean(expression && /(^|[^A-Za-z0-9_-])inline([^A-Za-z0-9_-]|$)/.test(expression));
};

const buildIndex = (document: SmartDocument, schema: SmartSchema): Index => {
  const entries: Entry[] = [];
  const byId = new Map<string, Entry>();
  const byPath = new Map<string, Entry>();
  let cursor = 0;
  let preorder = 0;

  const visit = (node: SmartElementNode, path: number[], parent: Entry | null, index: number): Entry => {
    if (node.attrs?.["data-smart-ui"] === true) {
      throw new Error("Editor UI nodes may not appear in the canonical model.");
    }
    if (byId.has(node.id)) throw new Error(`Duplicate node id "${node.id}".`);
    const spec = schema.nodes[node.type];
    const group = schemaGroup(node, schema);
    const atomic = Boolean(spec?.atomic || node.type === "unknown");
    const entry: Entry = {
      node,
      path: [...path],
      parent,
      children: [],
      index,
      depth: path.length,
      preorder: preorder++,
      open: cursor++,
      contentStart: cursor,
      contentEnd: cursor,
      end: cursor,
      inlineOwner: !atomic && contentAcceptsInline(node, schema),
      group,
      atomic,
      isolating: Boolean(spec?.isolating),
      role: roleOf(node, schema),
      inlineChildren: [],
    };
    entries.push(entry);
    byId.set(node.id, entry);
    byPath.set(pathKey(path), entry);

    if (entry.inlineOwner) {
      let inlineOffset = 0;
      for (const child of node.children || []) {
        const width = isTextNode(child) ? child.text.length : 1;
        entry.inlineChildren.push({ node: child, from: inlineOffset, to: inlineOffset + width });
        if (isTextNode(child)) {
          cursor += width;
        } else {
          if (!schema.nodes[child.type]?.atomic && child.type !== "unknown") {
            throw new Error(`Inline child "${child.type}" must be atomic.`);
          }
          const atomStart = cursor;
          const atom = visit(child, [...path, entry.inlineChildren.length - 1], entry, entry.inlineChildren.length - 1);
          atom.open = atomStart;
          atom.contentStart = atomStart;
          atom.contentEnd = atomStart + 1;
          atom.end = atomStart + 1;
          cursor = atomStart + 1;
        }
        inlineOffset += width;
      }
    } else if (!atomic) {
      (node.children || []).forEach((child, childIndex) => {
        if (!isTextNode(child)) entry.children.push(visit(child, [...path, childIndex], entry, childIndex));
        else cursor += child.text.length;
      });
    }
    entry.contentEnd = cursor;
    entry.end = cursor++;
    return entry;
  };

  const root = visit(document, [], null, 0);
  const hasBlockDescendant = (entry: Entry): boolean => entry.children.some((child) =>
    (child.group === "block" && !isListItem(child) && !isTableRow(child) && !isTableCell(child)) || hasBlockDescendant(child));
  const blocks = entries.filter((entry) => entry.group === "block"
    && !isListItem(entry)
    && !isTableRow(entry)
    && !isTableCell(entry)
    && (entry.atomic || !hasBlockDescendant(entry)));
  const atoms = entries.filter((entry) => entry.atomic);
  return { root, entries, byId, byPath, blocks, blockSet: new Set(blocks), atoms };
};

/** Reuses every cached entry/map when node identity says topology is unchanged. */
const refreshIndex = (index: Index, document: SmartDocument, schema: SmartSchema): boolean => {
  const update = (entry: Entry, node: SmartElementNode): boolean => {
    if (entry.node === node) return true;
    if (entry.node.id !== node.id || entry.node.type !== node.type) return false;
    entry.node = node;
    entry.isolating = Boolean(schema.nodes[node.type]?.isolating);
    entry.role = roleOf(node, schema);
    if (entry.inlineOwner) {
      const beforeAtoms = entry.inlineChildren.filter((child) => !isTextNode(child.node)).map((child) => (child.node as SmartElementNode).id);
      const afterAtoms = (node.children || []).filter((child): child is SmartElementNode => !isTextNode(child)).map((child) => child.id);
      if (beforeAtoms.length !== afterAtoms.length || beforeAtoms.some((id, position) => id !== afterAtoms[position])) return false;
      let offset = 0;
      entry.inlineChildren = (node.children || []).map((child) => {
        const from = offset;
        offset += isTextNode(child) ? child.text.length : 1;
        if (!isTextNode(child)) {
          const atom = index.byId.get(child.id);
          if (!atom || !update(atom, child)) return { node: child, from, to: offset };
        }
        return { node: child, from, to: offset };
      });
      return true;
    }
    const children = (node.children || []).filter((child): child is SmartElementNode => !isTextNode(child));
    if (children.length !== entry.children.length) return false;
    for (let position = 0; position < children.length; position += 1) {
      if (children[position].id !== entry.children[position].node.id || !update(entry.children[position], children[position])) return false;
    }
    return true;
  };
  if (!update(index.root, document)) return false;
  let cursor = 0;
  const reflow = (entry: Entry) => {
    entry.open = cursor++;
    entry.contentStart = cursor;
    if (entry.inlineOwner) {
      entry.inlineChildren.forEach((child) => {
        if (isTextNode(child.node)) cursor += child.node.text.length;
        else {
          const atom = index.byId.get(child.node.id);
          if (atom) {
            atom.open = cursor;
            atom.contentStart = cursor;
            atom.contentEnd = cursor + 1;
            atom.end = cursor + 1;
          }
          cursor += 1;
        }
      });
    } else if (!entry.atomic) entry.children.forEach(reflow);
    entry.contentEnd = cursor;
    entry.end = cursor++;
  };
  reflow(index.root);
  return true;
};

const limitFor = (entry: Entry) => entry.inlineOwner
  ? entry.inlineChildren.reduce((size, child) => Math.max(size, child.to), 0)
  : entry.children.length;

const nodeAroundInlineOffset = (entry: Entry, offset: number, before: boolean): SmartNode | null => {
  const children = entry.inlineChildren;
  if (before) {
    for (let index = children.length - 1; index >= 0; index -= 1) if (children[index].to <= offset) return children[index].node;
  } else {
    for (const child of children) if (child.from >= offset) return child.node;
  }
  return null;
};

/** The only place in the scope runtime that interprets stored SmartPos fields. */
const resolveEndpoint = (index: Index, pos: SmartPos): Endpoint => {
  const entry = index.byPath.get(pathKey(pos.path));
  if (!entry) throw new Error("A SmartPos path must resolve to an owning non-text node.");
  if (entry.atomic) throw new Error("A position cannot resolve inside an atomic node; address its owning container boundary.");
  const limit = limitFor(entry);
  if (!Number.isInteger(pos.offset) || pos.offset < 0 || pos.offset > limit) {
    throw new Error(`Position offset ${pos.offset} is outside 0..${limit}.`);
  }
  const ancestors: SmartElementNode[] = [];
  let cursor: Entry | null = entry;
  while (cursor) {
    ancestors.unshift(cursor.node);
    cursor = cursor.parent;
  }
  const rank = entry.inlineOwner
    ? entry.contentStart + pos.offset
    : pos.offset < entry.children.length ? entry.children[pos.offset].open : entry.contentEnd;
  const resolved: ResolvedPos = {
    pos: copyPos(pos),
    kind: entry.inlineOwner ? "inline" : "structural",
    nodeId: entry.node.id,
    parent: entry.node,
    depth: entry.depth,
    affinity: "backward",
    ancestors,
    nodeBefore: entry.inlineOwner
      ? nodeAroundInlineOffset(entry, pos.offset, true)
      : pos.offset > 0 ? entry.node.children?.[pos.offset - 1] ?? null : null,
    nodeAfter: entry.inlineOwner
      ? nodeAroundInlineOffset(entry, pos.offset, false)
      : pos.offset < limit ? entry.node.children?.[pos.offset] ?? null : null,
    atStart: pos.offset === 0,
    atEnd: pos.offset === limit,
    indexAt(depth: number) {
      if (!Number.isInteger(depth) || depth < 0 || depth >= pos.path.length) throw new Error("Position depth is out of range.");
      return pos.path[depth];
    },
  };
  cursor = entry;
  let isolation: Entry | null = null;
  while (cursor) {
    if (cursor.isolating) {
      isolation = cursor;
      break;
    }
    cursor = cursor.parent;
  }
  return { resolved, entry, rank, isolation };
};

const stablePosKey = (pos: SmartPos) => `${pos.path.map((part) => String(part).padStart(8, "0")).join(".")}:${String(pos.offset).padStart(12, "0")}`;
const normalizeSelection = (index: Index, selection: SmartSelection) => {
  const anchor = resolveEndpoint(index, selection.anchor);
  const head = resolveEndpoint(index, selection.head);
  const anchorFirst = anchor.rank < head.rank || (anchor.rank === head.rank && stablePosKey(anchor.resolved.pos) <= stablePosKey(head.resolved.pos));
  return anchorFirst
    ? { from: anchor, to: head, range: { from: copyPos(anchor.resolved.pos), to: copyPos(head.resolved.pos) } }
    : { from: head, to: anchor, range: { from: copyPos(head.resolved.pos), to: copyPos(anchor.resolved.pos) } };
};

const atomicParentSpan = (entry: Entry) => {
  if (!entry.atomic || !entry.parent) return null;
  if (entry.parent.inlineOwner) {
    const span = entry.parent.inlineChildren.find((child) => !isTextNode(child.node) && child.node.id === entry.node.id);
    return span ? { parent: entry.parent, from: span.from, to: span.to } : null;
  }
  return { parent: entry.parent, from: entry.index, to: entry.index + 1 };
};
const entryStartPos = (entry: Entry): SmartPos => {
  const atom = atomicParentSpan(entry);
  return atom ? { path: [...atom.parent.path], offset: atom.from } : { path: [...entry.path], offset: 0 };
};
const entryEndPos = (entry: Entry): SmartPos => {
  const atom = atomicParentSpan(entry);
  return atom ? { path: [...atom.parent.path], offset: atom.to } : { path: [...entry.path], offset: limitFor(entry) };
};
const afterEntryPos = (entry: Entry): SmartPos => entry.parent
  ? { path: [...entry.parent.path], offset: entry.index + 1 }
  : entryEndPos(entry);

const isAncestor = (ancestor: Entry, descendant: Entry) => {
  let cursor: Entry | null = descendant;
  while (cursor) {
    if (cursor === ancestor) return true;
    cursor = cursor.parent;
  }
  return false;
};

const outermostIsolation = (entry: Entry): Entry => {
  let result = entry;
  let cursor = entry.parent;
  while (cursor) {
    if (cursor.isolating) result = cursor;
    cursor = cursor.parent;
  }
  return result;
};

const spansIsolating = (index: Index, from: Endpoint, to: Endpoint) => {
  if (from.isolation?.node.id !== to.isolation?.node.id) return true;
  return index.entries.some((entry) => entry.isolating
    && entry.open > from.rank
    && entry.end < to.rank
    && entry !== from.isolation);
};

/**
 * Shared isolation clamp. To preserve the stronger reverse-selection invariant,
 * the active side is the normalized document-order end rather than the mutable
 * anchor/head direction. Table-grid may cross sibling cells in the same table.
 */
const clampToIsolating = (
  index: Index,
  from: Endpoint,
  to: Endpoint,
  request: ScopeRequest,
): { from: Endpoint; to: Endpoint; range: SmartRange; clamped: boolean } => {
  const crossCellGrid = request.want === "table-grid"
    && from.isolation && to.isolation
    && isTableCell(from.isolation) && isTableCell(to.isolation)
    && nearestAncestor(from.entry, isTable) === nearestAncestor(to.entry, isTable);
  if (!spansIsolating(index, from, to) || crossCellGrid) {
    return { from, to, range: { from: copyPos(from.resolved.pos), to: copyPos(to.resolved.pos) }, clamped: false };
  }
  if (to.isolation) {
    const start = resolveEndpoint(index, entryStartPos(to.isolation));
    const end = resolveEndpoint(index, entryEndPos(to.isolation));
    const clampedFrom = from.rank < start.rank ? start : from;
    const clampedTo = to.rank > end.rank ? end : to;
    return {
      from: clampedFrom,
      to: clampedTo,
      range: { from: copyPos(clampedFrom.resolved.pos), to: copyPos(clampedTo.resolved.pos) },
      clamped: true,
    };
  }
  const crossed = index.entries
    .filter((entry) => entry.isolating && entry.end > from.rank && entry.open < to.rank)
    .map(outermostIsolation)
    .filter((entry, position, all) => all.indexOf(entry) === position)
    .sort((left, right) => right.end - left.end)[0];
  if (!crossed) return { from, to, range: { from: copyPos(from.resolved.pos), to: copyPos(to.resolved.pos) }, clamped: false };
  const clampedFrom = resolveEndpoint(index, afterEntryPos(crossed));
  return {
    from: clampedFrom,
    to,
    range: { from: copyPos(clampedFrom.resolved.pos), to: copyPos(to.resolved.pos) },
    clamped: true,
  };
};

const nearestAncestor = (entry: Entry, predicate: (candidate: Entry) => boolean): Entry | null => {
  let cursor: Entry | null = entry;
  while (cursor) {
    if (predicate(cursor)) return cursor;
    cursor = cursor.parent;
  }
  return null;
};

const commonAncestor = (entries: Entry[]): Entry | null => {
  if (!entries.length) return null;
  let cursor: Entry | null = entries[0];
  while (cursor) {
    if (entries.every((entry) => isAncestor(cursor as Entry, entry))) return cursor;
    cursor = cursor.parent;
  }
  return null;
};

const baseFor = (context: ResolutionContext, isolation?: Entry | null): Omit<ScopeBase, "kind"> => ({
  range: copyRange(context.range),
  isolatingAncestorId: (isolation === undefined ? commonIsolation(context) : isolation)?.node.id ?? null,
  clamped: context.clamped,
  ...(context.clampReason ? { clampReason: context.clampReason } : {}),
});

const commonIsolation = (context: ResolutionContext): Entry | null => {
  const left = context.from.isolation;
  const right = context.to.isolation;
  return left && left === right ? left : null;
};

const emptyScope = (context: ResolutionContext): EmptyScope => ({ kind: "empty", ...baseFor(context) });
const overlaps = (entry: Entry, from: number, to: number) => entry.contentStart < to && entry.contentEnd >= from;

const containingBlock = (context: ResolutionContext, endpoint: Endpoint) => nearestAncestor(endpoint.entry, (entry) => context.index.blockSet.has(entry));

const touchedBlocks = (context: ResolutionContext): Entry[] => {
  if (context.from.rank === context.to.rank) {
    const block = containingBlock(context, context.to);
    return block ? [block] : [];
  }
  const first = containingBlock(context, context.from);
  const last = containingBlock(context, context.to);
  if (first && first === last) return [first];
  return context.index.blocks.filter((entry) => {
    if (entry.contentStart === entry.contentEnd) return entry.contentStart > context.from.rank && entry.contentStart <= context.to.rank;
    return entry.contentStart < context.to.rank && entry.contentEnd >= context.from.rank;
  });
};

const blockPart = (context: ResolutionContext, blocks: Entry[]): BlockRangeScope => {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const parents = new Set(blocks.map((entry) => entry.parent?.node.id ?? null));
  return {
    kind: "block-range",
    ...baseFor(context),
    blockIds: blocks.map((entry) => entry.node.id),
    promotedFromPartial: context.from.rank > first.contentStart || context.to.rank < last.contentEnd,
    commonParentId: parents.size === 1 ? [...parents][0] : null,
  };
};

const ownerSlice = (entry: Entry, fromRank: number, toRank: number) => ({
  from: Math.max(0, Math.min(limitFor(entry), fromRank - entry.contentStart)),
  to: Math.max(0, Math.min(limitFor(entry), toRank - entry.contentStart)),
});

const resolveInlineRange = (context: ResolutionContext): InlineRangeScope | EmptyScope => {
  const owners = context.from.entry === context.to.entry && context.from.entry.inlineOwner
    ? [context.from.entry]
    : context.index.entries.filter((entry) => entry.inlineOwner && (
    context.from.rank === context.to.rank
      ? context.from.entry === entry
      : entry.contentStart < context.to.rank && entry.contentEnd >= context.from.rank
    ));
  if (!owners.length) return emptyScope(context);
  const runs = owners.map((owner) => {
    const slice = ownerSlice(owner, context.from.rank, context.to.rank);
    return {
      ownerNodeId: owner.node.id,
      from: slice.from,
      to: slice.to,
      containsAtoms: owner.inlineChildren.some((child) => !isTextNode(child.node) && child.from < slice.to && child.to > slice.from),
    };
  });
  const collapsed = context.from.rank === context.to.rank;
  return {
    kind: "inline-range",
    ...baseFor(context),
    runs,
    collapsed,
    ...(collapsed ? { storedMarkAnchor: context.from.resolved } : {}),
  };
};

const resolveBlockRange = (context: ResolutionContext): BlockRangeScope | EmptyScope => {
  const blocks = touchedBlocks(context);
  if (!blocks.length) return emptyScope(context);
  return blockPart(context, blocks);
};

const subtreeIds = (root: Entry): string[] => {
  const result: string[] = [];
  const visit = (entry: Entry) => {
    result.push(entry.node.id);
    entry.children.forEach(visit);
    entry.inlineChildren.forEach((child) => {
      if (!isTextNode(child.node)) result.push(child.node.id);
    });
  };
  visit(root);
  return result;
};

const resolveContainerTree = (
  context: ResolutionContext,
  stopAt?: (node: SmartNode) => boolean,
): ContainerTreeScope | EmptyScope => {
  const blocks = touchedBlocks(context);
  if (!blocks.length) return emptyScope(context);
  let root = commonAncestor(blocks) ?? blocks[0];
  if (stopAt) {
    const stops = blocks.map((block) => nearestAncestor(block, (entry) => stopAt(entry.node))).filter((entry): entry is Entry => Boolean(entry));
    if (stops.length === blocks.length && stops.every((entry) => entry === stops[0])) root = stops[0];
  }
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  return {
    kind: "container-tree",
    ...baseFor(context),
    rootId: root.node.id,
    nodeIds: subtreeIds(root),
    promotedFromPartial: context.from.rank > first.contentStart || context.to.rank < last.contentEnd,
  };
};

const atomSelectedExactly = (context: ResolutionContext, atom: Entry) => {
  if (atom.group === "inline") {
    const owner = atom.parent;
    const span = owner?.inlineChildren.find((child) => !isTextNode(child.node) && child.node.id === atom.node.id);
    return Boolean(owner && span
      && context.from.entry === owner && context.to.entry === owner
      && context.from.resolved.pos.offset === span.from && context.to.resolved.pos.offset === span.to);
  }
  const parent = atom.parent;
  return Boolean(parent
    && context.from.entry === parent && context.to.entry === parent
    && context.from.resolved.pos.offset === atom.index
    && context.to.resolved.pos.offset === atom.index + 1);
};

const atomsTouched = (context: ResolutionContext) => context.from.rank === context.to.rank ? [] : context.index.atoms.filter((atom) => {
  if (atomSelectedExactly(context, atom)) return true;
  if (context.from.rank === context.to.rank) return false;
  if (atom.group === "inline") {
    const owner = atom.parent;
    const span = owner?.inlineChildren.find((child) => !isTextNode(child.node) && child.node.id === atom.node.id);
    if (!owner || !span) return false;
    const slice = ownerSlice(owner, context.from.rank, context.to.rank);
    return context.from.entry === owner || context.to.entry === owner || overlaps(owner, context.from.rank, context.to.rank)
      ? span.from < slice.to && span.to > slice.from
      : false;
  }
  return atom.open < context.to.rank && atom.end > context.from.rank;
});

const atomScope = (context: ResolutionContext, atom: Entry): AtomicNodeScope => ({
  kind: "atomic-node",
  ...baseFor(context, nearestAncestor(atom, (entry) => entry.isolating)),
  nodeId: atom.node.id,
  inline: atom.group === "inline",
});

const resolveAtomicNode = (context: ResolutionContext): AtomicNodeScope | MixedScope | EmptyScope => {
  const atoms = atomsTouched(context).filter((atom) => atomSelectedExactly(context, atom));
  if (!atoms.length) return emptyScope(context);
  if (atoms.length === 1) return atomScope(context, atoms[0]);
  return { kind: "mixed", ...baseFor(context), parts: atoms.map((atom) => atomScope(context, atom)) };
};

const touchedListItems = (context: ResolutionContext) => {
  if (context.from.rank === context.to.rank) {
    const item = nearestAncestor(context.to.entry, isListItem);
    return item ? [item] : [];
  }
  return context.index.entries.filter((entry) => isListItem(entry) && overlaps(entry, context.from.rank, context.to.rank));
};

const listDepth = (item: Entry, list: Entry) => {
  let depth = 0;
  let cursor = item.parent;
  while (cursor && cursor !== list) {
    if (isList(cursor)) depth += 1;
    cursor = cursor.parent;
  }
  return depth;
};

const listPart = (context: ResolutionContext, list: Entry, items: Entry[]): ListSelectionScope => {
  const selected = new Set(items);
  const hasChildList = (item: Entry) => context.index.entries.some((entry) => isList(entry) && entry !== list && isAncestor(item, entry));
  const partialSubtree = items.some((item) => hasChildList(item)
    && context.index.entries.some((entry) => isListItem(entry) && isAncestor(item, entry) && entry !== item && !selected.has(entry)));
  return {
    kind: "list-selection",
    ...baseFor(context),
    listId: list.node.id,
    items: items.map((item) => ({ itemId: item.node.id, depth: listDepth(item, list), hasChildList: hasChildList(item) })),
    partialSubtree,
    promotedFromPartial: context.from.rank > items[0].contentStart || context.to.rank < items[items.length - 1].contentEnd,
  };
};

const selectedListRoot = (item: Entry, selected: ReadonlySet<Entry>) => {
  let list = nearestAncestor(item.parent ?? item, isList);
  if (!list) return null;
  while (true) {
    const ownerItem = nearestAncestor(list.parent ?? list, isListItem);
    if (!ownerItem || !selected.has(ownerItem)) return list;
    const outer = nearestAncestor(ownerItem.parent ?? ownerItem, isList);
    if (!outer) return list;
    list = outer;
  }
};

const resolveListSelection = (context: ResolutionContext): ResolvedScope => {
  const items = touchedListItems(context);
  const selected = new Set(items);
  const groups = new Map<Entry, Entry[]>();
  items.forEach((item) => {
    const list = selectedListRoot(item, selected);
    if (list) groups.set(list, [...(groups.get(list) || []), item]);
  });
  const parts: Array<{ order: number; scope: ResolvedScope }> = [...groups].map(([list, listItems]) => ({
    order: list.preorder,
    scope: listPart(context, list, listItems),
  }));
  const plainBlocks = touchedBlocks(context).filter((block) => !nearestAncestor(block, isListItem));
  if (plainBlocks.length) parts.push({ order: plainBlocks[0].preorder, scope: blockPart(context, plainBlocks) });
  parts.sort((left, right) => left.order - right.order);
  if (!parts.length) return emptyScope(context);
  if (parts.length === 1) return parts[0].scope;
  return { kind: "mixed", ...baseFor(context), parts: parts.map((part) => part.scope) };
};

interface GridCell { entry: Entry; top: number; left: number; bottom: number; right: number }
interface Grid { table: Entry; cells: GridCell[]; occupancy: Array<Array<GridCell | undefined>> }

const integerAttr = (node: SmartElementNode, key: "rowspan" | "colspan") => {
  const value = node.attrs?.[key];
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
};

const buildGrid = (table: Entry): Grid => {
  const occupancy: Array<Array<GridCell | undefined>> = [];
  const cells: GridCell[] = [];
  const rows = table.children.filter(isTableRow);
  rows.forEach((row, top) => {
    occupancy[top] ||= [];
    let left = 0;
    row.children.filter(isTableCell).forEach((entry) => {
      while (occupancy[top][left]) left += 1;
      const rowspan = integerAttr(entry.node, "rowspan");
      const colspan = integerAttr(entry.node, "colspan");
      const cell = { entry, top, left, bottom: top + rowspan - 1, right: left + colspan - 1 };
      cells.push(cell);
      for (let rowIndex = cell.top; rowIndex <= cell.bottom; rowIndex += 1) {
        occupancy[rowIndex] ||= [];
        for (let column = cell.left; column <= cell.right; column += 1) occupancy[rowIndex][column] = cell;
      }
      left += colspan;
    });
  });
  return { table, cells, occupancy };
};

const endpointCell = (endpoint: Endpoint) => nearestAncestor(endpoint.entry, isTableCell);
const touchedCells = (context: ResolutionContext, table: Entry) => {
  if (context.from.rank === context.to.rank) {
    const cell = endpointCell(context.to);
    return cell && isAncestor(table, cell) ? [cell] : [];
  }
  return context.index.entries.filter((entry) => isTableCell(entry) && isAncestor(table, entry) && overlaps(entry, context.from.rank, context.to.rank));
};

const tablePart = (context: ResolutionContext, table: Entry): TableGridScope | EmptyScope => {
  const grid = buildGrid(table);
  const fromCell = endpointCell(context.from);
  const toCell = endpointCell(context.to);
  let selected: GridCell[];
  if (fromCell && toCell && context.from.resolved.pos && context.to.resolved.pos) {
    const first = grid.cells.find((cell) => cell.entry === fromCell);
    const last = grid.cells.find((cell) => cell.entry === toCell);
    if (first && last && context.from.resolved.pos && context.to.resolved.pos && fromCell !== toCell) {
      const bounds = {
        top: Math.min(first.top, last.top), left: Math.min(first.left, last.left),
        bottom: Math.max(first.bottom, last.bottom), right: Math.max(first.right, last.right),
      };
      selected = grid.cells.filter((cell) => cell.top >= bounds.top && cell.left >= bounds.left && cell.top <= bounds.bottom && cell.left <= bounds.right);
    } else selected = grid.cells.filter((cell) => touchedCells(context, table).includes(cell.entry));
  } else selected = grid.cells.filter((cell) => touchedCells(context, table).includes(cell.entry));
  if (!selected.length) return emptyScope(context);
  const rect = {
    top: Math.min(...selected.map((cell) => cell.top)),
    left: Math.min(...selected.map((cell) => cell.left)),
    bottom: Math.max(...selected.map((cell) => cell.bottom)),
    right: Math.max(...selected.map((cell) => cell.right)),
  };
  const selectedSet = new Set(selected);
  const covered = new Set<string>();
  let rectangular = true;
  for (let row = rect.top; row <= rect.bottom; row += 1) {
    for (let column = rect.left; column <= rect.right; column += 1) {
      const occupant = grid.occupancy[row]?.[column];
      if (!occupant || !selectedSet.has(occupant)) rectangular = false;
      if (occupant && (occupant.top < rect.top || occupant.left < rect.left)) covered.add(occupant.entry.node.id);
    }
  }
  if (selected.some((cell) => cell.bottom > rect.bottom || cell.right > rect.right)) rectangular = false;
  return {
    kind: "table-grid",
    ...baseFor(context, nearestAncestor(table, (entry) => entry.isolating)),
    tableId: table.node.id,
    rect,
    cellIds: selected.map((cell) => cell.entry.node.id),
    coveredCellIds: [...covered],
    rectangular,
  };
};

const resolveTableGrid = (context: ResolutionContext): TableGridScope | MixedScope | EmptyScope => {
  const tables = new Set<Entry>();
  const fromTable = nearestAncestor(context.from.entry, isTable);
  const toTable = nearestAncestor(context.to.entry, isTable);
  if (fromTable) tables.add(fromTable);
  if (toTable) tables.add(toTable);
  if (fromTable !== toTable || !fromTable) context.index.entries.forEach((entry) => {
    if (isTable(entry) && overlaps(entry, context.from.rank, context.to.rank)) tables.add(entry);
  });
  const parts = [...tables].sort((a, b) => a.preorder - b.preorder).map((table) => tablePart(context, table)).filter((part): part is TableGridScope => part.kind === "table-grid");
  if (!parts.length) return emptyScope(context);
  if (parts.length === 1) return parts[0];
  return { kind: "mixed", ...baseFor(context), parts };
};

const markKey = (mark: SmartMark) => JSON.stringify([mark.type, mark.attrs ?? null]);
const marksForRange = (context: ResolutionContext) => {
  if (context.from.rank === context.to.rank && context.from.entry.inlineOwner) {
    const offset = context.from.resolved.pos.offset;
    const child = [...context.from.entry.inlineChildren].reverse().find((candidate) => candidate.to <= offset)
      ?? context.from.entry.inlineChildren.find((candidate) => candidate.from >= offset);
    return child && isTextNode(child.node)
      ? child.node.marks?.map((mark) => ({ mark, coverage: "all" as const })) || []
      : [];
  }
  const occurrences = new Map<string, { mark: SmartMark; covered: number }>();
  let total = 0;
  context.index.entries.filter((entry) => entry.inlineOwner).forEach((owner) => {
    const slice = ownerSlice(owner, context.from.rank, context.to.rank);
    owner.inlineChildren.forEach((child) => {
      if (!isTextNode(child.node)) return;
      const width = Math.max(0, Math.min(child.to, slice.to) - Math.max(child.from, slice.from));
      if (!width) return;
      total += width;
      (child.node.marks || []).forEach((mark) => {
        const key = markKey(mark);
        const current = occurrences.get(key);
        occurrences.set(key, { mark, covered: (current?.covered || 0) + width });
      });
    });
  });
  return [...occurrences.values()].map(({ mark, covered }) => ({ mark, coverage: covered === total ? "all" as const : "partial" as const }));
};

const describeSelection = (unclamped: ResolutionContext): SelectionDescription => {
  const blocks = touchedBlocks(unclamped);
  const canonical = unclamped.to;
  const item = nearestAncestor(canonical.entry, isListItem);
  const list = item ? nearestAncestor(item.parent ?? item, isList) : null;
  const cell = endpointCell(canonical);
  const table = cell ? nearestAncestor(cell.parent ?? cell, isTable) : null;
  return {
    blockTypes: [...new Set(blocks.map((entry) => entry.node.type))],
    marks: marksForRange(unclamped),
    inList: list && item ? { listId: list.node.id, depth: listDepth(item, list) } : null,
    inTable: table && cell ? { tableId: table.node.id, cellId: cell.node.id } : null,
    isolatingAncestorId: canonical.isolation?.node.id ?? null,
    atoms: atomsTouched(unclamped).map((entry) => entry.node.id),
    collapsed: unclamped.from.rank === unclamped.to.rank,
    spansIsolatingBoundary: spansIsolating(unclamped.index, unclamped.from, unclamped.to),
  };
};

const contextFor = (
  index: Index,
  schema: SmartSchema,
  original: SmartRange,
  from: Endpoint,
  to: Endpoint,
  range: SmartRange,
  clamped: boolean,
): ResolutionContext => ({
  index,
  schema,
  original: copyRange(original),
  from,
  to,
  range: copyRange(range),
  clamped,
  ...(clamped ? { clampReason: "isolating" as const } : {}),
});

const resolveWithIndex = (
  index: Index,
  selection: SmartSelection,
  request: ScopeRequest,
  schema: SmartSchema,
): ScopeResult => {
  const normalized = normalizeSelection(index, selection);
  const unclamped = contextFor(index, schema, normalized.range, normalized.from, normalized.to, normalized.range, false);
  if (request.want === "describe") return describeSelection(unclamped);
  const clamped = clampToIsolating(index, normalized.from, normalized.to, request);
  const context = contextFor(index, schema, normalized.range, clamped.from, clamped.to, clamped.range, clamped.clamped);
  switch (request.want) {
    case "inline-range": return resolveInlineRange(context);
    case "block-range": return resolveBlockRange(context);
    case "container-tree": return resolveContainerTree(context, request.stopAt);
    case "list-selection": return resolveListSelection(context);
    case "table-grid": return resolveTableGrid(context);
    case "atomic-node": return resolveAtomicNode(context);
  }
};

const outerRange = (entry: Entry): SmartRange => {
  if (!entry.parent) return { from: entryStartPos(entry), to: entryEndPos(entry) };
  const atom = atomicParentSpan(entry);
  if (atom) return {
    from: { path: [...atom.parent.path], offset: atom.from },
    to: { path: [...atom.parent.path], offset: atom.to },
  };
  return {
    from: { path: [...entry.parent.path], offset: entry.index },
    to: { path: [...entry.parent.path], offset: entry.index + 1 },
  };
};

const lookupFor = (index: Index): PositionLookup => ({
  positionOf(nodeId: string) {
    const entry = index.byId.get(nodeId);
    if (!entry) return null;
    return resolveEndpoint(index, outerRange(entry).from).resolved;
  },
  rangeOf(nodeId: string) {
    const entry = index.byId.get(nodeId);
    return entry ? copyRange(outerRange(entry)) : null;
  },
  contentRangeOf(nodeId: string) {
    const entry = index.byId.get(nodeId);
    if (!entry) return null;
    if (entry.atomic) return copyRange(outerRange(entry));
    return { from: entryStartPos(entry), to: entryEndPos(entry) };
  },
  exists(nodeId: string) { return index.byId.has(nodeId); },
});

export class FoundationScopeIndex implements ScopeIndex {
  private document: SmartDocument | null = null;
  private schema: SmartSchema | null = null;
  private index: Index | null = null;

  private update(document: SmartDocument, schema: SmartSchema): Index {
    if (this.document === document && this.schema === schema && this.index) return this.index;
    if (this.schema === schema && this.index && refreshIndex(this.index, document, schema)) {
      this.document = document;
      return this.index;
    }
    this.document = document;
    this.schema = schema;
    this.index = buildIndex(document, schema);
    return this.index;
  }

  resolve(document: SmartDocument, selection: SmartSelection, request: ScopeRequest, schema: SmartSchema): ScopeResult {
    return resolveWithIndex(this.update(document, schema), selection, request, schema);
  }

  positions(document: SmartDocument, schema: SmartSchema): PositionLookup {
    return lookupFor(this.update(document, schema));
  }

  get liveNodeCount(): number { return this.index?.entries.length ?? 0; }
}

export const createScopeIndex = (): ScopeIndex => new FoundationScopeIndex();

export const resolveScope = (
  document: SmartDocument,
  selection: SmartSelection,
  request: ScopeRequest,
  schema: SmartSchema,
): ScopeResult => resolveWithIndex(buildIndex(document, schema), selection, request, schema);
