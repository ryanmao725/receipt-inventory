import {
  TextractClient,
  AnalyzeExpenseCommand,
  type AnalyzeExpenseCommandOutput,
} from "@aws-sdk/client-textract";
import type { ReceiptLineItem } from "@receipt-scanner/shared";
import { log } from "./log.js";

const client = new TextractClient({});

/** Calls Textract AnalyzeExpense on an S3 object and returns parsed line items. */
export async function analyzeReceipt(bucket: string, key: string): Promise<ReceiptLineItem[]> {
  log.debug({ bucket, key }, "textract analyze start");
  const output = await client.send(
    new AnalyzeExpenseCommand({ Document: { S3Object: { Bucket: bucket, Name: key } } }),
  );
  const items = parseExpense(output);
  log.debug({ itemCount: items.length }, "textract analyze complete");
  return items;
}

/**
 * Parses a Textract money string into a finite number. Textract returns prices
 * like "$3.50" or "$1,234.56"; strip everything except digits, a decimal point,
 * and a leading minus, then parse. Returns 0 when the result isn't finite so a
 * NaN can never reach DynamoDB (assumes US "." decimal / "," thousands format).
 */
export function parseAmount(text: string | undefined): number {
  if (!text) return 0;
  const value = Number.parseFloat(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** Maps an AnalyzeExpense response into ReceiptLineItem[]. */
export function parseExpense(output: AnalyzeExpenseCommandOutput): ReceiptLineItem[] {
  const items: ReceiptLineItem[] = [];
  for (const doc of output.ExpenseDocuments ?? []) {
    for (const group of doc.LineItemGroups ?? []) {
      for (const line of group.LineItems ?? []) {
        const fields = line.LineItemExpenseFields ?? [];
        const name = fields.find((f) => f.Type?.Text === "ITEM")?.ValueDetection?.Text;
        const priceText = fields.find((f) => f.Type?.Text === "PRICE")?.ValueDetection?.Text;
        const quantityText = fields.find((f) => f.Type?.Text === "QUANTITY")?.ValueDetection?.Text;
        if (!name) continue;
        const parsedQty = quantityText ? Number.parseFloat(quantityText) : Number.NaN;
        const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;
        // Textract AnalyzeExpense has no reliable unit-of-measure field; unit stays "unit".
        items.push({
          name,
          quantity,
          unit: "unit",
          price: parseAmount(priceText),
        });
      }
    }
  }
  return items;
}
