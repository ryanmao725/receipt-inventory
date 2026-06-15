import { describe, it, expect } from "vitest";
import { parseExpense } from "./textract.js";
import type { AnalyzeExpenseCommandOutput } from "@aws-sdk/client-textract";

describe("parseExpense", () => {
  it("maps expense line items to ReceiptLineItem[]", () => {
    const output = {
      ExpenseDocuments: [
        {
          LineItemGroups: [
            {
              LineItems: [
                {
                  LineItemExpenseFields: [
                    { Type: { Text: "ITEM" }, ValueDetection: { Text: "Milk" } },
                    { Type: { Text: "PRICE" }, ValueDetection: { Text: "3.50" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AnalyzeExpenseCommandOutput;

    const items = parseExpense(output);
    expect(items).toEqual([{ name: "Milk", quantity: 1, unit: "unit", price: 3.5 }]);
  });

  it("returns an empty array when there are no documents", () => {
    expect(parseExpense({} as AnalyzeExpenseCommandOutput)).toEqual([]);
  });
});
