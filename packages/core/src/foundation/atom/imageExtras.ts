/**
 * Block-image captions and host-defined metadata (1.2.0). Shared by the
 * schema (shape validation), the HTML parser (normalisation on import), the
 * exporters and the React insert/edit paths, so every entry point agrees on
 * what a valid caption or metadata entry is.
 *
 * Both are `block_image`-only: a caption under an image that sits inside a
 * line of text has no layout meaning, and keeping the inline `image` node
 * unchanged keeps the risk of this feature contained.
 */

export const IMAGE_CAPTION_MAX_LENGTH = 500;
export const IMAGE_METADATA_MAX_ENTRIES = 10;
export const IMAGE_METADATA_MAX_NAME_LENGTH = 40;
export const IMAGE_METADATA_MAX_VALUE_LENGTH = 500;

// C0/C1 control characters other than the whitespace ones collapsed below.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Plain text, control characters stripped, whitespace collapsed to single
 * spaces, trimmed, capped at IMAGE_CAPTION_MAX_LENGTH. Returns `undefined`
 * for anything that normalises to empty, so callers delete the attribute
 * instead of storing `""` (an absent caption must export byte-identically
 * to a pre-1.2 document).
 */
export const normalizeImageCaption = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(CONTROL_CHARACTERS, "").replace(/\s+/g, " ").trim().slice(0, IMAGE_CAPTION_MAX_LENGTH).trim();
  return normalized || undefined;
};

/** Schema check: only an already-normalised, non-empty caption is valid. */
export const isValidImageCaption = (value: unknown): boolean =>
  typeof value === "string" && value.length > 0 && normalizeImageCaption(value) === value;

const METADATA_NAME = /^data-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `data-*` in lowercase kebab-case, at most 40 characters, never in the reserved `data-smart-` namespace. */
export const isValidImageMetadataName = (name: unknown): name is string =>
  typeof name === "string" && name.length <= IMAGE_METADATA_MAX_NAME_LENGTH
  && METADATA_NAME.test(name) && !name.startsWith("data-smart-");

/**
 * Schema check for `block_image.attrs.metadata`. Shape only - the schema is
 * static, so it cannot know a host's allowlist. Allowlist enforcement lives
 * at the entry points (parser option, insertImage).
 */
export const isValidImageMetadata = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.length <= IMAGE_METADATA_MAX_ENTRIES
    && entries.every(([name, entry]) => isValidImageMetadataName(name)
      && typeof entry === "string" && entry.length <= IMAGE_METADATA_MAX_VALUE_LENGTH);
};

export interface ImageMetadataAllowlist {
  readonly names: readonly string[];
  readonly rejected: readonly string[];
}

/**
 * Validates a host-supplied `imageMetadataAttributes` list: invalid names
 * are dropped (reported in `rejected` so the caller can warn), duplicates
 * collapse, and at most IMAGE_METADATA_MAX_ENTRIES names are kept.
 */
export const normalizeImageMetadataAllowlist = (names: readonly unknown[] | undefined): ImageMetadataAllowlist => {
  const accepted: string[] = [];
  const rejected: string[] = [];
  (names || []).forEach((name) => {
    if (!isValidImageMetadataName(name)) { rejected.push(String(name)); return; }
    if (accepted.includes(name)) return;
    if (accepted.length >= IMAGE_METADATA_MAX_ENTRIES) { rejected.push(name); return; }
    accepted.push(name);
  });
  return { names: accepted, rejected };
};

/**
 * Keeps only allowlisted names with string values, truncating each value to
 * IMAGE_METADATA_MAX_VALUE_LENGTH. Returns `undefined` when nothing
 * survives, so the attribute is omitted rather than stored as `{}`.
 */
export const filterImageMetadata = (
  read: (name: string) => unknown,
  allowlist: readonly string[],
): Record<string, string> | undefined => {
  const output: Record<string, string> = {};
  allowlist.forEach((name) => {
    if (!isValidImageMetadataName(name)) return;
    const value = read(name);
    if (typeof value === "string") output[name] = value.slice(0, IMAGE_METADATA_MAX_VALUE_LENGTH);
  });
  return Object.keys(output).length ? output : undefined;
};
