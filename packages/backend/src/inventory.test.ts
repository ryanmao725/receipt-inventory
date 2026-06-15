import { describe, it, expect } from "vitest";
import { lineItemsToInventory } from "./inventory.js";
import type { ReceiptLineItem } from "@receipt-scanner/shared";

describe("lineItemsToInventory", () => {
  it("converts line items to inventory items scoped to a user and receipt", () => {
    const lines: ReceiptLineItem[] = [
      { name: "Milk", quantity: 1, unit: "unit", price: 3.5 },
    ];
    const result = lineItemsToInventory("user-1", "rec-1", lines, () => "item-1", () => "2026-06-14T00:00:00Z");
    expect(result).toEqual([
      {
        userId: "user-1",
        itemId: "item-1",
        name: "Milk",
        quantity: 1,
        unit: "unit",
        sourceReceiptId: "rec-1",
        updatedAt: "2026-06-14T00:00:00Z",
      },
    ]);
  });
});
