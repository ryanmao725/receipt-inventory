import { describe, it, expect, vi } from "vitest";

vi.mock("./textract.js", () => ({
  analyzeReceipt: vi.fn(async () => [{ name: "GV LETTUCE", quantity: 2, unit: "unit", price: 1.49 }]),
}));
vi.mock("./normalize.js", () => ({
  normalizeLineItems: vi.fn(async () => [
    { rawName: "GV LETTUCE", canonicalName: "lettuce", quantity: 2, unit: "unit", price: 1.49, isFood: true, source: "claude" },
  ]),
}));
vi.mock("./receipts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./receipts.js")>()),
  putReceipt: vi.fn(async () => {}),
}));
vi.mock("./inventory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory.js")>()),
  commitInventory: vi.fn(async () => [
    { userId: "user-1", itemId: "lettuce", name: "lettuce", quantity: 2, unit: "unit", sourceReceiptId: "r1", updatedAt: "t" },
  ]),
}));
vi.mock("./normcache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./normcache.js")>()),
  putCached: vi.fn(async () => {}),
}));
vi.mock("./upload.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./upload.js")>()),
  createUploadUrl: vi.fn(async () => ({
    uploadUrl: "https://signed.example/put",
    imageS3Key: "receipts/user-1/r1",
  })),
}));

import { route } from "./handler.js";

describe("POST /receipts/upload-url", () => {
  it("returns a presigned url and key", async () => {
    const res = await route({ method: "POST", path: "/receipts/upload-url", userId: "user-1", body: null, pathParams: {} });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ uploadUrl: "https://signed.example/put", imageS3Key: "receipts/user-1/r1" });
  });
});

describe("POST /receipts/propose", () => {
  it("returns 400 when imageS3Key is missing", async () => {
    const res = await route({ method: "POST", path: "/receipts/propose", userId: "user-1", body: JSON.stringify({}), pathParams: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a key owned by another user", async () => {
    const res = await route({ method: "POST", path: "/receipts/propose", userId: "user-1", body: JSON.stringify({ imageS3Key: "receipts/user-2/r1" }), pathParams: {} });
    expect(res.statusCode).toBe(403);
  });

  it("returns proposals without writing", async () => {
    const res = await route({ method: "POST", path: "/receipts/propose", userId: "user-1", body: JSON.stringify({ imageS3Key: "receipts/user-1/r1" }), pathParams: {} });
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.receiptId).toBe("r1");
    expect(payload.proposals).toHaveLength(1);
    expect(payload.proposals[0].canonicalName).toBe("lettuce");
  });
});

describe("POST /receipts/commit", () => {
  it("returns 400 when imageS3Key is missing", async () => {
    const res = await route({ method: "POST", path: "/receipts/commit", userId: "user-1", body: JSON.stringify({ items: [] }), pathParams: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a key owned by another user", async () => {
    const res = await route({ method: "POST", path: "/receipts/commit", userId: "user-1", body: JSON.stringify({ imageS3Key: "receipts/user-2/r1", items: [] }), pathParams: {} });
    expect(res.statusCode).toBe(403);
  });

  it("writes the receipt + inventory and returns added items", async () => {
    const res = await route({
      method: "POST",
      path: "/receipts/commit",
      userId: "user-1",
      body: JSON.stringify({
        imageS3Key: "receipts/user-1/r1",
        items: [{ rawName: "GV LETTUCE", canonicalName: "lettuce", quantity: 2, unit: "unit", price: 1.49, keep: true }],
      }),
      pathParams: {},
    });
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.receipt.userId).toBe("user-1");
    expect(payload.receipt.receiptId).toBe("r1");
    expect(payload.receipt.lineItems[0].name).toBe("GV LETTUCE"); // raw name preserved on the receipt
    expect(payload.receipt.total).toBeCloseTo(1.49);
    expect(payload.addedItems).toHaveLength(1);
    expect(payload.addedItems[0].name).toBe("lettuce");
  });
});
