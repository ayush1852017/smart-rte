import { describe, expect, it, vi } from "vitest";
import { mediaManagerAdapterFrom } from "./mediaManagerAdapter.js";
import type { MediaProvider } from "./mediaProvider.js";

const makeFile = (name: string, type: string, content = "x") => new File([content], name, { type });

describe("mediaManagerAdapterFrom", () => {
  it("uploads each file individually via MediaProvider.upload and builds a MediaItem from what's known client-side", async () => {
    const upload = vi.fn(async (file: File) => ({ url: `https://cdn.test/${file.name}`, id: `id-${file.name}` }));
    const provider: MediaProvider = { upload, search: vi.fn(), remove: vi.fn() };
    const adapter = mediaManagerAdapterFrom(provider);

    const files = [makeFile("a.png", "image/png"), makeFile("b.png", "image/png")];
    const items = await adapter.upload(files);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(items).toEqual([
      { id: "id-a.png", url: "https://cdn.test/a.png", title: "a.png", mimeType: "image/png", sizeBytes: 1 },
      { id: "id-b.png", url: "https://cdn.test/b.png", title: "b.png", mimeType: "image/png", sizeBytes: 1 },
    ]);
  });

  it("translates a bundled MediaSearchQuery into MediaProvider.search's positional (query, filters, page) call", async () => {
    const search = vi.fn(async () => []);
    const provider: MediaProvider = { upload: vi.fn(), search, remove: vi.fn() };
    const adapter = mediaManagerAdapterFrom(provider);

    await adapter.search({ q: "sunset", tags: ["nature"], mimePrefix: "image/", hashHex: "abc123", page: 2, pageSize: 10 });

    expect(search).toHaveBeenCalledWith("sunset", { mimePrefix: "image/", tags: ["nature"], hashHex: "abc123", pageSize: 10 }, 2);
  });

  it("defaults the free-text query to an empty string when q is omitted, matching MediaManager.tsx's hash-only duplicate-detection call", async () => {
    const search = vi.fn(async () => []);
    const provider: MediaProvider = { upload: vi.fn(), search, remove: vi.fn() };
    const adapter = mediaManagerAdapterFrom(provider);

    await adapter.search({ hashHex: "deadbeef" });

    expect(search).toHaveBeenCalledWith("", { mimePrefix: undefined, tags: undefined, hashHex: "deadbeef", pageSize: undefined }, undefined);
  });

  it("wires remove directly to MediaProvider.remove", async () => {
    const remove = vi.fn(async () => undefined);
    const provider: MediaProvider = { upload: vi.fn(), search: vi.fn(), remove };
    const adapter = mediaManagerAdapterFrom(provider);

    await adapter.remove!("item-1");

    expect(remove).toHaveBeenCalledWith("item-1");
  });
});
