import { applyOperation } from "./operations.js";
import { nodeAtPath } from "./positions.js";
import { repair, validate } from "./schema.js";
import type { NormalizerRegistration, SmartDocument, SmartOperation, SmartSchema } from "./types.js";

/**
 * Normalization is deterministic, idempotent, terminating, and scoped to the
 * smallest affected ancestor unless a document-wide invariant requires otherwise.
 */
export const NORMALIZATION_PASS_CAP = 3;

const commonPrefix = (paths: readonly (readonly number[])[]) => {
  if (!paths.length) return [];
  const result: number[] = [];
  for (let index = 0; index < Math.min(...paths.map((path) => path.length)); index += 1) {
    if (!paths.every((path) => path[index] === paths[0][index])) break;
    result.push(paths[0][index]);
  }
  return result;
};

const operationPaths = (operation: SmartOperation): number[][] => {
  if (operation.type === "moveNode") return [operation.from.path, operation.to.path];
  if (operation.type === "addMark" || operation.type === "removeMark") return [operation.range.from.path, operation.range.to.path];
  return [operation.pos.path];
};

/** Paths whose existing content an emitted repair changes. Node operations
 * address their parent plus a child offset, unlike text operations whose path
 * already addresses the inline owner. */
const repairedContentPaths = (operation: SmartOperation): number[][] => {
  if (operation.type === "replaceNode" || operation.type === "removeNode") {
    return [[...operation.pos.path, operation.pos.offset]];
  }
  return operationPaths(operation);
};

export const smallestAffectedAncestor = (operations: readonly SmartOperation[]): number[] =>
  commonPrefix(operations.flatMap(operationPaths));

export interface NormalizationRun {
  document: SmartDocument;
  operations: SmartOperation[];
  affectedPath: number[];
  passes: number;
  fullDocumentTraversals: number;
  ranNormalizers: string[];
}

const structuralRepairOperations = (
  before: SmartDocument,
  after: SmartDocument,
  affectedPath: readonly number[],
): SmartOperation[] => {
  if (affectedPath.length) {
    const beforeNode = nodeAtPath(before, affectedPath);
    const afterNode = nodeAtPath(after, affectedPath);
    if (beforeNode && afterNode && JSON.stringify(beforeNode) !== JSON.stringify(afterNode)) {
      return [{
        type: "replaceNode",
        pos: { path: affectedPath.slice(0, -1), offset: affectedPath[affectedPath.length - 1] },
        before: beforeNode,
        after: afterNode,
      }];
    }
  }
  const operations: SmartOperation[] = [];
  const shared = Math.min(before.children.length, after.children.length);
  for (let index = 0; index < shared; index += 1) {
    if (JSON.stringify(before.children[index]) !== JSON.stringify(after.children[index])) {
      operations.push({ type: "replaceNode", pos: { path: [], offset: index }, before: before.children[index], after: after.children[index] });
    }
  }
  for (let index = before.children.length - 1; index >= after.children.length; index -= 1) {
    operations.push({ type: "removeNode", pos: { path: [], offset: index }, node: before.children[index] });
  }
  for (let index = shared; index < after.children.length; index += 1) {
    operations.push({ type: "insertNode", pos: { path: [], offset: index }, node: after.children[index] });
  }
  return operations;
};

export const runNormalization = (options: {
  document: SmartDocument;
  originatingOperations: readonly SmartOperation[];
  schema: SmartSchema;
  normalizers?: readonly NormalizerRegistration[];
  onDocumentWideRun?: (normalizerId: string) => void;
}): NormalizationRun => {
  const affectedPath = smallestAffectedAncestor(options.originatingOperations);
  let document = options.document;
  const appended: SmartOperation[] = [];
  let fullDocumentTraversals = 0;
  const ranNormalizers: string[] = [];
  const registrations = (options.normalizers || [])
    .map((normalizer, registrationOrder) => ({ normalizer, registrationOrder }))
    .sort((left, right) => left.normalizer.priority - right.normalizer.priority || left.registrationOrder - right.registrationOrder);

  for (let pass = 0; pass < NORMALIZATION_PASS_CAP; pass += 1) {
    const changedBy: string[] = [];
    // Structural schema repair always precedes registered normalizers. For a
    // valid operation sequence this is a no-op; invalid output fails loudly
    // rather than allowing an unrecorded whole-document mutation.
    const textOnly = options.originatingOperations.every((operation) =>
      operation.type === "insertText" || operation.type === "deleteText" || operation.type === "addMark" || operation.type === "removeMark");
    if (!textOnly) {
      const structural = repair(document, options.schema);
      if (structural.repairs.length) {
        const repairs = structuralRepairOperations(document, structural.doc, affectedPath);
        if (!repairs.length) throw new Error(`Schema repair could not be represented as operations: ${structural.repairs[0].message}`);
        repairs.forEach((operation) => {
          document = applyOperation(document, operation);
          appended.push(operation);
        });
        changedBy.push("schema");
      }
    }
    for (const { normalizer } of registrations) {
      const documentWide = normalizer.documentWide === true;
      if (documentWide) {
        fullDocumentTraversals += 1;
        options.onDocumentWideRun?.(normalizer.id);
      } else if (affectedPath.length && !nodeAtPath(document, affectedPath)) {
        throw new Error(`Affected normalization path for "${normalizer.id}" no longer exists.`);
      }
      ranNormalizers.push(normalizer.id);
      const result = normalizer.normalize(document, {
        schema: options.schema,
        affectedPath,
        pass,
        documentWide,
      });
      for (const operation of result.operations) {
        const paths = repairedContentPaths(operation);
        if (!documentWide && affectedPath.length && paths.some((path) =>
          !affectedPath.every((part, index) => path[index] === part))) {
          throw new Error(`Normalizer "${normalizer.id}" emitted an operation outside the affected subtree.`);
        }
        document = applyOperation(document, operation);
        appended.push(operation);
        changedBy.push(normalizer.id);
      }
    }
    if (!changedBy.length) {
      if (!textOnly) {
        const errors = validate(document, options.schema);
        if (errors.length) throw new Error(`Normalization produced invalid content: ${errors[0].message}`);
      }
      return { document, operations: appended, affectedPath, passes: pass + 1, fullDocumentTraversals, ranNormalizers };
    }
    if (pass === NORMALIZATION_PASS_CAP - 1) {
      throw new Error(`Normalization exceeded ${NORMALIZATION_PASS_CAP} passes; oscillating normalizers: ${[...new Set(changedBy)].join(", ")}.`);
    }
  }
  throw new Error("Unreachable normalization state.");
};
