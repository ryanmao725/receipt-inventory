import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { InventoryItem, ReceiptLineItem } from "@receipt-scanner/shared";

const TABLE = process.env.INVENTORY_TABLE ?? "";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Pure mapping from receipt line items to inventory items (testable without AWS). */
export function lineItemsToInventory(
  userId: string,
  receiptId: string,
  lines: ReceiptLineItem[],
  newId: () => string = () => crypto.randomUUID(),
  now: () => string = () => new Date().toISOString(),
): InventoryItem[] {
  return lines.map((line) => ({
    userId,
    itemId: newId(),
    name: line.name,
    quantity: line.quantity,
    unit: line.unit,
    sourceReceiptId: receiptId,
    updatedAt: now(),
  }));
}

export async function putItems(items: InventoryItem[]): Promise<void> {
  // TODO: batch with BatchWriteCommand for >25 items.
  await Promise.all(items.map((item) => doc.send(new PutCommand({ TableName: TABLE, Item: item }))));
}

export async function listItems(userId: string): Promise<InventoryItem[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "userId = :u",
      ExpressionAttributeValues: { ":u": userId },
    }),
  );
  return (res.Items ?? []) as InventoryItem[];
}

export async function updateItem(
  userId: string,
  itemId: string,
  fields: Partial<Pick<InventoryItem, "name" | "quantity" | "unit">>,
): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const sets = Object.keys(fields).map((k, i) => `#k${i} = :v${i}`);
  const names = Object.fromEntries(Object.keys(fields).map((k, i) => [`#k${i}`, k]));
  const values = Object.fromEntries(Object.values(fields).map((v, i) => [`:v${i}`, v]));
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { userId, itemId },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function deleteItem(userId: string, itemId: string): Promise<void> {
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: { userId, itemId } }));
}
