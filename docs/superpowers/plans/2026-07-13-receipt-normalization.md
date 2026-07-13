# Receipt Item Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize messy Textract receipt line names to canonical ingredients via Claude, let the user review the whole receipt before anything is written, and make inventory identity canonical so re-buying an item increments quantity instead of adding a duplicate row.

**Architecture:** Replace the one-shot `POST /receipts` with a two-phase flow. `POST /receipts/propose` runs Textract, resolves each line against a per-user normalization cache, sends cache misses to Claude Haiku in one batched call, and returns proposals without writing anything. `POST /receipts/commit` writes the receipt (with raw names/prices preserved), upserts inventory keyed by `slug(canonicalName)` with a DynamoDB `ADD` increment (the merge that kills bloat), and writes the user's confirmed `raw→canonical` pairs back to the cache.

**Tech Stack:** TypeScript (ESM, `type: module`), Node 20 Lambda, `@aws-sdk/*` v3 (DynamoDB DocumentClient, Textract, SSM), the Anthropic TypeScript SDK (`@anthropic-ai/sdk`), AWS CDK, React + Vite + Mantine, Vitest.

## Global Constraints

- **Claude model: `claude-haiku-4-5`** — exact ID string, no date suffix. This is the model named in the approved design spec (`docs/superpowers/specs/2026-07-13-receipt-normalization-design.md`); use it as written for this cheap, high-frequency classification task. Do not substitute another model.
- **Anthropic call must be injectable.** Normalization logic takes an injectable `callClaude` (and `getApiKey`, `getCachedFn`) so unit tests never touch the network — mirror the `fetchFn` injection pattern in `packages/backend/src/recipes.ts`.
- **ESM imports use the `.js` extension** on relative paths (e.g. `import { log } from "./log.js"`), matching every existing file.
- **Never log or surface the Anthropic API key**, mirroring the sanitized-error rule in `recipes.ts`. Degrade gracefully (fall back to raw names) when the key is unset or `"REPLACE_ME"`.
- **User identity comes only from JWT claims** (`req.userId`), never the request body. `isOwnedKey` guards both new routes before any AWS call.
- **Inventory `unit` stays the literal `"unit"`** (unchanged; Textract has no reliable unit field).

---

### Task 1: Shared DTOs

**Files:**
- Modify: `packages/shared/src/index.ts` (append new interfaces after `CreateUploadUrlResponse`)

**Interfaces:**
- Produces: `ProposedLine`, `ProposeReceiptResponse`, `ConfirmedLine`, `CommitReceiptRequest`. `ScanReceiptResponse { receipt: Receipt; addedItems: InventoryItem[] }` already exists and is reused by commit.

> Note: `ConfirmedLine` carries `price` (and `rawName`) so `/commit` can rebuild the receipt with the **original** raw names and prices — preserving provenance and a correct total in `ReceiptsTable` while inventory stores the canonical name. This is a small, deliberate refinement over the spec's `ConfirmedLine` (which omitted `price`).

- [ ] **Step 1: Add the DTOs**

Append to `packages/shared/src/index.ts`:

```typescript
export interface ProposedLine {
  rawName: string;
  canonicalName: string;
  quantity: number;
  unit: string;
  price: number;
  isFood: boolean;
  source: "cache" | "claude";
}

export interface ProposeReceiptResponse {
  receiptId: string;
  imageS3Key: string;
  proposals: ProposedLine[];
}

export interface ConfirmedLine {
  rawName: string;
  canonicalName: string;
  quantity: number;
  unit: string;
  price: number;
  keep: boolean;
}

export interface CommitReceiptRequest {
  imageS3Key: string;
  items: ConfirmedLine[];
}
```

- [ ] **Step 2: Build shared to verify types compile**

Run: `pnpm --filter @receipt-scanner/shared build`
Expected: exits 0, emits updated `dist/index.d.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): DTOs for receipt propose/commit normalization flow"
```

---

### Task 2: Anthropic API key resolution in config

**Files:**
- Modify: `packages/backend/src/config.ts` (add `getAnthropicApiKey` + `resetAnthropicKeyCache`, reusing the existing `SsmSend`/`defaultSend`)
- Test: `packages/backend/src/config.test.ts` (add cases)

**Interfaces:**
- Consumes: existing `SsmSend`, `defaultSend`, `GetParameterCommand` in `config.ts`.
- Produces: `getAnthropicApiKey(send?: SsmSend): Promise<string>`, `resetAnthropicKeyCache(): void`. Resolves the SSM parameter named by `process.env.ANTHROPIC_PARAM_NAME`, cached module-level like the Spoonacular key.

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/src/config.test.ts`:

```typescript
import { getAnthropicApiKey, resetAnthropicKeyCache } from "./config.js";

describe("getAnthropicApiKey", () => {
  it("resolves the parameter value from SSM and caches it", async () => {
    process.env.ANTHROPIC_PARAM_NAME = "/receipt-scanner/anthropic-api-key";
    resetAnthropicKeyCache();
    let calls = 0;
    const send = async () => {
      calls++;
      return { Parameter: { Value: "sk-test" }, $metadata: {} };
    };
    expect(await getAnthropicApiKey(send)).toBe("sk-test");
    expect(await getAnthropicApiKey(send)).toBe("sk-test");
    expect(calls).toBe(1); // second call is a cache hit
  });
});
```

(If `config.test.ts` does not already import `describe/it/expect`, add `import { describe, it, expect } from "vitest";` at the top — check first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend exec vitest run src/config.test.ts`
Expected: FAIL — `getAnthropicApiKey` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/backend/src/config.ts` (after `getSpoonacularApiKey`):

```typescript
let cachedAnthropic: string | undefined;

/** Test helper: clears the module-level cache. */
export function resetAnthropicKeyCache(): void {
  cachedAnthropic = undefined;
}

/**
 * Resolves the Anthropic API key from SSM (parameter named by
 * ANTHROPIC_PARAM_NAME), caching it for the execution environment's lifetime.
 */
export async function getAnthropicApiKey(send: SsmSend = defaultSend): Promise<string> {
  if (cachedAnthropic !== undefined) {
    log.debug("anthropic key cache hit");
    return cachedAnthropic;
  }
  const name = process.env.ANTHROPIC_PARAM_NAME;
  if (!name) throw new Error("ANTHROPIC_PARAM_NAME is not set");
  log.debug({ parameterName: name }, "fetching anthropic key from ssm");
  const res = await send(new GetParameterCommand({ Name: name }));
  cachedAnthropic = res.Parameter?.Value ?? "";
  return cachedAnthropic;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend exec vitest run src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/src/config.test.ts
git commit -m "feat(backend): resolve Anthropic API key from SSM at runtime"
```

---

### Task 3: Per-user normalization cache

**Files:**
- Create: `packages/backend/src/normcache.ts`
- Test: `packages/backend/src/normcache.test.ts`

**Interfaces:**
- Produces:
  - `cacheKey(rawName: string): string` — uppercase, collapse internal whitespace, trim.
  - `getCached(userId: string, rawNames: string[], send?): Promise<Map<string, string>>` — map keyed by the **original** `rawName` → canonical name, hits only.
  - `putCached(userId: string, pairs: {rawName: string; canonicalName: string}[], now?, send?): Promise<void>`.
- The `send` parameter is the injectable DynamoDB DocumentClient `send`, defaulting to the module-level client. Table name from `process.env.NORMALIZATION_CACHE_TABLE`.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/normcache.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { cacheKey, getCached, putCached } from "./normcache.js";

describe("cacheKey", () => {
  it("uppercases, collapses whitespace, and trims", () => {
    expect(cacheKey(" gv  lettuce  icebrg ")).toBe("GV LETTUCE ICEBRG");
  });
});

describe("getCached", () => {
  it("returns hits keyed by the original raw name", async () => {
    const send = vi.fn(async () => ({
      Responses: { "cache-table": [{ rawKey: "GV LETTUCE", canonicalName: "lettuce" }] },
    }));
    process.env.NORMALIZATION_CACHE_TABLE = "cache-table";
    const result = await getCached("user-1", ["GV Lettuce", "365 Romaine"], send as never);
    expect(result.get("GV Lettuce")).toBe("lettuce");
    expect(result.has("365 Romaine")).toBe(false);
  });

  it("returns an empty map without calling AWS when there are no names", async () => {
    const send = vi.fn();
    const result = await getCached("user-1", [], send as never);
    expect(result.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("putCached", () => {
  it("writes one deduped item per canonical raw key", async () => {
    const send = vi.fn(async () => ({}));
    process.env.NORMALIZATION_CACHE_TABLE = "cache-table";
    await putCached(
      "user-1",
      [
        { rawName: "GV Lettuce", canonicalName: "lettuce" },
        { rawName: "gv  lettuce", canonicalName: "lettuce" }, // same key after normalization
      ],
      () => "2026-07-13T00:00:00Z",
      send as never,
    );
    expect(send).toHaveBeenCalledTimes(1);
    const put = (send.mock.calls[0][0] as { input: { Item: Record<string, unknown> } }).input;
    expect(put.Item).toEqual({
      userId: "user-1",
      rawKey: "GV LETTUCE",
      canonicalName: "lettuce",
      updatedAt: "2026-07-13T00:00:00Z",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend exec vitest run src/normcache.test.ts`
Expected: FAIL — module `./normcache.js` not found.

- [ ] **Step 3: Implement**

Create `packages/backend/src/normcache.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend exec vitest run src/normcache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/normcache.ts packages/backend/src/normcache.test.ts
git commit -m "feat(backend): per-user normalization cache over DynamoDB"
```

---

### Task 4: Normalization module (Claude Haiku)

**Files:**
- Create: `packages/backend/src/normalize.ts`
- Test: `packages/backend/src/normalize.test.ts`
- Modify: `packages/backend/package.json` (add `@anthropic-ai/sdk` dependency)

**Interfaces:**
- Consumes: `getCached` (Task 3), `getAnthropicApiKey` (Task 2), `ReceiptLineItem` + `ProposedLine` (shared).
- Produces:
  - `buildNormalizationPrompt(rawNames: string[]): string`
  - `parseNormalizationResponse(text: string, rawNames: string[]): NormalizedName[]` where `NormalizedName = { rawName: string; canonicalName: string; isFood: boolean }`
  - `normalizeLineItems(userId: string, lines: ReceiptLineItem[], deps?): Promise<ProposedLine[]>` where `deps = { callClaude?, getApiKey?, getCachedFn? }`.

- [ ] **Step 1: Add the Anthropic SDK dependency**

Edit `packages/backend/package.json` — add to `dependencies` (keep alphabetical-ish ordering with the other deps):

```json
    "@anthropic-ai/sdk": "^0.70.0",
```

Then run: `pnpm install`
Expected: lockfile updates, `@anthropic-ai/sdk` resolves.

- [ ] **Step 2: Write the failing test**

Create `packages/backend/src/normalize.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  buildNormalizationPrompt,
  parseNormalizationResponse,
  normalizeLineItems,
} from "./normalize.js";
import type { ReceiptLineItem } from "@receipt-scanner/shared";

describe("buildNormalizationPrompt", () => {
  it("includes every raw name", () => {
    const prompt = buildNormalizationPrompt(["GV LETTUCE", "BAG FEE"]);
    expect(prompt).toContain("GV LETTUCE");
    expect(prompt).toContain("BAG FEE");
  });
});

describe("parseNormalizationResponse", () => {
  it("maps a well-formed JSON array", () => {
    const text = JSON.stringify([
      { rawName: "GV LETTUCE", canonicalName: "lettuce", isFood: true },
      { rawName: "BAG FEE", canonicalName: "bag fee", isFood: false },
    ]);
    expect(parseNormalizationResponse(text, ["GV LETTUCE", "BAG FEE"])).toEqual([
      { rawName: "GV LETTUCE", canonicalName: "lettuce", isFood: true },
      { rawName: "BAG FEE", canonicalName: "bag fee", isFood: false },
    ]);
  });

  it("falls back to the raw name and isFood true on unparseable output", () => {
    expect(parseNormalizationResponse("not json", ["MILK"])).toEqual([
      { rawName: "MILK", canonicalName: "MILK", isFood: true },
    ]);
  });

  it("tolerates code fences around the JSON", () => {
    const text = "```json\n[{\"rawName\":\"MILK\",\"canonicalName\":\"milk\",\"isFood\":true}]\n```";
    expect(parseNormalizationResponse(text, ["MILK"])[0].canonicalName).toBe("milk");
  });
});

describe("normalizeLineItems", () => {
  const lines: ReceiptLineItem[] = [
    { name: "GV LETTUCE", quantity: 2, unit: "unit", price: 1.49 },
    { name: "365 ROMAINE", quantity: 1, unit: "unit", price: 2.99 },
  ];

  it("resolves cache hits without calling Claude and carries qty/unit/price through", async () => {
    const callClaude = vi.fn();
    const result = await normalizeLineItems("user-1", lines, {
      getCachedFn: async () => new Map([["GV LETTUCE", "lettuce"], ["365 ROMAINE", "romaine lettuce"]]),
      getApiKey: async () => "sk-test",
      callClaude,
    });
    expect(callClaude).not.toHaveBeenCalled();
    expect(result[0]).toEqual({
      rawName: "GV LETTUCE",
      canonicalName: "lettuce",
      quantity: 2,
      unit: "unit",
      price: 1.49,
      isFood: true,
      source: "cache",
    });
    expect(result[1].canonicalName).toBe("romaine lettuce");
  });

  it("calls Claude once for cache misses and tags them source=claude", async () => {
    const callClaude = vi.fn(async () =>
      JSON.stringify([
        { rawName: "GV LETTUCE", canonicalName: "lettuce", isFood: true },
        { rawName: "365 ROMAINE", canonicalName: "romaine lettuce", isFood: true },
      ]),
    );
    const result = await normalizeLineItems("user-1", lines, {
      getCachedFn: async () => new Map(),
      getApiKey: async () => "sk-test",
      callClaude,
    });
    expect(callClaude).toHaveBeenCalledTimes(1);
    expect(result.map((r) => r.source)).toEqual(["claude", "claude"]);
    expect(result[0].canonicalName).toBe("lettuce");
  });

  it("degrades to raw names when the key is unset", async () => {
    const callClaude = vi.fn();
    const result = await normalizeLineItems("user-1", lines, {
      getCachedFn: async () => new Map(),
      getApiKey: async () => "REPLACE_ME",
      callClaude,
    });
    expect(callClaude).not.toHaveBeenCalled();
    expect(result[0].canonicalName).toBe("GV LETTUCE");
    expect(result[0].isFood).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend exec vitest run src/normalize.test.ts`
Expected: FAIL — module `./normalize.js` not found.

- [ ] **Step 4: Implement**

Create `packages/backend/src/normalize.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { ReceiptLineItem, ProposedLine } from "@receipt-scanner/shared";
import { getCached } from "./normcache.js";
import { getAnthropicApiKey } from "./config.js";
import { log } from "./log.js";

const MODEL = "claude-haiku-4-5";

export interface NormalizedName {
  rawName: string;
  canonicalName: string;
  isFood: boolean;
}

/** Builds the batched normalization prompt for a set of raw receipt lines. */
export function buildNormalizationPrompt(rawNames: string[]): string {
  return [
    "You normalize grocery receipt line items to canonical ingredient names.",
    "For each input line return the canonical, lowercase, singular single-ingredient",
    "name with no brand or abbreviations (e.g. \"GV LETTUCE ICEBRG\" -> \"lettuce\").",
    "Set isFood to false for non-food lines like fees, tax, totals, deposits, or discounts.",
    "Respond with ONLY a JSON array, one object per input line in the same order:",
    '[{"rawName": string, "canonicalName": string, "isFood": boolean}]',
    "",
    "Input lines:",
    JSON.stringify(rawNames),
  ].join("\n");
}

/** Parses the model's JSON array back into aligned normalized names (defensive). */
export function parseNormalizationResponse(text: string, rawNames: string[]): NormalizedName[] {
  let parsed: unknown;
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = null;
  }
  const arr = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  const byRaw = new Map<string, { canonicalName: string; isFood: boolean }>();
  for (const e of arr) {
    if (e && typeof e.rawName === "string" && typeof e.canonicalName === "string") {
      byRaw.set(e.rawName, { canonicalName: e.canonicalName, isFood: e.isFood !== false });
    }
  }
  return rawNames.map((raw, i) => {
    const byName = byRaw.get(raw);
    const byIndex =
      arr[i] && typeof arr[i].canonicalName === "string"
        ? { canonicalName: arr[i].canonicalName as string, isFood: arr[i].isFood !== false }
        : undefined;
    const hit = byName ?? byIndex;
    return hit
      ? { rawName: raw, canonicalName: hit.canonicalName, isFood: hit.isFood }
      : { rawName: raw, canonicalName: raw, isFood: true };
  });
}

export type CallClaude = (prompt: string) => Promise<string>;

const defaultCallClaude: CallClaude = async (prompt) => {
  const apiKey = await getAnthropicApiKey();
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
};

export interface NormalizeDeps {
  callClaude?: CallClaude;
  getApiKey?: () => Promise<string>;
  getCachedFn?: typeof getCached;
}

/**
 * Normalizes receipt line items to canonical ingredients. Cache hits resolve for
 * free; misses go to Claude in one batched call. Degrades to raw names (isFood
 * true, source "claude") when the API key is unset, so proposals never fail hard.
 */
export async function normalizeLineItems(
  userId: string,
  lines: ReceiptLineItem[],
  deps: NormalizeDeps = {},
): Promise<ProposedLine[]> {
  const callClaude = deps.callClaude ?? defaultCallClaude;
  const getApiKey = deps.getApiKey ?? getAnthropicApiKey;
  const getCachedFn = deps.getCachedFn ?? getCached;

  const cached = await getCachedFn(userId, lines.map((l) => l.name));
  const misses = lines.filter((l) => !cached.has(l.name));
  const normalized = new Map<string, NormalizedName>();

  if (misses.length > 0) {
    const apiKey = await getApiKey();
    if (apiKey && apiKey !== "REPLACE_ME") {
      const missNames = misses.map((l) => l.name);
      const text = await callClaude(buildNormalizationPrompt(missNames));
      for (const n of parseNormalizationResponse(text, missNames)) normalized.set(n.rawName, n);
    } else {
      log.warn("anthropic key not set; returning raw names unnormalized");
    }
  }

  return lines.map((l) => {
    const canon = cached.get(l.name);
    if (canon !== undefined) {
      return {
        rawName: l.name,
        canonicalName: canon,
        quantity: l.quantity,
        unit: l.unit,
        price: l.price,
        isFood: true,
        source: "cache" as const,
      };
    }
    const n = normalized.get(l.name);
    return {
      rawName: l.name,
      canonicalName: n?.canonicalName ?? l.name,
      quantity: l.quantity,
      unit: l.unit,
      price: l.price,
      isFood: n?.isFood ?? true,
      source: "claude" as const,
    };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend exec vitest run src/normalize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/normalize.ts packages/backend/src/normalize.test.ts packages/backend/package.json pnpm-lock.yaml
git commit -m "feat(backend): Claude Haiku line-item normalization with cache + graceful degrade"
```

---

### Task 5: Canonical inventory identity + merge upsert

**Files:**
- Modify: `packages/backend/src/inventory.ts` (add `slug` + `commitInventory`; leave `lineItemsToInventory`, `putItems`, `listItems`, `updateItem`, `deleteItem` untouched)
- Test: `packages/backend/src/inventory.test.ts` (add cases)

**Interfaces:**
- Consumes: `ConfirmedLine`, `InventoryItem` (shared); the module's existing `doc` client, `UpdateCommand`, `TABLE`.
- Produces:
  - `slug(name: string): string`
  - `commitInventory(userId, receiptId, items: ConfirmedLine[], now?, send?): Promise<InventoryItem[]>` — filters `keep`, upserts each kept item under `itemId = slug(canonicalName)` with `ADD quantity`, returns the `ALL_NEW` attributes (deduped by itemId).

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/src/inventory.test.ts`:

```typescript
import { slug, commitInventory } from "./inventory.js";
import type { ConfirmedLine } from "@receipt-scanner/shared";
import { vi } from "vitest";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend exec vitest run src/inventory.test.ts`
Expected: FAIL — `slug`/`commitInventory` not exported.

- [ ] **Step 3: Implement**

In `packages/backend/src/inventory.ts`, add `ConfirmedLine` to the shared type import, then append these exports (leave everything else as-is):

```typescript
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
    byId.set(itemId, (res.Attributes ?? {}) as InventoryItem);
  }
  return [...byId.values()];
}
```

Confirm the import line reads:
`import type { InventoryItem, ReceiptLineItem, ConfirmedLine } from "@receipt-scanner/shared";`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend exec vitest run src/inventory.test.ts`
Expected: PASS (existing `lineItemsToInventory` test + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/inventory.ts packages/backend/src/inventory.test.ts
git commit -m "feat(backend): canonical inventory identity with ADD-merge upsert"
```

---

### Task 6: Handler propose/commit routes

**Files:**
- Modify: `packages/backend/src/handler.ts` (replace the `POST /receipts` block with `/receipts/propose` and `/receipts/commit`; update imports)
- Test: `packages/backend/src/handler.scan.test.ts` (rewrite the `POST /receipts` blocks for propose + commit; keep the upload-url test)

**Interfaces:**
- Consumes: `normalizeLineItems` (Task 4), `commitInventory` (Task 5), `putCached` (Task 3), `buildReceipt`/`putReceipt`, `analyzeReceipt`, `isOwnedKey`/`parseReceiptId`, `ConfirmedLine`.
- Produces: routes `POST /receipts/propose` → `ProposeReceiptResponse`, `POST /receipts/commit` → `ScanReceiptResponse`.

- [ ] **Step 1: Rewrite the scan test**

Replace the entire contents of `packages/backend/src/handler.scan.test.ts` with:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("./textract.js", () => ({
  analyzeReceipt: vi.fn(async () => [{ name: "GV LETTUCE", quantity: 2, unit: "unit", price: 1.49 }]),
}));
vi.mock("./normalize.js", () => ({
  normalizeLineItems: vi.fn(async () => [
    { rawName: "GV LETTUCE", canonicalName: "lettuce", quantity: 2, unit: "unit", price: 1.49, isFood: true, source: "claude" },
  ]),
}));
vi.mock("./receipts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./receipts.js")>()),
  putReceipt: vi.fn(async () => {}),
}));
vi.mock("./inventory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory.js")>()),
  commitInventory: vi.fn(async () => [
    { userId: "user-1", itemId: "lettuce", name: "lettuce", quantity: 2, unit: "unit", sourceReceiptId: "r1", updatedAt: "t" },
  ]),
}));
vi.mock("./normcache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./normcache.js")>()),
  putCached: vi.fn(async () => {}),
}));
vi.mock("./upload.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./upload.js")>()),
  createUploadUrl: vi.fn(async () => ({
    uploadUrl: "https://signed.example/put",
    imageS3Key: "receipts/user-1/r1",
  })),
}));

import { route } from "./handler.js";

describe("POST /receipts/upload-url", () => {
  it("returns a presigned url and key", async () => {
    const res = await route({ method: "POST", path: "/receipts/upload-url", userId: "user-1", body: null, pathParams: {} });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ uploadUrl: "https://signed.example/put", imageS3Key: "receipts/user-1/r1" });
  });
});

describe("POST /receipts/propose", () => {
  it("returns 400 when imageS3Key is missing", async () => {
    const res = await route({ method: "POST", path: "/receipts/propose", userId: "user-1", body: JSON.stringify({}), pathParams: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a key owned by another user", async () => {
    const res = await route({ method: "POST", path: "/receipts/propose", userId: "user-1", body: JSON.stringify({ imageS3Key: "receipts/user-2/r1" }), pathParams: {} });
    expect(res.statusCode).toBe(403);
  });

  it("returns proposals without writing", async () => {
    const res = await route({ method: "POST", path: "/receipts/propose", userId: "user-1", body: JSON.stringify({ imageS3Key: "receipts/user-1/r1" }), pathParams: {} });
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.receiptId).toBe("r1");
    expect(payload.proposals).toHaveLength(1);
    expect(payload.proposals[0].canonicalName).toBe("lettuce");
  });
});

describe("POST /receipts/commit", () => {
  it("returns 400 when imageS3Key is missing", async () => {
    const res = await route({ method: "POST", path: "/receipts/commit", userId: "user-1", body: JSON.stringify({ items: [] }), pathParams: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a key owned by another user", async () => {
    const res = await route({ method: "POST", path: "/receipts/commit", userId: "user-1", body: JSON.stringify({ imageS3Key: "receipts/user-2/r1", items: [] }), pathParams: {} });
    expect(res.statusCode).toBe(403);
  });

  it("writes the receipt + inventory and returns added items", async () => {
    const res = await route({
      method: "POST",
      path: "/receipts/commit",
      userId: "user-1",
      body: JSON.stringify({
        imageS3Key: "receipts/user-1/r1",
        items: [{ rawName: "GV LETTUCE", canonicalName: "lettuce", quantity: 2, unit: "unit", price: 1.49, keep: true }],
      }),
      pathParams: {},
    });
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.receipt.userId).toBe("user-1");
    expect(payload.receipt.receiptId).toBe("r1");
    expect(payload.receipt.lineItems[0].name).toBe("GV LETTUCE"); // raw name preserved on the receipt
    expect(payload.receipt.total).toBeCloseTo(1.49);
    expect(payload.addedItems).toHaveLength(1);
    expect(payload.addedItems[0].name).toBe("lettuce");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend exec vitest run src/handler.scan.test.ts`
Expected: FAIL — routes `/receipts/propose` and `/receipts/commit` return 404.

- [ ] **Step 3: Update the handler**

In `packages/backend/src/handler.ts`:

1. Update the imports: change the inventory import to drop `lineItemsToInventory` and `putItems` and add `commitInventory`, and add the new modules:

```typescript
import { listItems, updateItem, deleteItem, commitInventory } from "./inventory.js";
import { normalizeLineItems } from "./normalize.js";
import { putCached } from "./normcache.js";
import type { ConfirmedLine } from "@receipt-scanner/shared";
```

2. Replace the whole `if (req.method === "POST" && req.path === "/receipts") { ... }` block with:

```typescript
  if (req.method === "POST" && req.path === "/receipts/propose") {
    const imageS3Key: string = JSON.parse(req.body ?? "{}").imageS3Key ?? "";
    if (!imageS3Key) return json(400, { message: "imageS3Key is required" });
    if (!isOwnedKey(req.userId, imageS3Key)) return json(403, { message: "Forbidden" });
    const receiptId = parseReceiptId(imageS3Key);
    const bucket = process.env.RECEIPTS_BUCKET ?? "";
    const lineItems = await analyzeReceipt(bucket, imageS3Key);
    const proposals = await normalizeLineItems(req.userId, lineItems);
    return json(200, { receiptId, imageS3Key, proposals });
  }
  if (req.method === "POST" && req.path === "/receipts/commit") {
    const parsed = JSON.parse(req.body ?? "{}");
    const imageS3Key: string = parsed.imageS3Key ?? "";
    const items: ConfirmedLine[] = Array.isArray(parsed.items) ? parsed.items : [];
    if (!imageS3Key) return json(400, { message: "imageS3Key is required" });
    if (!isOwnedKey(req.userId, imageS3Key)) return json(403, { message: "Forbidden" });
    const receiptId = parseReceiptId(imageS3Key);
    // Receipt keeps the RAW names + prices (provenance); inventory gets canonical.
    const kept = items.filter((i) => i.keep && i.canonicalName.trim() !== "");
    const lineItems = kept.map((i) => ({ name: i.rawName, quantity: i.quantity, unit: i.unit, price: i.price }));
    const receipt = buildReceipt({ userId: req.userId, receiptId, imageS3Key, lineItems });
    await putReceipt(receipt);
    const addedItems = await commitInventory(req.userId, receiptId, items);
    await putCached(req.userId, items.map((i) => ({ rawName: i.rawName, canonicalName: i.canonicalName })));
    return json(200, { receipt, addedItems });
  }
```

- [ ] **Step 4: Run the full backend test suite**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS — all files including `handler.test.ts` (unchanged 401/404/recipes cases), `handler.scan.test.ts`, and every module test.

- [ ] **Step 5: Build the backend to confirm no unused-import / type errors**

Run: `pnpm --filter @receipt-scanner/backend build`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/handler.ts packages/backend/src/handler.scan.test.ts
git commit -m "feat(backend): propose/commit receipt routes with normalization + merge"
```

---

### Task 7: Infra — cache table, Anthropic SSM param, routes, grants

**Files:**
- Modify: `packages/infra/lib/backend-stack.ts`
- Test: `packages/infra/test/backend-stack.test.ts`

**Interfaces:**
- Consumes: the existing `apiFn` Lambda, `httpApi`, `integration`, `authorizer`, imports already present in the stack.
- Produces: a `NormalizationCache` table (env `NORMALIZATION_CACHE_TABLE`), an Anthropic SSM param (env `ANTHROPIC_PARAM_NAME`), and the `/receipts/propose` + `/receipts/commit` routes (replacing `/receipts`).

- [ ] **Step 1: Write the failing assertions**

Open `packages/infra/test/backend-stack.test.ts` and add assertions that the template contains the new resources. Use the existing test's `Template.fromStack(...)` handle (match the variable name already used in that file — assume `template`):

```typescript
it("provisions the normalization cache table", () => {
  template.resourceCountIs("AWS::DynamoDB::Table", 3); // receipts, inventory, normalization cache
});

it("declares the Anthropic SSM parameter", () => {
  template.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/receipt-scanner/anthropic-api-key",
  });
});

it("exposes the propose and commit routes", () => {
  template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "POST /receipts/propose" });
  template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "POST /receipts/commit" });
});
```

(If the existing test constructs the template inside each `it`, follow that structure instead — reuse whatever setup the file already has rather than introducing a new pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter infra exec vitest run test/backend-stack.test.ts`
Expected: FAIL — 2 tables found (not 3), no Anthropic param, propose/commit routes absent.

- [ ] **Step 3: Implement the stack changes**

In `packages/infra/lib/backend-stack.ts`:

1. After the `inventoryTable` definition, add the cache table:

```typescript
    const normalizationCacheTable = new dynamodb.Table(this, "NormalizationCache", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "rawKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
```

2. After the `spoonacularParam` definition, add the Anthropic param:

```typescript
    const anthropicParam = new StringParameter(this, "AnthropicKey", {
      parameterName: "/receipt-scanner/anthropic-api-key",
      stringValue: "REPLACE_ME", // TODO: set the real key out-of-band; do not commit secrets.
    });
```

3. In the `apiFn` `environment` map, add:

```typescript
        NORMALIZATION_CACHE_TABLE: normalizationCacheTable.tableName,
        ANTHROPIC_PARAM_NAME: anthropicParam.parameterName,
```

4. After the existing grants, add:

```typescript
    normalizationCacheTable.grantReadWriteData(apiFn);
    anthropicParam.grantRead(apiFn);
```

5. In the route loop, replace the `{ path: "/receipts", methods: [HttpMethod.POST] }` entry with:

```typescript
      { path: "/receipts/propose", methods: [HttpMethod.POST] },
      { path: "/receipts/commit", methods: [HttpMethod.POST] },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter infra exec vitest run test/backend-stack.test.ts`
Expected: PASS.

- [ ] **Step 5: Synth to confirm the app compiles**

Run: `pnpm --filter infra synth`
Expected: exits 0 (CloudFormation synthesized).

- [ ] **Step 6: Commit**

```bash
git add packages/infra/lib/backend-stack.ts packages/infra/test/backend-stack.test.ts
git commit -m "feat(infra): normalization cache table, Anthropic SSM param, propose/commit routes"
```

---

### Task 8: Frontend review UI

**Files:**
- Modify: `packages/frontend/src/api.ts` (replace `uploadReceipt` with `proposeReceipt` + `commitReceipt`)
- Create: `packages/frontend/src/input/ReceiptReview.tsx`
- Modify: `packages/frontend/src/pages/Scan.tsx` (drive propose → review → commit)

**Interfaces:**
- Consumes: `getUploadUrl`, `uploadToS3` (unchanged); shared `ProposeReceiptResponse`, `CommitReceiptRequest`, `ConfirmedLine`, `ProposedLine`, `ScanReceiptResponse`.
- Produces: `proposeReceipt(file): Promise<ProposeReceiptResponse>`, `commitReceipt(req): Promise<ScanReceiptResponse>`, and a `ReceiptReview` component.

- [ ] **Step 1: Update `api.ts`**

In `packages/frontend/src/api.ts`, update the shared type import to:

```typescript
import type {
  ListInventoryResponse,
  ListRecipesResponse,
  CreateUploadUrlResponse,
  ScanReceiptResponse,
  ProposeReceiptResponse,
  CommitReceiptRequest,
} from "@receipt-scanner/shared";
```

Then replace the `uploadReceipt` function with:

```typescript
export async function proposeReceipt(file: File): Promise<ProposeReceiptResponse> {
  const { uploadUrl, imageS3Key } = await getUploadUrl();
  await uploadToS3(uploadUrl, file);
  const res = await fetch(`${BASE}/receipts/propose`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ imageS3Key }),
  });
  if (!res.ok) throw new Error(`Scan failed: ${res.status}`);
  return res.json();
}

export async function commitReceipt(req: CommitReceiptRequest): Promise<ScanReceiptResponse> {
  const res = await fetch(`${BASE}/receipts/commit`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Commit failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Create `ReceiptReview.tsx`**

Create `packages/frontend/src/input/ReceiptReview.tsx`:

```tsx
import { useState } from "react";
import { Button, NumberInput, Stack, Switch, Table, Text, TextInput, Badge } from "@mantine/core";
import type { ProposedLine, ConfirmedLine } from "@receipt-scanner/shared";

interface Row extends ConfirmedLine {}

function toRow(p: ProposedLine): Row {
  return {
    rawName: p.rawName,
    canonicalName: p.canonicalName,
    quantity: p.quantity,
    unit: p.unit,
    price: p.price,
    keep: p.isFood, // non-food defaults to off
  };
}

export default function ReceiptReview({
  proposals,
  onCommit,
  submitting,
}: {
  proposals: ProposedLine[];
  onCommit: (items: ConfirmedLine[]) => void;
  submitting: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(proposals.map(toRow));

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Stack>
      <Text fw={600}>Review before adding to inventory</Text>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>From receipt</Table.Th>
            <Table.Th>Ingredient</Table.Th>
            <Table.Th>Qty</Table.Th>
            <Table.Th>Keep</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r, i) => (
            <Table.Tr key={i}>
              <Table.Td>
                <Text c="dimmed" size="sm">
                  {r.rawName}
                </Text>
              </Table.Td>
              <Table.Td>
                <TextInput
                  value={r.canonicalName}
                  onChange={(e) => update(i, { canonicalName: e.currentTarget.value })}
                />
              </Table.Td>
              <Table.Td>
                <NumberInput
                  value={r.quantity}
                  min={0}
                  onChange={(v) => update(i, { quantity: typeof v === "number" ? v : 1 })}
                  w={80}
                />
              </Table.Td>
              <Table.Td>
                <Switch checked={r.keep} onChange={(e) => update(i, { keep: e.currentTarget.checked })} />
              </Table.Td>
              <Table.Td>
                <Badge variant="light" color={proposals[i].source === "cache" ? "gray" : "teal"}>
                  {proposals[i].source === "cache" ? "cached" : "AI"}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Button onClick={() => onCommit(rows)} loading={submitting}>
        Confirm &amp; add to inventory
      </Button>
    </Stack>
  );
}
```

- [ ] **Step 3: Rewrite `Scan.tsx` to drive the flow**

Replace `packages/frontend/src/pages/Scan.tsx` with:

```tsx
import { useState } from "react";
import { Alert, Button, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { proposeReceipt, commitReceipt } from "../api.js";
import CameraCapture from "../camera/CameraCapture.js";
import ReceiptDropzone from "../input/ReceiptDropzone.js";
import ReceiptReview from "../input/ReceiptReview.js";
import type { ConfirmedLine, ProposeReceiptResponse } from "@receipt-scanner/shared";

export default function Scan() {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<ProposeReceiptResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"idle" | "camera">("idle");

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setStatus("working");
    setMessage("Uploading and scanning…");
    setProposal(null);
    try {
      const res = await proposeReceipt(file);
      setProposal(res);
      setStatus("idle");
      setMessage(res.proposals.length === 0 ? "No line items found." : "");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Scan failed");
    }
  };

  const handleCommit = async (items: ConfirmedLine[]) => {
    if (!proposal) return;
    setSubmitting(true);
    try {
      const res = await commitReceipt({ imageS3Key: proposal.imageS3Key, items });
      setProposal(null);
      setMessage(`Added ${res.addedItems.length} item(s) to inventory.`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCapture = (file: File) => {
    setMode("idle");
    void handleFile(file);
  };

  return (
    <Stack>
      <Title order={2}>Scan a receipt</Title>
      {mode === "camera" ? (
        <CameraCapture onCapture={handleCapture} onClose={() => setMode("idle")} />
      ) : (
        <Stack>
          <Group>
            <Button onClick={() => setMode("camera")}>Use camera</Button>
            {status === "working" && <Loader size="sm" />}
          </Group>
          <ReceiptDropzone
            onFile={handleFile}
            onError={(m) => {
              setStatus("error");
              setMessage(m);
            }}
            disabled={status === "working"}
          />
        </Stack>
      )}
      {status === "error" ? (
        <Alert color="red">{message}</Alert>
      ) : (
        message !== "" && <Text c="dimmed">{message}</Text>
      )}
      {proposal && proposal.proposals.length > 0 && (
        <ReceiptReview proposals={proposal.proposals} onCommit={handleCommit} submitting={submitting} />
      )}
    </Stack>
  );
}
```

- [ ] **Step 4: Type-check / build the frontend**

Run: `pnpm --filter @receipt-scanner/frontend build`
Expected: exits 0 (no type errors; `uploadReceipt` no longer referenced anywhere).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/input/ReceiptReview.tsx packages/frontend/src/pages/Scan.tsx
git commit -m "feat(frontend): per-receipt review table with editable canonical names"
```

---

### Task 9: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Build everything**

Run: `pnpm -r build`
Expected: all four packages build, exit 0.

- [ ] **Step 2: Test everything**

Run: `pnpm -r test`
Expected: all suites pass (backend module + handler tests, infra stack tests).

- [ ] **Step 3: Synth the CDK app**

Run: `pnpm --filter infra synth`
Expected: exits 0.

- [ ] **Step 4: Commit any incidental fixes**

If steps 1–3 surfaced fixes, commit them:

```bash
git add -A
git commit -m "chore: fixes from full-repo verification of normalization flow"
```

Otherwise, no commit needed.
