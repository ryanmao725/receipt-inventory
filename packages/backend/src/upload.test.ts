import { describe, it, expect, vi } from "vitest";
import { buildImageKey, isOwnedKey, parseReceiptId, createUploadUrl } from "./upload.js";

describe("buildImageKey", () => {
  it("builds receipts/{userId}/{receiptId}", () => {
    expect(buildImageKey("u1", "r1")).toBe("receipts/u1/r1");
  });
});

describe("isOwnedKey", () => {
  it("accepts a key under the user's prefix", () => {
    expect(isOwnedKey("u1", "receipts/u1/r1")).toBe(true);
  });
  it("rejects another user's key", () => {
    expect(isOwnedKey("u1", "receipts/u2/r1")).toBe(false);
  });
  it("rejects a deeper or shorter path", () => {
    expect(isOwnedKey("u1", "receipts/u1/r1/evil")).toBe(false);
    expect(isOwnedKey("u1", "receipts/u1")).toBe(false);
  });
});

describe("parseReceiptId", () => {
  it("returns the last segment", () => {
    expect(parseReceiptId("receipts/u1/r1")).toBe("r1");
  });
});

describe("createUploadUrl", () => {
  it("presigns for the user's key", async () => {
    const presign = vi.fn(async () => "https://signed.example/put");
    const res = await createUploadUrl("u1", () => "r1", presign);
    expect(res).toEqual({ uploadUrl: "https://signed.example/put", imageS3Key: "receipts/u1/r1" });
    expect(presign).toHaveBeenCalledTimes(1);
  });
});
