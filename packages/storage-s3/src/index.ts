export type PresignRequest = {
  key: string;
  contentType: string;
};

export type PresignResponse = { url: string };

export type StorageClient = {
  presignUpload: (req: PresignRequest) => Promise<PresignResponse>;
};

export function createHttpStorageClient(baseUrl = "/api/media"): StorageClient {
  return {
    async presignUpload(req: PresignRequest): Promise<PresignResponse> {
      const res = await fetch(`${baseUrl}/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error('Presign failed');
      return res.json();
    },
  };
}


