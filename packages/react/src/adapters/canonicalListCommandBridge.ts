import {
  applyOperations,
  createList,
  createNodeId,
  createScopeIndex,
  foundationSchema,
  enterInList,
  backspaceAtListItemStart,
  deleteAtListItemEnd,
  indentList,
  moveListItems,
  outdentList,
  parseCanonicalListHtml,
  serializeCanonicalListHtml,
  setListChecked,
  setListPreset,
  setListStyle,
  unwrapList,
  type CommandContext,
  type ListSelectionScope,
  type SmartDocument,
  type SmartElementNode,
  type SmartSelection,
  isTextNode,
} from "smartrte-core";

// MIGRATION_ADAPTER: canonical-list-dom-roundtrip owner=Phase8
// Temporary parse -> pure command -> render scaffolding. This is not the final
// editor architecture and must disappear when ClassicEditor becomes canonical-authoritative.

const semanticNodeSelector = "p,h1,h2,h3,h4,h5,h6,ul,ol,li";
const nodeId = (element: HTMLElement) => {
  element.dataset.smartId ||= createNodeId();
  return element.dataset.smartId;
};

const ensureIds = (root: HTMLElement) => {
  if (root.matches(semanticNodeSelector)) nodeId(root);
  root.querySelectorAll<HTMLElement>(semanticNodeSelector).forEach(nodeId);
};

interface DomSelectionPoint { ownerId: string; offset: number }
interface DomSelectionSnapshot { anchor: DomSelectionPoint; head: DomSelectionPoint }

const pointInOwner = (root: HTMLElement, node: Node | null, offset: number): DomSelectionPoint | null => {
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  const owner = element?.closest<HTMLElement>("p,h1,h2,h3,h4,h5,h6");
  if (!owner || !root.contains(owner)) return null;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(owner);
  try { range.setEnd(node!, offset); } catch { return null; }
  return { ownerId: nodeId(owner), offset: range.toString().length };
};

const captureSelection = (root: HTMLElement): DomSelectionSnapshot | null => {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return null;
  const anchor = pointInOwner(root, selection.anchorNode, selection.anchorOffset);
  const head = pointInOwner(root, selection.focusNode, selection.focusOffset);
  return anchor && head ? { anchor, head } : null;
};

const textPoint = (owner: HTMLElement, requested: number): { node: Node; offset: number } => {
  const walker = owner.ownerDocument.createTreeWalker(owner, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, requested);
  let node = walker.nextNode();
  let last: Text | null = null;
  while (node) {
    const text = node as Text;
    if (remaining <= text.data.length) return { node: text, offset: remaining };
    remaining -= text.data.length;
    last = text;
    node = walker.nextNode();
  }
  return last ? { node: last, offset: last.data.length } : { node: owner, offset: 0 };
};

const restoreSelection = (root: HTMLElement, snapshot: DomSelectionSnapshot | null) => {
  if (!snapshot) return;
  const byId = (id: string) => Array.from(root.querySelectorAll<HTMLElement>("[data-smart-id]"))
    .find((element) => element.dataset.smartId === id) || null;
  const anchorOwner = byId(snapshot.anchor.ownerId);
  const headOwner = byId(snapshot.head.ownerId);
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!anchorOwner || !headOwner || !selection) return;
  const anchor = textPoint(anchorOwner, snapshot.anchor.offset);
  const head = textPoint(headOwner, snapshot.head.offset);
  selection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
};

const contextFor = (document: SmartDocument): CommandContext => ({
  schema: foundationSchema,
  positions: createScopeIndex().positions(document, foundationSchema),
});

const listDepth = (item: HTMLElement) => {
  let depth = 0;
  let list = item.parentElement?.closest<HTMLElement>("ul,ol") || null;
  while (list) {
    depth += 1;
    list = list.parentElement?.closest<HTMLElement>("li")?.parentElement?.closest<HTMLElement>("ul,ol") || null;
  }
  return Math.max(0, depth - 1);
};

const scopeForItems = (list: HTMLElement, items: readonly HTMLElement[]): ListSelectionScope => ({
  kind: "list-selection",
  listId: nodeId(list),
  items: items.map((item) => ({
    itemId: nodeId(item), depth: listDepth(item), hasChildList: Boolean(item.querySelector(":scope > ul,:scope > ol")),
  })),
  partialSubtree: false,
  promotedFromPartial: false,
  range: { from: { path: [], offset: 0 }, to: { path: [], offset: 0 } },
  isolatingAncestorId: null,
  clamped: false,
});

const outerList = (item: HTMLElement) => {
  let list = item.parentElement as HTMLElement;
  while (list.parentElement?.closest("li")?.parentElement?.matches("ul,ol")) {
    list = list.parentElement.closest("li")!.parentElement as HTMLElement;
  }
  return list;
};

const replaceOuterList = (root: HTMLElement, outer: HTMLElement, document: SmartDocument, selection: DomSelectionSnapshot | null) => {
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = serializeCanonicalListHtml(document, { fragment: true });
  outer.replaceWith(template.content);
  restoreSelection(root, selection);
};

const runByOuterList = (
  root: HTMLElement,
  selected: readonly HTMLElement[],
  execute: (document: SmartDocument, scope: ListSelectionScope, ctx: CommandContext, hierarchyRootId: string) => ReturnType<typeof applyOperations> | null,
) => {
  if (!selected.length) return false;
  selected.forEach((item) => {
    const list = item.parentElement;
    if (!list?.matches("ul,ol")) return;
    Array.from(list.children).forEach((child) => {
      if (child instanceof HTMLElement && child.matches("ul,ol")) {
        const previous = child.previousElementSibling;
        if (previous instanceof HTMLElement && previous.tagName === "LI") previous.appendChild(child);
      }
    });
  });
  ensureIds(root);
  const selection = captureSelection(root);
  const groups = new Map<HTMLElement, HTMLElement[]>();
  selected.forEach((item) => {
    const outer = outerList(item);
    groups.set(outer, [...(groups.get(outer) || []), item]);
  });
  let changed = false;
  groups.forEach((items, outer) => {
    const source = parseCanonicalListHtml(outer.outerHTML);
    let document = source;
    const byList = new Map<HTMLElement, HTMLElement[]>();
    items.forEach((item) => {
      const list = item.parentElement!;
      byList.set(list, [...(byList.get(list) || []), item]);
    });
    let groupChanged = false;
    const listGroups = [...byList.entries()].sort(([listA], [listB]) => listDepth(listB) - listDepth(listA));
    listGroups.forEach(([list, directItems]) => {
      const hierarchyRootId = byList.size > 1 ? nodeId(outer) : nodeId(list);
      const result = execute(document, scopeForItems(list, directItems), contextFor(document), hierarchyRootId);
      if (result && result !== document) { document = result; changed = true; groupChanged = true; }
    });
    if (groupChanged) replaceOuterList(root, outer, document, selection);
  });
  return changed;
};

const mergeCompatibleDomLists = (root: HTMLElement) => {
  const lists = Array.from(root.querySelectorAll<HTMLElement>("ul,ol"));
  lists.forEach((list) => {
    let next = list.nextElementSibling as HTMLElement | null;
    while (next?.tagName === list.tagName) {
      const following = next.nextElementSibling as HTMLElement | null;
      while (next.firstChild) list.appendChild(next.firstChild);
      next.remove();
      next = following;
    }
  });
};

const scopesForAllLists = (document: SmartDocument): Array<{ scope: ListSelectionScope; depth: number }> => {
  const output: Array<{ scope: ListSelectionScope; depth: number }> = [];
  const visit = (node: SmartElementNode, depth: number) => {
    if (node.type === "list") {
      output.push({
        depth,
        scope: {
          kind: "list-selection", listId: node.id,
          items: (node.children || []).filter((child): child is SmartElementNode => !isTextNode(child))
            .map((item) => ({ itemId: item.id, depth, hasChildList: (item.children || []).some((child) => !isTextNode(child) && child.type === "list") })),
          partialSubtree: false, promotedFromPartial: false,
          range: { from: { path: [], offset: 0 }, to: { path: [], offset: 0 } },
          isolatingAncestorId: null, clamped: false,
        },
      });
    }
    (node.children || []).forEach((child) => { if (!isTextNode(child)) visit(child, node.type === "list_item" && child.type === "list" ? depth + 1 : depth); });
  };
  document.children.forEach((child) => { if (!isTextNode(child)) visit(child, 0); });
  return output;
};

const scopesFromList = (document: SmartDocument, rootListId: string) => {
  const all = scopesForAllLists(document);
  const root = all.find((entry) => entry.scope.listId === rootListId);
  if (!root) return [];
  const index = createScopeIndex().positions(document, foundationSchema);
  return all.filter((entry) => {
    const resolved = index.positionOf(entry.scope.listId);
    return entry.scope.listId === rootListId || Boolean(resolved?.ancestors.some((ancestor) => ancestor.id === rootListId));
  }).map((entry) => ({ ...entry, depth: entry.depth - root.depth }));
};

export const executeCanonicalListDepth = (
  root: HTMLElement,
  items: readonly HTMLElement[],
  direction: "indent" | "outdent",
) => runByOuterList(root, items, (document, scope, ctx) => {
  const operations = direction === "indent"
    ? indentList(document, scope, { nestedListIds: [createNodeId()] }, ctx)
    : outdentList(document, scope, { splitListIds: [createNodeId()] }, ctx);
  return operations.length ? applyOperations(document, operations) : null;
});

export const executeCanonicalListMove = (
  root: HTMLElement,
  items: readonly HTMLElement[],
  direction: "up" | "down",
) => runByOuterList(root, items, (document, scope, ctx) => {
  const operations = moveListItems(document, scope, { direction }, ctx);
  return operations.length ? applyOperations(document, operations) : null;
});

export const executeCanonicalListStyle = (args: {
  root: HTMLElement;
  items: readonly HTMLElement[];
  style?: string;
  preset?: string;
  checkable?: boolean;
}) => runByOuterList(args.root, args.items, (document, selectedScope, _ctx, hierarchyRootId) => {
  const stylesForDepth = (rootStyle: string | undefined, depth: number) => {
    const sequence = rootStyle === "upper-alpha" ? ["upper-alpha", "lower-alpha", "lower-roman"]
      : rootStyle === "upper-roman" ? ["upper-roman", "upper-alpha", "decimal"]
      : rootStyle === "lower-alpha" ? ["lower-alpha", "lower-alpha", "lower-roman"]
      : rootStyle === "lower-roman" ? ["lower-roman", "lower-roman", "lower-alpha"]
      : rootStyle === "decimal-leading-zero" ? ["decimal-leading-zero", "lower-alpha", "lower-roman"]
      : rootStyle === "decimal" ? ["decimal", "lower-alpha", "lower-roman"]
      : rootStyle === "circle" ? ["circle", "square", "disc"]
      : rootStyle === "square" ? ["square", "circle", "disc"]
      : rootStyle === "disc" ? ["disc", "circle", "square"]
      : [rootStyle];
    return sequence[Math.min(depth, sequence.length - 1)];
  };
  let next = document;
  for (const { scope, depth } of scopesFromList(document, hierarchyRootId || selectedScope.listId)) {
    const style = stylesForDepth(args.style, depth);
    const operations = args.preset !== undefined
      ? setListPreset(next, scope, { preset: args.preset }, contextFor(next))
      : setListStyle(next, scope, { style, checkable: args.checkable }, contextFor(next));
    if (operations.length) next = applyOperations(next, operations);
  }
  return next === document ? null : next;
});

export const executeCanonicalListCheck = (
  root: HTMLElement,
  item: HTMLElement,
  checked: boolean,
) => {
  ensureIds(root);
  const outer = outerList(item);
  const document = parseCanonicalListHtml(outer.outerHTML);
  const scope = scopeForItems(item.parentElement!, [item]);
  const ctx = contextFor(document);
  const operations = setListChecked(document, scope, { checked }, ctx);
  if (!operations.length) return false;
  applyOperations(document, operations);
  item.dataset.smartChecked = String(checked);
  item.dataset.checked = String(checked);
  return true;
};

export const executeCanonicalListToggle = (args: {
  root: HTMLElement;
  items: readonly HTMLElement[];
  blocks: readonly HTMLElement[];
  listTag: "ul" | "ol";
  range?: Range;
  style?: string;
  preset?: string;
  checkable?: boolean;
}) => {
  const style = args.style || (args.listTag === "ol" ? "decimal" : "disc");
  let changed = false;
  if (args.items.length) {
    const hasPlainBlocks = args.blocks.some((block) => !block.closest("ul,ol"));
    const togglingOff = !hasPlainBlocks && args.items.every((item) => item.parentElement?.tagName.toLowerCase() === args.listTag);
    changed = runByOuterList(args.root, args.items, (document, scope, ctx) => {
      if (togglingOff) {
        const operations = unwrapList(document, scope, { splitListIds: [createNodeId()] }, ctx);
        return operations.length ? applyOperations(document, operations) : null;
      }
      let next = document;
      const rootScope = args.blocks.length ? scopesForAllLists(document)[0]?.scope : scope;
      if (!rootScope) return null;
      for (const { scope: descendant, depth } of scopesFromList(document, rootScope.listId)) {
        const descendantStyle = style === "decimal" ? ["decimal", "lower-alpha", "lower-roman"][Math.min(depth, 2)]
          : style === "disc" ? ["disc", "circle", "square"][Math.min(depth, 2)]
            : style;
        const operations = args.preset !== undefined
          ? setListPreset(next, descendant, { preset: args.preset }, contextFor(next))
          : setListStyle(next, descendant, { style: descendantStyle, checkable: args.checkable ?? false }, contextFor(next));
        if (operations.length) next = applyOperations(next, operations);
      }
      return next === document ? null : next;
    }) || changed;
  }
  const plain = args.blocks.filter((block) => !block.closest("ul,ol") && block.matches("p,h1,h2,h3,h4,h5,h6"));
  if (plain.length) {
    ensureIds(args.root);
    const selection = captureSelection(args.root);
    const groups = new Map<HTMLElement, HTMLElement[]>();
    plain.forEach((block) => {
      const parent = block.parentElement;
      if (parent) groups.set(parent, [...(groups.get(parent) || []), block]);
    });
    groups.forEach((blocks) => {
      const source = parseCanonicalListHtml(blocks.map((block) => block.outerHTML).join(""));
      const blockIds = source.children.filter((node): node is SmartElementNode => node.type !== "text").map((node) => node.id);
      const scope = {
        kind: "block-range" as const, blockIds, promotedFromPartial: true, commonParentId: source.id,
        range: { from: { path: [], offset: 0 }, to: { path: [], offset: blockIds.length } }, isolatingAncestorId: null, clamped: false,
      };
      const operations = createList(source, scope, {
        listIds: [createNodeId()], itemIds: blockIds.map(() => createNodeId()),
        ...(args.preset !== undefined ? { preset: args.preset } : { style }),
        ...(args.checkable !== undefined ? { checkable: args.checkable } : {}),
      }, contextFor(source));
      if (!operations.length) return;
      const output = applyOperations(source, operations);
      const template = args.root.ownerDocument.createElement("template");
      template.innerHTML = serializeCanonicalListHtml(output, { fragment: true });
      blocks[0].before(template.content);
      blocks.forEach((block) => block.remove());
      changed = true;
    });
    restoreSelection(args.root, selection);
  }
  if (!plain.length && args.range && !args.range.collapsed) {
    const startElement = args.range.startContainer instanceof HTMLElement ? args.range.startContainer : args.range.startContainer.parentElement;
    const endElement = args.range.endContainer instanceof HTMLElement ? args.range.endContainer : args.range.endContainer.parentElement;
    const startCell = startElement?.closest<HTMLElement>("td,th") || null;
    const endCell = endElement?.closest<HTMLElement>("td,th") || null;
    const container = startCell && startCell === endCell ? startCell : args.root;
    const directChild = (node: Node): ChildNode | null => {
      let current: Node | null = node;
      while (current?.parentNode && current.parentNode !== container) current = current.parentNode;
      return current?.parentNode === container ? current as ChildNode : null;
    };
    const start = directChild(args.range.startContainer);
    const end = directChild(args.range.endContainer);
    if (start && end) {
      const nodes = Array.from(container.childNodes);
      let first = nodes.indexOf(start);
      let last = nodes.indexOf(end);
      if (start instanceof HTMLElement && start.matches("ul,ol")) first += 1;
      while (first <= last && nodes[first] instanceof HTMLBRElement) first += 1;
      while (first > 0 && !(nodes[first - 1] instanceof HTMLBRElement)) first -= 1;
      while (last + 1 < nodes.length && !(nodes[last + 1] instanceof HTMLBRElement)) last += 1;
      if (first > last || nodes.slice(first, last + 1).some((node) => node instanceof HTMLElement && node.matches("p,h1,h2,h3,h4,h5,h6,ul,ol,table"))) {
        if (changed) mergeCompatibleDomLists(args.root);
        return changed;
      }
      const expanded = container.ownerDocument.createRange();
      expanded.setStartBefore(nodes[first]);
      expanded.setEndAfter(nodes[last]);
      const fragment = expanded.extractContents();
      const parts: Node[][] = [[]];
      Array.from(fragment.childNodes).forEach((node) => {
        if (node instanceof HTMLBRElement) parts.push([]);
        else parts[parts.length - 1].push(node);
      });
      const wrapper = container.ownerDocument.createElement("div");
      parts.filter((part) => part.some((node) => node.textContent?.length || node instanceof HTMLElement)).forEach((part) => {
        const paragraph = container.ownerDocument.createElement("p");
        paragraph.append(...part);
        wrapper.appendChild(paragraph);
      });
      const source = parseCanonicalListHtml(wrapper.innerHTML);
      const blockIds = source.children.filter((node): node is SmartElementNode => !isTextNode(node)).map((node) => node.id);
      if (blockIds.length) {
        const scope = {
          kind: "block-range" as const, blockIds, promotedFromPartial: true, commonParentId: source.id,
          range: { from: { path: [], offset: 0 }, to: { path: [], offset: blockIds.length } }, isolatingAncestorId: null, clamped: false,
        };
        const operations = createList(source, scope, {
          listIds: [createNodeId()], itemIds: blockIds.map(() => createNodeId()),
          ...(args.preset !== undefined ? { preset: args.preset } : { style }),
          ...(args.checkable !== undefined ? { checkable: args.checkable } : {}),
        }, contextFor(source));
        const output = applyOperations(source, operations);
        const template = container.ownerDocument.createElement("template");
        template.innerHTML = serializeCanonicalListHtml(output, { fragment: true });
        expanded.insertNode(template.content);
        const before = nodes[first - 1];
        if (before instanceof HTMLBRElement && before.previousElementSibling?.matches("ul,ol")) before.remove();
        changed = true;
      }
    }
  }
  if (changed) mergeCompatibleDomLists(args.root);
  return changed;
};

export interface CanonicalListBridgeResult {
  readonly changed: boolean;
  readonly selection: SmartSelection | null;
}

export const executeCanonicalListStructuralInput = (
  root: HTMLElement,
  input: "enter" | "backspace" | "delete",
): boolean => {
  ensureIds(root);
  const native = root.ownerDocument.defaultView?.getSelection();
  if (!native?.isCollapsed || !native.anchorNode) return false;
  const element = native.anchorNode instanceof HTMLElement ? native.anchorNode : native.anchorNode.parentElement;
  const owner = element?.closest<HTMLElement>("p,h1,h2,h3,h4,h5,h6");
  const item = owner?.closest<HTMLElement>("li");
  if (!owner || !item || !root.contains(item)) return false;
  const snapshot = pointInOwner(root, native.anchorNode, native.anchorOffset);
  if (!snapshot) return false;
  const outer = outerList(item);
  const document = parseCanonicalListHtml(outer.outerHTML);
  const ctx = contextFor(document);
  const ownerId = nodeId(owner);
  const content = ctx.positions.contentRangeOf(ownerId);
  if (!content) return false;
  const pos = { path: [...content.from.path], offset: snapshot.offset };
  const result = input === "enter"
    ? enterInList(document, pos, {
      itemId: createNodeId(), blockId: createNodeId(), emptyBlockId: createNodeId(),
    }, ctx)
    : input === "backspace"
      ? backspaceAtListItemStart(document, pos, ctx)
      : deleteAtListItemEnd(document, pos, ctx);
  if (!result?.operations.length) return false;
  const output = applyOperations(document, result.operations);
  const targetContent = contextFor(output).positions.contentRangeOf(result.selectionTarget.ownerId);
  const targetOffset = targetContent
    ? Math.min(result.selectionTarget.offset, targetContent.to.offset)
    : 0;
  replaceOuterList(root, outer, output, {
    anchor: { ownerId: result.selectionTarget.ownerId, offset: targetOffset },
    head: { ownerId: result.selectionTarget.ownerId, offset: targetOffset },
  });
  return true;
};
