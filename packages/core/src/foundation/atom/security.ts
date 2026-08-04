import { sanitizeResourceUrl } from "../security/urlPolicy.js";
import type { AtomDeclaration } from "./types.js";

export const SAFE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);
const SAFE_IMAGE_DATA_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
export const SAFE_AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm"]);
export const SAFE_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/ogg"]);

export const validateAtomMime = (kind: AtomDeclaration["kind"], mime: string): boolean => {
  const normalized = mime.trim().toLowerCase().split(";", 1)[0];
  if (kind === "image") return SAFE_IMAGE_MIME_TYPES.has(normalized);
  if (kind === "audio") return SAFE_AUDIO_MIME_TYPES.has(normalized);
  if (kind === "video") return SAFE_VIDEO_MIME_TYPES.has(normalized);
  return false;
};

export const sanitizeAtomSource = (
  value: string | undefined,
  options: { kind: AtomDeclaration["kind"]; allowBlobPreview?: boolean } ,
): string | null => sanitizeResourceUrl(value, {
  allowBlob: options.allowBlobPreview === true,
  allowedDataMimeTypes: options.kind === "image" ? SAFE_IMAGE_DATA_MIME_TYPES : new Set<string>(),
});

export const safeFormulaSource = (source: unknown): source is string =>
  typeof source === "string" && source.length > 0 && source.length <= 100_000 && !/[\u0000]/.test(source);
