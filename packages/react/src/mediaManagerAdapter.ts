import type { MediaProvider } from "./mediaProvider.js";
import type { MediaItem, MediaManagerAdapter } from "./components/MediaManager.js";

/**
 * Phase 11.5 §2.1: MediaManager.tsx was already built (upload/library/
 * duplicate-detection/info panel) against its own MediaManagerAdapter
 * shape, not the real MediaProvider interface - this translates one into
 * the other. No MediaProvider change needed (confirmed in
 * docs/PHASE_11_5_MEDIAPROVIDER_FINDINGS.md): the shapes just differ
 * (batch vs. single upload; bundled vs. positional search query), not the
 * capabilities.
 */
export const mediaManagerAdapterFrom = (provider: MediaProvider): MediaManagerAdapter => ({
  async upload(files: File[]): Promise<MediaItem[]> {
    const uploaded: MediaItem[] = [];
    for (const file of files) {
      const result = await provider.upload(file);
      uploaded.push({
        id: result.id,
        url: result.url,
        title: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
      });
    }
    return uploaded;
  },
  search(query) {
    return provider.search(query.q || "", {
      mimePrefix: query.mimePrefix,
      tags: query.tags,
      hashHex: query.hashHex,
      pageSize: query.pageSize,
    }, query.page);
  },
  remove: (id: string) => provider.remove(id),
});
