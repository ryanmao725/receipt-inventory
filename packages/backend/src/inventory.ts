import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { InventoryItem, ReceiptLineItem, ConfirmedLine } from "@receipt-scanner/shared";
import { log } from "./log.js";

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
  log.debug({ count: items.length }, "inventory items written");
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

/** Canonical inventory identity — same canonical name always maps to the same itemId. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Injectable send for commitInventory tests. */
type UpdateSend = (command: UpdateCommand) => Promise<{ Attributes?: Record<string, unknown> }>;

/**
 * Upserts confirmed receipt items into inventory, merging by canonical name:
 * itemId = slug(canonicalName), quantity accumulates via ADD. keep=false lines
 * are dropped. Returns the resulting inventory rows (deduped by itemId).
 */
export async function commitInventory(
  userId: string,
  receiptId: string,
  items: ConfirmedLine[],
  now: () => string = () => new Date().toISOString(),
  send: UpdateSend = (command) => doc.send(command as never) as ReturnType<UpdateSend>,
): Promise<InventoryItem[]> {
  const timestamp = now();
  const byId = new Map<string, InventoryItem>();
  for (const item of items) {
    if (!item.keep) continue;
    const itemId = slug(item.canonicalName);
    if (itemId === "") continue;
    const res = await send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { userId, itemId },
        UpdateExpression:
          "SET #n = :name, unit = :unit, updatedAt = :now, sourceReceiptId = :rid ADD quantity :q",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: {
          ":name": item.canonicalName,
          ":unit": item.unit,
          ":now": timestamp,
          ":rid": receiptId,
          ":q": item.quantity,
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    byId.set(itemId, (res.Attributes ?? {}) as unknown as InventoryItem);
  }
  return [...byId.values()];
}
