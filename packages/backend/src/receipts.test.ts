import { describe, it, expect } from "vitest";
import { buildReceipt } from "./receipts.js";
import type { ReceiptLineItem } from "@receipt-scanner/shared";

describe("buildReceipt", () => {
  it("assembles a Receipt record from parsed line items", () => {
    const lines: ReceiptLineItem[] = [{ name: "Milk", quantity: 1, unit: "unit", price: 3.5 }];
    const receipt = buildReceipt({
      userId: "user-1",
      receiptId: "rec-1",
      imageS3Key: "receipts/user-1/rec-1.jpg",
      lineItems: lines,
      now: () => "2026-06-14T00:00:00Z",
    });
    expect(receipt.total).toBe(3.5);
    expect(receipt.userId).toBe("user-1");
    expect(receipt.lineItems).toHaveLength(1);
    expect(receipt.createdAt).toBe("2026-06-14T00:00:00Z");
  });
});
