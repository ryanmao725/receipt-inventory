import {
  TextractClient,
  AnalyzeExpenseCommand,
  type AnalyzeExpenseCommandOutput,
} from "@aws-sdk/client-textract";
import type { ReceiptLineItem } from "@receipt-scanner/shared";

const client = new TextractClient({});

/** Calls Textract AnalyzeExpense on an S3 object and returns parsed line items. */
export async function analyzeReceipt(bucket: string, key: string): Promise<ReceiptLineItem[]> {
  const output = await client.send(
    new AnalyzeExpenseCommand({ Document: { S3Object: { Bucket: bucket, Name: key } } }),
  );
  return parseExpense(output);
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
        if (!name) continue;
        // TODO: parse quantity/unit from EXPENSE_ROW fields; defaulting for scaffold.
        items.push({
          name,
          quantity: 1,
          unit: "unit",
          price: priceText ? Number.parseFloat(priceText) : 0,
        });
      }
    }
  }
  return items;
}
