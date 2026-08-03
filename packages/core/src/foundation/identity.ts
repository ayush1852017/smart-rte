import type { SmartDocument, SmartNode } from "./types.js";

export const createNodeId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) throw new Error("A cryptographically secure random source is required for node IDs.");
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};

export const isTextNode = (node: SmartNode): node is Extract<SmartNode, { type: "text" }> =>
  node.type === "text";

export const cloneNode = <T extends SmartNode>(node: T): T => structuredClone(node);

export const collectNodeIds = (document: SmartDocument): string[] => {
  const result: string[] = [];
  const visit = (node: SmartNode) => {
    if (isTextNode(node)) return;
    result.push(node.id);
    node.children?.forEach(visit);
  };
  visit(document);
  return result;
};

export const assertUniqueNodeIds = (document: SmartDocument): void => {
  const ids = collectNodeIds(document);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate live node id in document.");
};
