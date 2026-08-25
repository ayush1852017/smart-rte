export type MediaKind = "image" | "video" | "audio";

export interface UploadOptions {
  readonly signal?: AbortSignal;
}

export interface MediaFilters {
  readonly mimePrefix?: string;
  readonly tags?: readonly string[];
  readonly hashHex?: string;
  readonly pageSize?: number;
}

export interface MediaItem {
  readonly id: string;
  readonly url: string;
  readonly width?: number;
  readonly height?: number;
  readonly sizeBytes?: number;
  readonly mimeType?: string;
  readonly hashHex?: string;
  readonly createdAt?: string;
  readonly title?: string;
  readonly alt?: string;
  readonly tags?: readonly string[];
  /**
   * How many times this asset is referenced across a host's content.
   * Phase 11.5 §2.1: optional and additive - the package has no way to
   * compute cross-document usage itself (it only ever sees one document at
   * a time), so a host that wants this populates it from their own
   * tracking; when absent, the UI simply omits the count rather than
   * showing 0/misleading data.
   */
  readonly usageCount?: number;
  readonly license?: {
    readonly author?: string;
    readonly licenseType?: string;
    readonly licenseText?: string;
    readonly sourceUrl?: string;
    readonly workName?: string;
  };
}

/**
 * Host-owned media boundary. The editor never receives storage credentials.
 *
 * The editor performs no server-side-equivalent validation of `upload`'s
 * `file` - `CanonicalAuthorityEditor` applies only a best-effort client-side
 * extension/MIME allow-list check before calling this method, which is a UX
 * nicety, not a security boundary (a client can always be bypassed). The
 * host's `upload` implementation MUST independently validate file type,
 * size, and content server-side before persisting or serving whatever URL
 * it returns - the same way it must never hand the editor real storage
 * credentials.
 */
export interface MediaProvider {
  upload(file: File, opts?: UploadOptions): Promise<{ url: string; id: string }>;
  search(query: string, filters?: MediaFilters, page?: number): Promise<MediaItem[]>;
  remove(id: string): Promise<void>;
}
