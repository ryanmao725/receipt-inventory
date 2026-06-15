# Receipt Scan Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the receipt scan flow end-to-end: presigned S3 upload, `POST /receipts` running Textract → parse (with quantity) → save receipt → add inventory items, plus the frontend Scan page.

**Architecture:** Three-step flow — `POST /receipts/upload-url` returns a presigned S3 PUT URL + key `receipts/{userId}/{receiptId}`; the browser PUTs the image to S3; `POST /receipts` validates ownership and runs the Textract→persist pipeline, returning `ScanReceiptResponse`. Inventory gets one new row per parsed line (no merge). `unit` stays `"unit"`; quantity is read from Textract's `QUANTITY` field.

**Tech Stack:** TypeScript (ESM, Node 20), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-textract`, AWS CDK v2, React + Vite, Vitest.

---

## File Structure

```
packages/shared/src/index.ts          # + CreateUploadUrlResponse
packages/backend/
├─ package.json                        # + @aws-sdk/s3-request-presigner
└─ src/
   ├─ upload.ts                        # NEW: key helpers + presigned URL
   ├─ upload.test.ts                   # NEW
   ├─ textract.ts                      # MODIFY: parse QUANTITY
   ├─ textract.test.ts                 # MODIFY: quantity tests
   ├─ handler.ts                       # MODIFY: /receipts/upload-url + POST /receipts scan
   └─ handler.scan.test.ts             # NEW: scan + upload-url route tests (isolated mocks)
packages/infra/
├─ lib/backend-stack.ts                # MODIFY: route + receipts-bucket CORS
└─ test/backend-stack.test.ts          # MODIFY: assert route + CORS
packages/frontend/src/
├─ api.ts                              # MODIFY: getUploadUrl, uploadToS3, uploadReceipt
└─ pages/Scan.tsx                      # MODIFY: run flow, show result
```

---

## Task 1: Shared type + upload module (key helpers + presign)

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/backend/package.json`
- Create: `packages/backend/src/upload.ts`
- Test: `packages/backend/src/upload.test.ts`

- [ ] **Step 1: Add the shared response type**

Append to `packages/shared/src/index.ts`:

```typescript

export interface CreateUploadUrlResponse {
  uploadUrl: string;
  imageS3Key: string;
}
```

Then rebuild shared so consumers resolve the new type:

Run: `pnpm --filter @receipt-scanner/shared build`
Expected: emits updated `dist/index.d.ts`, no errors.

- [ ] **Step 2: Add the presigner dependency**

In `packages/backend/package.json` `"dependencies"`, add next to the other `@aws-sdk/*` entries:

```json
"@aws-sdk/s3-request-presigner": "^3.600.0",
```

Run: `pnpm install`
Expected: installs `@aws-sdk/s3-request-presigner`.

- [ ] **Step 3: Write the failing test**

Create `packages/backend/src/upload.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildImageKey, isOwnedKey, parseReceiptId, createUploadUrl } from "./upload.js";

describe("buildImageKey", () => {
  it("builds receipts/{userId}/{receiptId}", () => {
    expect(buildImageKey("u1", "r1")).toBe("receipts/u1/r1");
  });
});

describe("isOwnedKey", () => {
  it("accepts a key under the user's prefix", () => {
    expect(isOwnedKey("u1", "receipts/u1/r1")).toBe(true);
  });
  it("rejects another user's key", () => {
    expect(isOwnedKey("u1", "receipts/u2/r1")).toBe(false);
  });
  it("rejects a deeper or shorter path", () => {
    expect(isOwnedKey("u1", "receipts/u1/r1/evil")).toBe(false);
    expect(isOwnedKey("u1", "receipts/u1")).toBe(false);
  });
});

describe("parseReceiptId", () => {
  it("returns the last segment", () => {
    expect(parseReceiptId("receipts/u1/r1")).toBe("r1");
  });
});

describe("createUploadUrl", () => {
  it("presigns for the user's key", async () => {
    const presign = vi.fn(async () => "https://signed.example/put");
    const res = await createUploadUrl("u1", () => "r1", presign);
    expect(res).toEqual({ uploadUrl: "https://signed.example/put", imageS3Key: "receipts/u1/r1" });
    expect(presign).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — cannot find module `./upload.js`.

- [ ] **Step 5: Write minimal implementation**

Create `packages/backend/src/upload.ts`:

```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CreateUploadUrlResponse } from "@receipt-scanner/shared";

const BUCKET = process.env.RECEIPTS_BUCKET ?? "";
const s3 = new S3Client({});

/** S3 object key for a user's receipt image. */
export function buildImageKey(userId: string, receiptId: string): string {
  return `receipts/${userId}/${receiptId}`;
}

/** True only for keys of the exact form receipts/{userId}/{receiptId}. */
export function isOwnedKey(userId: string, key: string): boolean {
  const parts = key.split("/");
  return (
    parts.length === 3 &&
    parts[0] === "receipts" &&
    parts[1] === userId &&
    parts[2].length > 0
  );
}

/** Last path segment (the receiptId). */
export function parseReceiptId(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? "";
}

/** Injectable presign so tests don't hit AWS. */
export type PresignFn = (command: PutObjectCommand) => Promise<string>;
const defaultPresign: PresignFn = (command) => getSignedUrl(s3, command, { expiresIn: 300 });

export async function createUploadUrl(
  userId: string,
  newId: () => string = () => crypto.randomUUID(),
  presign: PresignFn = defaultPresign,
): Promise<CreateUploadUrlResponse> {
  const receiptId = newId();
  const imageS3Key = buildImageKey(userId, receiptId);
  const uploadUrl = await presign(new PutObjectCommand({ Bucket: BUCKET, Key: imageS3Key }));
  return { uploadUrl, imageS3Key };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS (upload: 6 tests; all other backend tests still green).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/index.ts packages/backend/package.json packages/backend/src/upload.ts packages/backend/src/upload.test.ts pnpm-lock.yaml
git commit -m "feat(backend): presigned upload URL helpers and CreateUploadUrlResponse type

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Parse quantity from Textract

**Files:**
- Modify: `packages/backend/src/textract.ts`
- Test: `packages/backend/src/textract.test.ts`

- [ ] **Step 1: Add the failing tests**

Add these two tests inside the existing `describe("parseExpense", () => { ... })` block in `packages/backend/src/textract.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — the "Apples" test gets `quantity: 1` (the `QUANTITY` field is currently ignored), not `3`.

- [ ] **Step 3: Update `parseExpense` in `packages/backend/src/textract.ts`**

Replace the body of the innermost `for (const line of group.LineItems ?? [])` loop. Change from:

```typescript
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
```

to:

```typescript
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
          price: priceText ? Number.parseFloat(priceText) : 0,
        });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS — including the original "Milk" test (no `QUANTITY` field → `quantity: 1`) and both new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/textract.ts packages/backend/src/textract.test.ts
git commit -m "feat(backend): parse QUANTITY field from Textract line items

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Handler routes — upload-url + scan

**Files:**
- Modify: `packages/backend/src/handler.ts`
- Test: `packages/backend/src/handler.scan.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/handler.scan.test.ts` (uses module mocks so it doesn't hit AWS; isolated from the existing `handler.test.ts`):

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("./textract.js", () => ({
  analyzeReceipt: vi.fn(async () => [{ name: "Milk", quantity: 2, unit: "unit", price: 3.5 }]),
}));
vi.mock("./receipts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./receipts.js")>()),
  putReceipt: vi.fn(async () => {}),
}));
vi.mock("./inventory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory.js")>()),
  putItems: vi.fn(async () => {}),
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
    const res = await route({
      method: "POST",
      path: "/receipts/upload-url",
      userId: "user-1",
      body: null,
      pathParams: {},
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      uploadUrl: "https://signed.example/put",
      imageS3Key: "receipts/user-1/r1",
    });
  });
});

describe("POST /receipts", () => {
  it("returns 400 when imageS3Key is missing", async () => {
    const res = await route({
      method: "POST",
      path: "/receipts",
      userId: "user-1",
      body: JSON.stringify({}),
      pathParams: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a key owned by another user", async () => {
    const res = await route({
      method: "POST",
      path: "/receipts",
      userId: "user-1",
      body: JSON.stringify({ imageS3Key: "receipts/user-2/r1" }),
      pathParams: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("scans, saves, and returns receipt + added items", async () => {
    const res = await route({
      method: "POST",
      path: "/receipts",
      userId: "user-1",
      body: JSON.stringify({ imageS3Key: "receipts/user-1/r1" }),
      pathParams: {},
    });
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.receipt.userId).toBe("user-1");
    expect(payload.receipt.receiptId).toBe("r1");
    expect(payload.addedItems).toHaveLength(1);
    expect(payload.addedItems[0].name).toBe("Milk");
    expect(payload.addedItems[0].quantity).toBe(2);
    expect(payload.addedItems[0].sourceReceiptId).toBe("r1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — `/receipts/upload-url` returns 404 and `POST /receipts` returns 501 (not yet implemented).

- [ ] **Step 3: Update the imports in `packages/backend/src/handler.ts`**

Replace the existing import block:

```typescript
import { getUserId } from "./auth.js";
import { listItems, updateItem, deleteItem } from "./inventory.js";
import { suggestRecipes } from "./recipes.js";
import { getSpoonacularApiKey } from "./config.js";
```

with:

```typescript
import { getUserId } from "./auth.js";
import { listItems, updateItem, deleteItem, lineItemsToInventory, putItems } from "./inventory.js";
import { suggestRecipes } from "./recipes.js";
import { getSpoonacularApiKey } from "./config.js";
import { analyzeReceipt } from "./textract.js";
import { buildReceipt, putReceipt } from "./receipts.js";
import { createUploadUrl, isOwnedKey, parseReceiptId } from "./upload.js";
```

- [ ] **Step 4: Replace the `POST /receipts` stub with the upload-url + scan branches**

In `route(...)`, replace this block:

```typescript
  if (req.method === "POST" && req.path === "/receipts") {
    // TODO: presigned-upload + Textract + persistence flow wired in Task 10 follow-up.
    return json(501, { message: "Not implemented in scaffold" });
  }
```

with:

```typescript
  if (req.method === "POST" && req.path === "/receipts/upload-url") {
    const { uploadUrl, imageS3Key } = await createUploadUrl(req.userId);
    return json(200, { uploadUrl, imageS3Key });
  }
  if (req.method === "POST" && req.path === "/receipts") {
    const imageS3Key: string = JSON.parse(req.body ?? "{}").imageS3Key ?? "";
    if (!imageS3Key) return json(400, { message: "imageS3Key is required" });
    if (!isOwnedKey(req.userId, imageS3Key)) return json(403, { message: "Forbidden" });
    const receiptId = parseReceiptId(imageS3Key);
    const bucket = process.env.RECEIPTS_BUCKET ?? "";
    const lineItems = await analyzeReceipt(bucket, imageS3Key);
    const receipt = buildReceipt({ userId: req.userId, receiptId, imageS3Key, lineItems });
    await putReceipt(receipt);
    const addedItems = lineItemsToInventory(req.userId, receiptId, lineItems);
    await putItems(addedItems);
    return json(200, { receipt, addedItems });
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS — the new scan/upload-url tests plus all existing backend tests.

- [ ] **Step 6: Build the backend to catch type errors**

Run: `pnpm --filter @receipt-scanner/backend build`
Expected: compiles with no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/handler.ts packages/backend/src/handler.scan.test.ts
git commit -m "feat(backend): implement /receipts/upload-url and POST /receipts scan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: CDK — add the route and receipts-bucket CORS

**Files:**
- Modify: `packages/infra/lib/backend-stack.ts`
- Test: `packages/infra/test/backend-stack.test.ts`

- [ ] **Step 1: Add the failing assertions**

In `packages/infra/test/backend-stack.test.ts`, update the import to include `Match`:

```typescript
import { Template, Match } from "aws-cdk-lib/assertions";
```

Add these tests inside the existing `describe("BackendStack", () => { ... })` block:

```typescript
  it("exposes the presigned-upload route", () => {
    template().hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /receipts/upload-url",
    });
  });

  it("allows browser PUT uploads to the receipts bucket via CORS", () => {
    template().hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({ AllowedMethods: Match.arrayWith(["PUT"]) }),
        ]),
      },
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter infra test`
Expected: FAIL — no route with key `POST /receipts/upload-url`, and the receipts bucket has no `CorsConfiguration`.

- [ ] **Step 3: Add CORS to the receipts bucket**

In `packages/infra/lib/backend-stack.ts`, change the `receiptsBucket` definition from:

```typescript
    const receiptsBucket = new s3.Bucket(this, "ReceiptsBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });
```

to:

```typescript
    const receiptsBucket = new s3.Bucket(this, "ReceiptsBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          // Browsers PUT receipt images directly via presigned URLs.
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ["*"], // TODO: tighten to the CloudFront domain.
          allowedHeaders: ["*"],
        },
      ],
    });
```

- [ ] **Step 4: Add the upload-url route**

In the `for (const route of [ ... ])` array that defines HTTP API routes, add the upload-url entry as the first element:

```typescript
    for (const route of [
      { path: "/receipts/upload-url", methods: [HttpMethod.POST] },
      { path: "/receipts", methods: [HttpMethod.POST] },
      { path: "/inventory", methods: [HttpMethod.GET] },
      { path: "/inventory/{id}", methods: [HttpMethod.PATCH, HttpMethod.DELETE] },
      { path: "/recipes", methods: [HttpMethod.GET] },
    ]) {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter infra test`
Expected: PASS (backend now 6 tests, frontend 2, oidc 3).

- [ ] **Step 6: Synthesize to confirm the stack is valid**

Run: `pnpm --filter infra exec cdk synth receipt-scanner-backend`
Expected: synth succeeds, no errors. (Synth needs no AWS credentials.)

- [ ] **Step 7: Commit**

```bash
git add packages/infra/lib/backend-stack.ts packages/infra/test/backend-stack.test.ts
git commit -m "feat(infra): add upload-url route and receipts-bucket CORS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — upload flow + Scan page

**Files:**
- Modify: `packages/frontend/src/api.ts`
- Modify: `packages/frontend/src/pages/Scan.tsx`

- [ ] **Step 1: Update `packages/frontend/src/api.ts`**

Change the type import to add the two new types:

```typescript
import type {
  ListInventoryResponse,
  ListRecipesResponse,
  CreateUploadUrlResponse,
  ScanReceiptResponse,
} from "@receipt-scanner/shared";
```

Replace the existing `uploadReceipt` function:

```typescript
export async function uploadReceipt(file: File): Promise<Response> {
  // TODO: switch to presigned S3 upload; scaffold posts the raw file.
  const headers = await authHeaders();
  return fetch(`${BASE}/receipts`, {
    method: "POST",
    headers: { authorization: (headers as Record<string, string>).authorization },
    body: file,
  });
}
```

with:

```typescript
export async function getUploadUrl(): Promise<CreateUploadUrlResponse> {
  const res = await fetch(`${BASE}/receipts/upload-url`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Could not get upload URL: ${res.status}`);
  return res.json();
}

export async function uploadToS3(uploadUrl: string, file: File): Promise<void> {
  // Presigned URL — no auth header; the URL itself authorizes the PUT.
  const res = await fetch(uploadUrl, { method: "PUT", body: file });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

export async function uploadReceipt(file: File): Promise<ScanReceiptResponse> {
  const { uploadUrl, imageS3Key } = await getUploadUrl();
  await uploadToS3(uploadUrl, file);
  const res = await fetch(`${BASE}/receipts`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ imageS3Key }),
  });
  if (!res.ok) throw new Error(`Scan failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Update `packages/frontend/src/pages/Scan.tsx`**

Replace the whole file with:

```tsx
import { useState } from "react";
import { uploadReceipt } from "../api.js";
import type { ScanReceiptResponse } from "@receipt-scanner/shared";

export default function Scan() {
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<ScanReceiptResponse | null>(null);
  return (
    <section>
      <h2>Scan a receipt</h2>
      <input
        type="file"
        accept="image/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setStatus("Uploading and scanning…");
          setResult(null);
          try {
            const res = await uploadReceipt(file);
            setResult(res);
            setStatus(`Added ${res.addedItems.length} item(s) to inventory.`);
          } catch (err) {
            setStatus(err instanceof Error ? err.message : "Scan failed");
          }
        }}
      />
      <p>{status}</p>
      {result && (
        <div>
          <h3>
            {result.receipt.merchant} — ${result.receipt.total.toFixed(2)}
          </h3>
          <ul>
            {result.receipt.lineItems.map((li, i) => (
              <li key={i}>
                {li.quantity} × {li.name} — ${li.price.toFixed(2)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Build the frontend (type-check + bundle)**

The frontend has no unit tests; the build is the gate. Ensure shared is built first (it was in Task 1, but rebuild to be safe):

Run: `pnpm --filter @receipt-scanner/shared build && pnpm --filter @receipt-scanner/frontend build`
Expected: type-checks and produces `packages/frontend/dist/` with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/pages/Scan.tsx
git commit -m "feat(frontend): presigned upload flow and scan result display

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **ESM imports** use `.js` extensions in TS source.
- **`req.userId` is non-null inside route branches** — the dispatcher returns 401 at the top when `userId` is falsy, so `createUploadUrl(req.userId)` and the scan branch can treat it as a `string`.
- **Why `handler.scan.test.ts` is a separate file:** it uses `vi.mock` on `./textract.js`, `./receipts.js`, `./inventory.js`, and `./upload.js`. Keeping it separate from `handler.test.ts` avoids those hoisted mocks affecting the existing 401/404/recipes tests.
- **No deploy in this plan.** After all tasks, redeploying the backend (`cdk deploy receipt-scanner-backend`) and re-uploading the frontend bundle are separate steps to run when ready.
- **Mocks keep pure functions real:** the scan happy-path test mocks only the AWS-touching functions (`analyzeReceipt`, `putReceipt`, `putItems`, `createUploadUrl`) and relies on the real `buildReceipt`, `lineItemsToInventory`, `isOwnedKey`, and `parseReceiptId`.
```
