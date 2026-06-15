import { describe, it, expect, vi } from "vitest";

vi.mock("./textract.js", () => ({
  analyzeReceipt: vi.fn(async () => [{ name: "Milk", quantity: 2, unit: "unit", price: 3.5 }]),
}));
vi.mock("./receipts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./receipts.js")>()),
  putReceipt: vi.fn(async () => {}),
}));
vi.mock("./inventory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory.js")>()),
  putItems: vi.fn(async () => {}),
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
    const res = await route({
      method: "POST",
      path: "/receipts/upload-url",
      userId: "user-1",
      body: null,
      pathParams: {},
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      uploadUrl: "https://signed.example/put",
      imageS3Key: "receipts/user-1/r1",
    });
  });
});

describe("POST /receipts", () => {
  it("returns 400 when imageS3Key is missing", async () => {
    const res = await route({
      method: "POST",
      path: "/receipts",
      userId: "user-1",
      body: JSON.stringify({}),
      pathParams: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a key owned by another user", async () => {
    const res = await route({
      method: "POST",
      path: "/receipts",
      userId: "user-1",
      body: JSON.stringify({ imageS3Key: "receipts/user-2/r1" }),
      pathParams: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("scans, saves, and returns receipt + added items", async () => {
    const res = await route({
      method: "POST",
      path: "/receipts",
      userId: "user-1",
      body: JSON.stringify({ imageS3Key: "receipts/user-1/r1" }),
      pathParams: {},
    });
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.receipt.userId).toBe("user-1");
    expect(payload.receipt.receiptId).toBe("r1");
    expect(payload.addedItems).toHaveLength(1);
    expect(payload.addedItems[0].name).toBe("Milk");
    expect(payload.addedItems[0].quantity).toBe(2);
    expect(payload.addedItems[0].sourceReceiptId).toBe("r1");
  });
});
