import { isTextNode } from "../identity.js";
import { detectClipboardSource } from "./detection.js";
import { estimateClipboardPayloadBytes } from "./pipeline.js";
import type { ClipboardFragment, ClipboardSource, RawClipboardPayload } from "./types.js";
import type { SmartNode } from "../types.js";

export interface ClipboardStructuralShape {
  readonly nodeCounts: Readonly<Record<string, number>>;
  readonly maxDepth: number;
  readonly textCodeUnits: number;
}

export interface ClipboardDiagnosticReport {
  readonly version: 1;
  /** Stable correlation key over the payload bytes; raw content is never included. */
  readonly fixtureHash: string;
  readonly detectedSource: ClipboardSource;
  readonly detectionSignals: readonly string[];
  readonly mimeTypes: readonly string[];
  readonly inputBytes: number;
  readonly status: "parsed" | "rejected";
  readonly structuralShape: ClipboardStructuralShape | null;
  /** Normalizer IDs and schema repair codes only; never messages/before/after values. */
  readonly repairs: readonly string[];
  readonly failureCode?: "payload-too-large" | "parse-failed";
}

const hashPayload = (payload: RawClipboardPayload): string => {
  const entries = payload.representations
    ? Object.entries(payload.representations)
    : [["text/html", payload.html || ""], ["text/plain", payload.plainText || ""], ["native", payload.native || ""]];
  let hash = 2166136261;
  entries.sort(([left], [right]) => left.localeCompare(right)).forEach(([type, value]) => {
    const input = `${type}\0${value.length}\0${value}`;
    for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  });
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const shapeOf = (root: SmartNode): ClipboardStructuralShape => {
  const nodeCounts: Record<string, number> = {};
  let maxDepth = 0;
  let textCodeUnits = 0;
  const visit = (node: SmartNode, depth: number) => {
    nodeCounts[node.type] = (nodeCounts[node.type] || 0) + 1;
    maxDepth = Math.max(maxDepth, depth);
    if (isTextNode(node)) textCodeUnits += node.text.length;
    else (node.children || []).forEach((child) => visit(child, depth + 1));
  };
  visit(root, 0);
  return { nodeCounts, maxDepth, textCodeUnits };
};

const repairCodes = (fragment: ClipboardFragment): string[] => fragment.repairs.map((entry) =>
  typeof entry === "string" ? entry : entry.code);

const baseReport = (payload: RawClipboardPayload) => {
  const detection = detectClipboardSource(payload);
  return {
    version: 1 as const,
    fixtureHash: hashPayload(payload),
    detectedSource: detection.source,
    detectionSignals: detection.signals,
    mimeTypes: [...new Set(payload.types || Object.keys(payload.representations || {}))].sort(),
    inputBytes: estimateClipboardPayloadBytes(payload),
  };
};

/** Produces a telemetry-safe shape report containing no clipboard text, HTML, IDs, or attributes. */
export const reportParsedClipboard = (
  payload: RawClipboardPayload,
  fragment: ClipboardFragment,
): ClipboardDiagnosticReport => ({
  ...baseReport(payload),
  status: "parsed",
  structuralShape: shapeOf(fragment.document),
  repairs: repairCodes(fragment),
});

/** Produces a telemetry-safe rejection report without exposing an exception message. */
export const reportRejectedClipboard = (
  payload: RawClipboardPayload,
  error: unknown,
): ClipboardDiagnosticReport => ({
  ...baseReport(payload),
  status: "rejected",
  structuralShape: null,
  repairs: [],
  failureCode: error instanceof Error && error.name === "ClipboardPayloadTooLargeError"
    ? "payload-too-large"
    : "parse-failed",
});
