# Receipt Scan Endpoint Design

**Date:** 2026-06-15

## Goal

Implement the receipt scanning flow end-to-end so a signed-in user can upload a receipt image, have it parsed by Textract, and get a saved receipt plus inventory items added. Replaces the current `POST /receipts` stub (`501`).

## Scope

**In:**
- Presigned S3 upload flow (new `POST /receipts/upload-url`).
- `POST /receipts` scan: Textract → parse → save receipt → add inventory items → return `ScanReceiptResponse`.
- Quantity parsing from Textract's `QUANTITY` field.
- Frontend Scan page wired to the flow, showing the parsed result.

**Out (YAGNI):**
- Inventory merge/dedupe across line items or prior inventory (every parsed line becomes a new `InventoryItem`).
- Unit-of-measure parsing (Textract has no reliable unit field; `unit` stays the literal `"unit"`).
- Merchant extraction from Textract summary fields (`merchant` stays `"Unknown"`).

## Architecture — 3-step flow

1. **`POST /receipts/upload-url`** → server generates `receiptId = randomUUID()` and key `receipts/{userId}/{receiptId}`, returns a presigned S3 **PUT** URL (≈5 min expiry) + the key: `{ uploadUrl, imageS3Key }`.
2. **Browser PUTs** the image bytes directly to S3 via that URL (no Lambda payload limit).
3. **`POST /receipts`** with `{ imageS3Key }` → Lambda validates ownership, runs Textract on the S3 object, parses line items, saves the receipt, converts line items to inventory, persists them, and returns `{ receipt, addedItems }`.

## Components

### `packages/backend/src/upload.ts` (new)
- `buildImageKey(userId, receiptId): string` → `` `receipts/${userId}/${receiptId}` `` (pure).
- `isOwnedKey(userId, key): boolean` → `key.startsWith(`receipts/${userId}/`)` and has exactly one more segment (pure; security check).
- `parseReceiptId(key): string` → last path segment (pure).
- `createUploadUrl(userId, deps?)` → builds a `PutObjectCommand` for the receipts bucket (`process.env.RECEIPTS_BUCKET`) and presigns it with `@aws-sdk/s3-request-presigner` `getSignedUrl` (expires in 300s). Returns `{ uploadUrl, imageS3Key }`. The S3 client and signer are injectable for tests.

New dependency: `@aws-sdk/s3-request-presigner` (`^3.600.0`); `@aws-sdk/client-s3` is already a dependency.

### `packages/backend/src/textract.ts` (modify `parseExpense`)
For each line item, additionally read the `QUANTITY` field:
- `quantity = Number.parseFloat(quantityText)`; if `NaN` or `<= 0`, default to `1`.
- `unit` stays `"unit"`; `price` stays the `PRICE` field value; `name` stays the `ITEM` field value.
Existing behavior (no `QUANTITY` field → quantity `1`) is preserved.

### `packages/backend/src/handler.ts` (modify)
- **`POST /receipts/upload-url`**: `const { uploadUrl, imageS3Key } = await createUploadUrl(req.userId); return json(200, { uploadUrl, imageS3Key });`
- **`POST /receipts`** (replace the `501`):
  - Parse `imageS3Key` from the JSON body; if missing → `400`.
  - If `!isOwnedKey(req.userId, imageS3Key)` → `403` (a user may only scan objects under their own prefix). This happens before any AWS call.
  - `receiptId = parseReceiptId(imageS3Key)`.
  - `lineItems = await analyzeReceipt(process.env.RECEIPTS_BUCKET, imageS3Key)`.
  - `receipt = buildReceipt({ userId, receiptId, imageS3Key, lineItems })`; `await putReceipt(receipt)`.
  - `addedItems = lineItemsToInventory(userId, receiptId, lineItems)`; `await putItems(addedItems)`.
  - `return json(200, { receipt, addedItems })`.
- Routing note: the `/receipts/upload-url` check must come before (or be distinct from) the exact `/receipts` check so the two POST paths don't collide.

### `packages/infra/lib/backend-stack.ts` (modify)
- Add HTTP API route `POST /receipts/upload-url` (same Lambda integration + JWT authorizer as the others).
- Add CORS to the **receipts** bucket so the browser can PUT directly: `cors: [{ allowedMethods: [PUT], allowedOrigins: ["*"], allowedHeaders: ["*"] }]`. (Origins kept `*` for the scaffold; can be tightened to the CloudFront domain later.)
- No new IAM needed: `receiptsBucket.grantReadWrite(apiFn)` already covers `s3:PutObject` (presign) and `s3:GetObject` (Textract read); `textract:AnalyzeExpense` is already granted.

### `packages/shared/src/index.ts` (modify)
Add:
```typescript
export interface CreateUploadUrlResponse {
  uploadUrl: string;
  imageS3Key: string;
}
```
(`ScanReceiptResponse { receipt, addedItems }` already exists.)

### Frontend
- `packages/frontend/src/api.ts`:
  - `getUploadUrl(): Promise<CreateUploadUrlResponse>` → `POST /receipts/upload-url`.
  - `uploadToS3(uploadUrl, file): Promise<void>` → `fetch(uploadUrl, { method: "PUT", body: file })` (no auth header — the URL is presigned).
  - Rewrite `uploadReceipt(file): Promise<ScanReceiptResponse>` to orchestrate: get URL → PUT to S3 → `POST /receipts` with `{ imageS3Key }` → return parsed response.
- `packages/frontend/src/pages/Scan.tsx`: on file select run the flow; show the parsed merchant/total, the line items, and the count of items added to inventory; surface errors.

## Data flow

`Scan.tsx` → `getUploadUrl()` → `uploadToS3()` → `scan POST /receipts` → backend: `isOwnedKey` guard → `analyzeReceipt` (Textract) → `parseExpense` (now with quantity) → `buildReceipt`/`putReceipt` → `lineItemsToInventory`/`putItems` → `{ receipt, addedItems }` → rendered.

## Error handling

- `POST /receipts`: missing `imageS3Key` → `400`; key not owned by the caller → `403`; Textract or DynamoDB failure → `500` (propagates through the handler's normal path). Zero parsed line items → a receipt with `total 0` and an empty `addedItems` list, `200`.
- `POST /receipts/upload-url`: unauthorized (no user) → `401` (existing dispatcher guard).
- Presigned URL expires in 300s.

## Testing (TDD)

`packages/backend/src/upload.test.ts`:
- `buildImageKey("u1","r1")` === `"receipts/u1/r1"`.
- `isOwnedKey("u1","receipts/u1/r1")` true; `isOwnedKey("u1","receipts/u2/r1")` false; `isOwnedKey("u1","receipts/u1/r1/evil")` false.
- `parseReceiptId("receipts/u1/r1")` === `"r1"`.
- `createUploadUrl` returns the key from `buildImageKey` and a URL produced by an injected signer stub (no AWS).

`packages/backend/src/textract.test.ts` (add):
- A line item with a `QUANTITY` field of `"3"` parses to `quantity: 3`; absent/`"abc"`/`"0"` → `quantity: 1`.

`packages/backend/src/handler.test.ts` (add):
- `POST /receipts` with a foreign key (`receipts/other/r1`) → `403` (no mocks needed).
- `POST /receipts` with missing body → `400`.
- `POST /receipts` happy path with `analyzeReceipt`/`putReceipt`/`putItems` mocked (`vi.mock`) → `200` with `{ receipt, addedItems }`.
- `POST /receipts/upload-url` with `createUploadUrl` mocked → `200` with `{ uploadUrl, imageS3Key }`.

Infra tests: add an assertion that the API now has the extra route (HTTP API route count) or simply confirm existing counts still pass; synth must succeed.

## Security notes

- The Lambda derives `userId` only from the JWT authorizer claims (never the body), and `isOwnedKey` ensures a caller can only scan objects under `receipts/{their-own-sub}/`. The presigned PUT URL is likewise scoped to a key under the caller's prefix.
- Presigned URLs are short-lived (300s).
