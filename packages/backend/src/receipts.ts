import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { Receipt, ReceiptLineItem } from "@receipt-scanner/shared";

const TABLE = process.env.RECEIPTS_TABLE ?? "";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export function buildReceipt(input: {
  userId: string;
  receiptId: string;
  imageS3Key: string;
  lineItems: ReceiptLineItem[];
  merchant?: string;
  now?: () => string;
}): Receipt {
  const now = input.now ?? (() => new Date().toISOString());
  const timestamp = now();
  return {
    userId: input.userId,
    receiptId: input.receiptId,
    merchant: input.merchant ?? "Unknown", // TODO: extract merchant from Textract summary fields.
    purchasedAt: timestamp,
    total: input.lineItems.reduce((sum, l) => sum + l.price, 0),
    imageS3Key: input.imageS3Key,
    lineItems: input.lineItems,
    createdAt: timestamp,
  };
}

export async function putReceipt(receipt: Receipt): Promise<void> {
  await doc.send(new PutCommand({ TableName: TABLE, Item: receipt }));
}
