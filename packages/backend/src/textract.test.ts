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

  it("parses the QUANTITY field when present", () => {
    const output = {
      ExpenseDocuments: [
        {
          LineItemGroups: [
            {
              LineItems: [
                {
                  LineItemExpenseFields: [
                    { Type: { Text: "ITEM" }, ValueDetection: { Text: "Apples" } },
                    { Type: { Text: "PRICE" }, ValueDetection: { Text: "4.00" } },
                    { Type: { Text: "QUANTITY" }, ValueDetection: { Text: "3" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AnalyzeExpenseCommandOutput;
    expect(parseExpense(output)).toEqual([
      { name: "Apples", quantity: 3, unit: "unit", price: 4 },
    ]);
  });

  it("parses a price with a currency symbol", () => {
    const output = {
      ExpenseDocuments: [
        {
          LineItemGroups: [
            {
              LineItems: [
                {
                  LineItemExpenseFields: [
                    { Type: { Text: "ITEM" }, ValueDetection: { Text: "Milk" } },
                    { Type: { Text: "PRICE" }, ValueDetection: { Text: "$3.50" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AnalyzeExpenseCommandOutput;
    expect(parseExpense(output)[0].price).toBe(3.5);
  });

  it("parses a price with a currency symbol and thousands separators", () => {
    const output = {
      ExpenseDocuments: [
        {
          LineItemGroups: [
            {
              LineItems: [
                {
                  LineItemExpenseFields: [
                    { Type: { Text: "ITEM" }, ValueDetection: { Text: "TV" } },
                    { Type: { Text: "PRICE" }, ValueDetection: { Text: "$1,234.56" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AnalyzeExpenseCommandOutput;
    expect(parseExpense(output)[0].price).toBe(1234.56);
  });

  it("defaults price to 0 for unparseable values", () => {
    const output = {
      ExpenseDocuments: [
        {
          LineItemGroups: [
            {
              LineItems: [
                {
                  LineItemExpenseFields: [
                    { Type: { Text: "ITEM" }, ValueDetection: { Text: "Mystery" } },
                    { Type: { Text: "PRICE" }, ValueDetection: { Text: "--" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AnalyzeExpenseCommandOutput;
    const price = parseExpense(output)[0].price;
    expect(Number.isFinite(price)).toBe(true);
    expect(price).toBe(0);
  });

  it("defaults quantity to 1 for missing or unparseable values", () => {
    const output = {
      ExpenseDocuments: [
        {
          LineItemGroups: [
            {
              LineItems: [
                {
                  LineItemExpenseFields: [
                    { Type: { Text: "ITEM" }, ValueDetection: { Text: "Milk" } },
                    { Type: { Text: "QUANTITY" }, ValueDetection: { Text: "abc" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AnalyzeExpenseCommandOutput;
    expect(parseExpense(output)[0].quantity).toBe(1);
  });
});
