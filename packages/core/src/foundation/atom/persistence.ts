import { isTextNode } from "../identity.js";
import type { PersistedEditorDocument, SmartNode } from "../types.js";

export const assertNoBlobAtomUrls = (envelope: PersistedEditorDocument): void => {
  const visit = (node: SmartNode) => {
    if (isTextNode(node)) return;
    for (const key of ["src", "poster"] as const) {
      if (typeof node.attrs?.[key] === "string" && /^blob:/i.test(node.attrs[key] as string)) {
        throw new Error(`Cannot persist transient blob URL from ${node.type}.${key}.`);
      }
    }
    node.children?.forEach(visit);
  };
  visit(envelope.document);
};

export const serializePersistedEditorDocument = (envelope: PersistedEditorDocument): string => {
  assertNoBlobAtomUrls(envelope);
  return JSON.stringify(envelope);
};

