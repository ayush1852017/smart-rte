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
  readonly license?: {
    readonly author?: string;
    readonly licenseType?: string;
    readonly licenseText?: string;
    readonly sourceUrl?: string;
    readonly workName?: string;
  };
}

/** Host-owned media boundary. The editor never receives storage credentials. */
export interface MediaProvider {
  upload(file: File, opts?: UploadOptions): Promise<{ url: string; id: string }>;
  search(query: string, filters?: MediaFilters, page?: number): Promise<MediaItem[]>;
  remove(id: string): Promise<void>;
}
