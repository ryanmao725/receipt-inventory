import { describe, it, expect } from "vitest";
import { lineItemsToInventory, slug, commitInventory } from "./inventory.js";
import type { ReceiptLineItem, ConfirmedLine } from "@receipt-scanner/shared";
import { vi } from "vitest";

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

describe("slug", () => {
  it("lowercases and hyphenates", () => {
    expect(slug("Olive Oil")).toBe("olive-oil");
    expect(slug("  Lettuce ")).toBe("lettuce");
  });
});

describe("commitInventory", () => {
  it("drops keep=false lines and upserts kept items with an ADD increment", async () => {
    const sent: { Key: unknown; UpdateExpression: string }[] = [];
    const send = vi.fn(async (command: { input: { Key: unknown; UpdateExpression: string } }) => {
      sent.push({ Key: command.input.Key, UpdateExpression: command.input.UpdateExpression });
      return { Attributes: { userId: "user-1", itemId: "lettuce", name: "lettuce", quantity: 2, unit: "unit", sourceReceiptId: "r1", updatedAt: "t" } };
    });
    const items: ConfirmedLine[] = [
      { rawName: "GV LETTUCE", canonicalName: "lettuce", quantity: 2, unit: "unit", price: 1.49, keep: true },
      { rawName: "BAG FEE", canonicalName: "bag fee", quantity: 1, unit: "unit", price: 0.1, keep: false },
    ];
    const result = await commitInventory("user-1", "r1", items, () => "t", send as never);
    expect(send).toHaveBeenCalledTimes(1); // BAG FEE dropped
    expect(sent[0].Key).toEqual({ userId: "user-1", itemId: "lettuce" });
    expect(sent[0].UpdateExpression).toContain("ADD quantity :q");
    expect(result).toEqual([
      { userId: "user-1", itemId: "lettuce", name: "lettuce", quantity: 2, unit: "unit", sourceReceiptId: "r1", updatedAt: "t" },
    ]);
  });

  it("collapses duplicate canonical names on one receipt to a single row", async () => {
    const send = vi.fn(async () => ({ Attributes: { userId: "u", itemId: "lettuce", name: "lettuce", quantity: 3, unit: "unit", sourceReceiptId: "r1", updatedAt: "t" } }));
    const items: ConfirmedLine[] = [
      { rawName: "GV LETTUCE", canonicalName: "lettuce", quantity: 1, unit: "unit", price: 1, keep: true },
      { rawName: "365 ROMAINE", canonicalName: "lettuce", quantity: 2, unit: "unit", price: 2, keep: true },
    ];
    const result = await commitInventory("u", "r1", items, () => "t", send as never);
    expect(send).toHaveBeenCalledTimes(2); // two ADD updates to the same key
    expect(result).toHaveLength(1); // deduped in the response
    expect(result[0].itemId).toBe("lettuce");
  });
});
