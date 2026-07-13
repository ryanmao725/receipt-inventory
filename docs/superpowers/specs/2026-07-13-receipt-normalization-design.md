# Receipt Item Normalization Design

**Date:** 2026-07-13

## Goal

Stop inventory bloat caused by raw, brand-prefixed OCR text becoming inventory
rows. Today `parseExpense` writes whatever Textract prints (`"GV LETTUCE ICEBRG"`,
`"365 ROMAINE HRTS"`) straight into DynamoDB under a random `itemId`, so every
shopping trip adds new rows even for items the user already has, and recipe
matching gets fed cryptic abbreviations. This design normalizes each line to a
**canonical ingredient** using Claude, lets the user **review and edit the whole
receipt before anything is written**, and makes inventory identity canonical so
re-buying an item **increments quantity** instead of adding a duplicate.

## Scope

**In:**
- Split the one-shot `POST /receipts` into a two-phase **propose → commit** flow.
- LLM normalization of raw line names to canonical ingredients via Claude Haiku,
  with an `isFood` flag so fees/tax/totals can be dropped.
- Per-user **normalization cache** (DynamoDB) populated from the user's confirmed
  mappings; read on propose so seen lines resolve free and pre-corrected.
- Canonical inventory identity: `itemId = slug(canonicalName)`, upsert with an
  `ADD` increment so duplicates merge (across receipts and within one receipt).
- Frontend per-receipt **review table** (editable canonical name, qty, keep) with
  provenance badges (`AI` / `cached`), one confirm button per receipt.

**Out (YAGNI):**
- Brand/price metadata on inventory items — the raw line and price already live on
  the receipt in `ReceiptsTable`; join via `sourceReceiptId` if ever needed.
- Distributor / UPC / product-DB lookup — Textract yields printed text, not
  barcodes; the lookup key would itself require the normalization we're building.
- Global (cross-user) cache — per-user only, to avoid one user's edits polluting
  others.
- Cache TTL — ingredient normalization is stable; entries only get more valuable.
- Unit-of-measure parsing — `unit` stays the literal `"unit"` (unchanged).

## Architecture — propose → review → commit

```
SCAN (propose)                          REVIEW              COMMIT
1. get presigned URL, PUT image to S3
2. POST /receipts/propose {imageS3Key}
     Textract AnalyzeExpense
     cache lookup per line; misses ->
       one batched Claude Haiku call
     return proposals (NOTHING written)  user edits table   3. POST /receipts/commit
                                                              write receipt
                                                              upsert inventory (merge)
                                                              write confirmed pairs to cache
```

- **`/propose` is stateless** — Textract + normalize + return. Nothing persists, so
  abandoned scans leave no orphan receipts or inventory.
- **Confirmed edits are ground truth** — commit writes each `rawName -> canonicalName`
  pair to the per-user cache, so next time that line resolves instantly and the way
  the user prefers. Claude only runs on never-before-seen lines.
- **Bloat dies at commit** — inventory identity is the canonical name, so committing
  `lettuce` again `ADD`s to the existing row.

## Components

### `packages/shared/src/index.ts` (modify)
Add:
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
  keep: boolean;
}
export interface CommitReceiptRequest {
  imageS3Key: string;
  items: ConfirmedLine[];
}
// commit reuses the existing ScanReceiptResponse { receipt, addedItems }.
```

### `packages/backend/src/normalize.ts` (new)
Mirrors the `recipes.ts` pattern: pure prompt/parse logic + an injectable client.
- `buildNormalizationPrompt(rawNames: string[]): string` (pure) — asks Claude to
  return, for each raw line, the canonical single-ingredient name (lowercased,
  singular, no brand) and an `isFood` boolean; `"BAG FEE"`, `"TAX"`, `"TOTAL"` ->
  `isFood: false`.
- `parseNormalizationResponse(text: string, rawNames: string[])` (pure) — parses the
  model's JSON array into `{ rawName, canonicalName, isFood }[]`, aligned back to the
  inputs; defensive against missing/extra entries (fall back to the raw name,
  `isFood: true` when uncertain so nothing is silently dropped).
- `normalizeLineItems(userId, lines: ReceiptLineItem[], deps?)` -> `ProposedLine[]`:
  1. `getCached(userId, rawNames)` -> resolve hits, tag `source: "cache"`.
  2. Cache misses -> **one batched** `callClaude(prompt)` -> parse -> tag
     `source: "claude"`.
  3. Merge, preserving each line's `quantity`, `unit`, `price` from Textract.
  `callClaude` (the Anthropic call) is injected so tests run without network.

Claude model: `claude-haiku-4-5`. Exact SDK usage / request shape pinned against the
`claude-api` skill at implementation time. The Anthropic call requests structured
JSON output.

### `packages/backend/src/normcache.ts` (new)
Per-user cache over the `NormalizationCache` table.
- `cacheKey(rawName): string` — uppercase + collapse internal whitespace + trim, so
  minor OCR spacing variance still hits.
- `getCached(userId, rawNames): Promise<Map<rawName, canonicalName>>` — batched read
  (BatchGet or parallel `GetCommand`, matching the `putItems` `Promise.all` style).
- `putCached(userId, pairs: {rawName, canonicalName}[]): Promise<void>` — writes on
  commit; `updatedAt` stamped.

### `packages/backend/src/config.ts` (modify)
Add `getAnthropicApiKey()` resolving SSM `/receipt-scanner/anthropic-api-key` at
runtime, mirroring the existing `getSpoonacularApiKey()` (same SSM client + caching).

### `packages/backend/src/inventory.ts` (modify)
- Replace random `itemId` with `slug(canonicalName)` (`"olive oil"` -> `olive-oil`).
  Add a pure `slug(name): string` helper.
- Replace the `PutCommand` write path with an **upsert** that increments:
  `commitInventory(userId, receiptId, items: ConfirmedLine[])` filters `keep`, then
  per canonical item issues an `UpdateCommand`:
  `SET name = :name, unit = :unit, updatedAt = :now, sourceReceiptId = :rid`
  `ADD quantity :q`. `ADD` accumulates, so duplicate canonicals on one receipt and
  repeat buys across receipts both merge onto one row. Returns the resulting
  `InventoryItem[]` for the response.
- `lineItemsToInventory` is superseded by `commitInventory`; remove or repoint it.
  `listItems` / `updateItem` / `deleteItem` unchanged.

### `packages/backend/src/handler.ts` (modify)
Replace `POST /receipts` with two routes:
- **`POST /receipts/propose`** `{ imageS3Key }`:
  - missing `imageS3Key` -> `400`; `!isOwnedKey` -> `403` (before any AWS call).
  - `receiptId = parseReceiptId(imageS3Key)`;
    `lineItems = await analyzeReceipt(bucket, imageS3Key)`;
    `proposals = await normalizeLineItems(userId, lineItems)`.
  - `return json(200, { receiptId, imageS3Key, proposals })`. Nothing persists.
- **`POST /receipts/commit`** `{ imageS3Key, items }`:
  - missing `imageS3Key` -> `400`; `!isOwnedKey` -> `403`.
  - `receiptId = parseReceiptId(imageS3Key)`.
  - Build a receipt from the confirmed (kept) items; `await putReceipt(receipt)`.
  - `addedItems = await commitInventory(userId, receiptId, items)`.
  - `await putCached(userId, items.map(i => ({rawName, canonicalName})))`.
  - `return json(200, { receipt, addedItems })`.

### `packages/infra/lib/backend-stack.ts` (modify)
- New DynamoDB table `NormalizationCache`: PK `userId` (STRING), SK `rawKey`
  (STRING), `PAY_PER_REQUEST`, `RemovalPolicy.DESTROY`. No TTL. Grant the Lambda
  read/write.
- New SSM `StringParameter` `/receipt-scanner/anthropic-api-key` (`"REPLACE_ME"`
  placeholder, like the Spoonacular one); grant the Lambda `grantRead`. Pass
  `ANTHROPIC_PARAM_NAME` env var.
- Replace HTTP API route `POST /receipts` with `POST /receipts/propose` and
  `POST /receipts/commit` (same integration + JWT authorizer).

### Frontend
- `packages/frontend/src/api.ts`:
  - `proposeReceipt(imageS3Key): Promise<ProposeReceiptResponse>` -> `POST /receipts/propose`.
  - `commitReceipt(req: CommitReceiptRequest): Promise<ScanReceiptResponse>` -> `POST /receipts/commit`.
  - The upload (presigned URL + S3 PUT) helpers stay; the old one-shot scan call is removed.
- `packages/frontend/src/pages/Scan.tsx`: after upload, call `proposeReceipt`, hold
  the proposals in state, and render `ReceiptReview`.
- `packages/frontend/src/input/ReceiptReview.tsx` (new): Mantine `Table`, one row per
  proposed line — read-only raw text, editable canonical `TextInput`, `NumberInput`
  qty, `keep` `Switch` (default off when `isFood === false`), and a `source` badge
  (`AI` / `cached`). One **"Confirm & add to inventory"** button builds
  `ConfirmedLine[]` from current table state and calls `commitReceipt`; on success,
  show a summary and refetch inventory.

## Data flow

`Scan.tsx` -> `getUploadUrl` -> `uploadToS3` -> `proposeReceipt` -> backend
`isOwnedKey` guard -> `analyzeReceipt` (Textract) -> `normalizeLineItems`
(cache + Claude) -> `proposals` -> `ReceiptReview` (user edits) -> `commitReceipt`
-> backend `putReceipt` + `commitInventory` (ADD merge) + `putCached` ->
`{ receipt, addedItems }` -> summary rendered, inventory refetched.

## Error handling

- `/propose`: missing `imageS3Key` -> `400`; foreign key -> `403`; Textract failure
  -> `500`. Zero parsed lines -> `200` with empty `proposals`. Claude failure ->
  `500` (Anthropic key never surfaces in errors, mirroring the Spoonacular
  sanitized-error rule in `recipes.ts`).
- `/commit`: missing `imageS3Key` -> `400`; foreign key -> `403`. Empty `items` (or
  all `keep: false`) -> a receipt with `total 0` and empty `addedItems`, `200`.
  DynamoDB failure -> `500`.
- Missing/`"REPLACE_ME"` Anthropic key: `normalizeLineItems` falls back to raw names
  with `source: "claude"` and `isFood: true` (degrade gracefully rather than 500),
  matching how `/recipes` degrades when the Spoonacular key is unset.

## Testing (TDD)

`packages/backend/src/normalize.test.ts`:
- `buildNormalizationPrompt` includes every raw name.
- `parseNormalizationResponse` maps a well-formed JSON array; tolerates missing/extra
  entries (falls back to raw name, `isFood: true`); handles non-JSON gracefully.
- `normalizeLineItems`: cache hit resolves without calling the injected Claude client
  (`source: "cache"`); miss calls it once for all misses (`source: "claude"`);
  quantity/unit/price carried through from the input lines.

`packages/backend/src/normcache.test.ts`:
- `cacheKey` uppercases, collapses whitespace, trims (`" gv  lettuce "` ->
  `"GV LETTUCE"`).
- `getCached` / `putCached` round-trip via an injected doc-client stub (no AWS).

`packages/backend/src/inventory.test.ts` (add):
- `slug("Olive Oil")` === `"olive-oil"`.
- `commitInventory` drops `keep: false` lines; two lines with the same canonical name
  issue `ADD` updates to the same `itemId` (merge); returns `InventoryItem[]`.

`packages/backend/src/handler.scan.test.ts` (modify):
- `POST /receipts/propose`: `403` on foreign key, `400` on missing key, happy path
  (`analyzeReceipt` + `normalizeLineItems` mocked) -> `200` with `proposals`.
- `POST /receipts/commit`: `403`/`400` guards; happy path (`putReceipt`,
  `commitInventory`, `putCached` mocked) -> `200`; `keep: false` items excluded.

`packages/backend/src/config.test.ts` (add):
- `getAnthropicApiKey` resolves the SSM param via an injected client; caches.

`packages/infra/test/backend-stack.test.ts` (add):
- Template has the `NormalizationCache` table, the Anthropic SSM param, and the
  `/receipts/propose` + `/receipts/commit` routes; synth succeeds.

Frontend has no test harness today; `ReceiptReview`'s `ConfirmedLine[]`-building
logic is kept pure enough to unit-test later if a harness is added.

## Security notes

- `userId` comes only from JWT claims; `isOwnedKey` still guards both propose and
  commit so a caller can only touch objects under `receipts/{their-sub}/`.
- The normalization cache is partitioned by `userId`; no cross-user reads or writes.
- The Anthropic API key is resolved from SSM at runtime (never committed) and, like
  the Spoonacular key, must never reach logs or error messages.
