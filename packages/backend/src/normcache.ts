import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchGetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { log } from "./log.js";

const TABLE = () => process.env.NORMALIZATION_CACHE_TABLE ?? "";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Injectable send so tests don't hit AWS. */
export type Send = (command: BatchGetCommand | PutCommand) => Promise<Record<string, unknown>>;
const defaultSend: Send = (command) => doc.send(command as never) as Promise<Record<string, unknown>>;

/** Normalizes a raw receipt line into a stable cache key. */
export function cacheKey(rawName: string): string {
  return rawName.toUpperCase().replace(/\s+/g, " ").trim();
}

/** Per-user cache lookup; returns a map keyed by the original raw name (hits only). */
export async function getCached(
  userId: string,
  rawNames: string[],
  send: Send = defaultSend,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const keyByRaw = new Map<string, string>();
  const uniqueKeys = new Set<string>();
  for (const raw of rawNames) {
    const k = cacheKey(raw);
    keyByRaw.set(raw, k);
    uniqueKeys.add(k);
  }
  if (uniqueKeys.size === 0) return result;

  const table = TABLE();
  const res = (await send(
    new BatchGetCommand({
      RequestItems: {
        [table]: { Keys: [...uniqueKeys].map((rawKey) => ({ userId, rawKey })) },
      },
    }),
  )) as { Responses?: Record<string, { rawKey: string; canonicalName: string }[]> };

  const canonByKey = new Map<string, string>();
  for (const item of res.Responses?.[table] ?? []) canonByKey.set(item.rawKey, item.canonicalName);
  for (const raw of rawNames) {
    const canon = canonByKey.get(keyByRaw.get(raw)!);
    if (canon !== undefined) result.set(raw, canon);
  }
  return result;
}

/** Persist the user's confirmed raw→canonical mappings (deduped by cache key). */
export async function putCached(
  userId: string,
  pairs: { rawName: string; canonicalName: string }[],
  now: () => string = () => new Date().toISOString(),
  send: Send = defaultSend,
): Promise<void> {
  const seen = new Set<string>();
  const items = [];
  for (const p of pairs) {
    const rawKey = cacheKey(p.rawName);
    if (rawKey === "" || seen.has(rawKey)) continue;
    seen.add(rawKey);
    items.push({ userId, rawKey, canonicalName: p.canonicalName, updatedAt: now() });
  }
  const table = TABLE();
  await Promise.all(items.map((Item) => send(new PutCommand({ TableName: table, Item }))));
  log.debug({ count: items.length }, "normalization cache updated");
}
