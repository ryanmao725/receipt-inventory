import { describe, it, expect, vi } from "vitest";
import { cacheKey, getCached, putCached } from "./normcache.js";

describe("cacheKey", () => {
  it("uppercases, collapses whitespace, and trims", () => {
    expect(cacheKey(" gv  lettuce  icebrg ")).toBe("GV LETTUCE ICEBRG");
  });
});

describe("getCached", () => {
  it("returns hits keyed by the original raw name", async () => {
    const send = vi.fn(async () => ({
      Responses: { "cache-table": [{ rawKey: "GV LETTUCE", canonicalName: "lettuce" }] },
    }));
    process.env.NORMALIZATION_CACHE_TABLE = "cache-table";
    const result = await getCached("user-1", ["GV Lettuce", "365 Romaine"], send as never);
    expect(result.get("GV Lettuce")).toBe("lettuce");
    expect(result.has("365 Romaine")).toBe(false);
  });

  it("returns an empty map without calling AWS when there are no names", async () => {
    const send = vi.fn();
    const result = await getCached("user-1", [], send as never);
    expect(result.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("putCached", () => {
  it("writes one deduped item per canonical raw key", async () => {
    const send = vi.fn(async (_command: unknown) => ({}));
    process.env.NORMALIZATION_CACHE_TABLE = "cache-table";
    await putCached(
      "user-1",
      [
        { rawName: "GV Lettuce", canonicalName: "lettuce" },
        { rawName: "gv  lettuce", canonicalName: "lettuce" }, // same key after normalization
      ],
      () => "2026-07-13T00:00:00Z",
      send as never,
    );
    expect(send).toHaveBeenCalledTimes(1);
    const put = (send.mock.calls[0][0] as { input: { Item: Record<string, unknown> } }).input;
    expect(put.Item).toEqual({
      userId: "user-1",
      rawKey: "GV LETTUCE",
      canonicalName: "lettuce",
      updatedAt: "2026-07-13T00:00:00Z",
    });
  });
});
