import { diffDocuments } from "../diff/documentDiff.js";
import type { DocumentDiff } from "../diff/types.js";
import type { SmartSchema } from "../types.js";
import type { DocumentVersion } from "./types.js";

/** Thin convenience wrapper over `diffDocuments` for the common "diff two saved versions" call shape. */
export const diffVersions = (a: DocumentVersion, b: DocumentVersion, schema: SmartSchema): DocumentDiff =>
  diffDocuments(a.envelope.document, b.envelope.document, schema);
