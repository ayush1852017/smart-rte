import type { DocumentVersion } from "smartrte-core/foundation";

/**
 * The listing-cheap projection of a `DocumentVersion` - a host's backend
 * shouldn't have to ship every saved version's full document body just to
 * render a history list. Mirrors `MediaProvider.search` returning
 * `MediaItem` (metadata) rather than raw asset bytes.
 */
export interface VersionListEntry {
  readonly id: string;
  readonly label?: string;
  readonly createdAt: number;
  readonly authorId?: string;
}

/**
 * Host-owned version-storage boundary, mirroring `MediaProvider`'s shape
 * and its "the editor never persists anything itself" contract: the host
 * backend is the source of truth, and `save`/`list`/`load`/`remove` are
 * the entire boundary. There is deliberately no shipped default
 * implementation, exactly like `MediaProvider` - when a host doesn't
 * supply one, the version-history feature is simply unavailable, the same
 * way the media toolbar buttons are disabled when `mediaProvider` is
 * absent.
 */
export interface VersionProvider {
  save(version: DocumentVersion): Promise<VersionListEntry>;
  list(): Promise<readonly VersionListEntry[]>;
  load(id: string): Promise<DocumentVersion>;
  remove(id: string): Promise<void>;
}
