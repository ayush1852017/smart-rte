import { executeDomCanonicalAtomInsert, executeDomCanonicalAtomUpdate } from "./domInlineAtomCommandBridge.js";

export interface DomInlineImageInput { src: string; alt?: string; decorative?: boolean; title?: string; width?: number; height?: number; align?: "center" | "left" | "right"; status?: "pending" | "ready" | "error"; uploadId?: string; error?: string }

export const executeDomInlineImageCommand = (
  root: HTMLElement,
  input: DomInlineImageInput,
  selection: Selection | null = root.ownerDocument.defaultView?.getSelection() || null,
): HTMLImageElement | null => executeDomCanonicalAtomInsert(root, {
  type: "image",
  attrs: { src: input.src, alt: input.alt ?? "", decorative: input.decorative === true, status: input.status || "ready", ...(input.uploadId ? { uploadId: input.uploadId } : {}), ...(input.error ? { error: input.error } : {}), ...(input.title ? { title: input.title } : {}), ...(input.width ? { width: input.width } : {}), ...(input.height ? { height: input.height } : {}) },
}, selection) as HTMLImageElement | null;

export const executeDomInlineImageUpdate = (
  root: HTMLElement,
  image: HTMLImageElement,
  input: Partial<DomInlineImageInput>,
): boolean => executeDomCanonicalAtomUpdate(root, image, input);
