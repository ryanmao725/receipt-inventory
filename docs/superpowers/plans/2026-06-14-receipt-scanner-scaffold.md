# Receipt Scanner Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable AWS scaffold for a receipt-scanning app — scan receipts (Textract), manage inventory (DynamoDB), suggest recipes (Spoonacular) — as a pnpm monorepo with separate shared, frontend, backend, and CDK infra packages.

**Architecture:** pnpm workspace with four packages. `shared` holds TypeScript types consumed by both `frontend` (React + Vite SPA) and `backend` (Node Lambda handlers behind an API Gateway HTTP API with a Cognito JWT authorizer). `infra` is a CDK app defining one stack: Cognito User Pool, two DynamoDB tables, S3 buckets, Lambda, HTTP API, CloudFront, and SSM config. Business logic (Textract parsing, Spoonacular) is wired but minimally stubbed with `// TODO` markers.

**Tech Stack:** TypeScript, pnpm workspaces, React 18 + Vite, AWS Lambda (Node 20), AWS CDK v2 (`aws-cdk-lib`), DynamoDB, S3, Cognito, Textract `AnalyzeExpense`, AWS SDK v3, Amplify v6 (`aws-amplify` + `@aws-amplify/ui-react`), Vitest.

---

## File Structure

```
receipt-scanner/
├─ package.json                 # root workspace scripts
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .gitignore
└─ packages/
   ├─ shared/
   │  ├─ package.json
   │  ├─ tsconfig.json
   │  └─ src/index.ts           # Receipt, InventoryItem, Recipe, API DTOs
   ├─ backend/
   │  ├─ package.json
   │  ├─ tsconfig.json
   │  ├─ vitest.config.ts
   │  └─ src/
   │     ├─ handler.ts          # API route dispatch + JWT claim extraction
   │     ├─ auth.ts             # extract userId (sub) from authorizer claims
   │     ├─ textract.ts         # AnalyzeExpense -> ReceiptLineItem[] (stub)
   │     ├─ inventory.ts        # DynamoDB inventory access + merge logic
   │     ├─ receipts.ts         # DynamoDB receipts access
   │     ├─ recipes.ts          # Spoonacular client (stub)
   │     └─ *.test.ts
   ├─ frontend/
   │  ├─ package.json
   │  ├─ tsconfig.json
   │  ├─ vite.config.ts
   │  ├─ index.html
   │  └─ src/
   │     ├─ main.tsx            # Amplify config + Authenticator wrapper
   │     ├─ App.tsx             # nav between 3 pages
   │     ├─ api.ts              # fetch wrapper attaching Cognito JWT
   │     └─ pages/{Scan,Inventory,Recipes}.tsx
   └─ infra/
      ├─ package.json
      ├─ tsconfig.json
      ├─ cdk.json
      ├─ vitest.config.ts
      ├─ bin/app.ts
      ├─ lib/receipt-scanner-stack.ts
      └─ test/stack.test.ts
```

---

## Task 1: Monorepo root setup

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "receipt-scanner",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "synth": "pnpm --filter infra synth"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "composite": false
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
cdk.out/
*.tsbuildinfo
.env
.DS_Store
```

- [ ] **Step 5: Install and verify workspace resolves**

Run: `pnpm install`
Expected: completes without error; creates `pnpm-lock.yaml`.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo root"
```

---

## Task 2: Shared types package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@receipt-scanner/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "echo \"no tests\" && exit 0"
  },
  "devDependencies": { "typescript": "^5.4.0" }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/shared/src/index.ts`**

```typescript
export interface ReceiptLineItem {
  name: string;
  quantity: number;
  unit: string;
  price: number;
}

export interface Receipt {
  userId: string;
  receiptId: string;
  merchant: string;
  purchasedAt: string; // ISO date
  total: number;
  imageS3Key: string;
  lineItems: ReceiptLineItem[];
  createdAt: string; // ISO date
}

export interface InventoryItem {
  userId: string;
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  sourceReceiptId: string | null;
  updatedAt: string; // ISO date
}

export interface Recipe {
  id: string;
  title: string;
  usedIngredients: string[];
  missedIngredients: string[];
  sourceUrl: string;
}

// API DTOs
export interface ScanReceiptResponse {
  receipt: Receipt;
  addedItems: InventoryItem[];
}

export interface ListInventoryResponse {
  items: InventoryItem[];
}

export interface UpdateInventoryItemRequest {
  quantity?: number;
  unit?: string;
  name?: string;
}

export interface ListRecipesResponse {
  recipes: Recipe[];
}
```

- [ ] **Step 4: Build to verify types compile**

Run: `pnpm --filter @receipt-scanner/shared build`
Expected: produces `packages/shared/dist/index.js` and `index.d.ts`, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add cross-package domain and API types"
```

---

## Task 3: Backend package setup

**Files:**
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/backend/vitest.config.ts`

- [ ] **Step 1: Create `packages/backend/package.json`**

```json
{
  "name": "@receipt-scanner/backend",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@receipt-scanner/shared": "workspace:*",
    "@aws-sdk/client-dynamodb": "^3.600.0",
    "@aws-sdk/lib-dynamodb": "^3.600.0",
    "@aws-sdk/client-s3": "^3.600.0",
    "@aws-sdk/client-textract": "^3.600.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.137",
    "@types/node": "^20.12.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/backend/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "types": ["node"] },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/backend/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 4: Install**

Run: `pnpm install`
Expected: installs backend deps, links `@receipt-scanner/shared` via workspace.

- [ ] **Step 5: Commit**

```bash
git add packages/backend pnpm-lock.yaml
git commit -m "chore(backend): set up package, tsconfig, vitest"
```

---

## Task 4: Auth claim extraction

**Files:**
- Create: `packages/backend/src/auth.ts`
- Test: `packages/backend/src/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/src/auth.test.ts
import { describe, it, expect } from "vitest";
import { getUserId } from "./auth.js";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

function eventWithSub(sub: string | undefined) {
  return {
    requestContext: { authorizer: { jwt: { claims: sub ? { sub } : {} } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe("getUserId", () => {
  it("returns the sub claim", () => {
    expect(getUserId(eventWithSub("user-123"))).toBe("user-123");
  });

  it("throws when sub is missing", () => {
    expect(() => getUserId(eventWithSub(undefined))).toThrow("Unauthorized");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — cannot find module `./auth.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/backend/src/auth.ts
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

export function getUserId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("Unauthorized");
  }
  return sub;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/auth.ts packages/backend/src/auth.test.ts
git commit -m "feat(backend): extract user id from JWT authorizer claims"
```

---

## Task 5: Textract receipt parsing (stub)

**Files:**
- Create: `packages/backend/src/textract.ts`
- Test: `packages/backend/src/textract.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/src/textract.test.ts
import { describe, it, expect } from "vitest";
import { parseExpense } from "./textract.js";
import type { AnalyzeExpenseCommandOutput } from "@aws-sdk/client-textract";

describe("parseExpense", () => {
  it("maps expense line items to ReceiptLineItem[]", () => {
    const output = {
      ExpenseDocuments: [
        {
          LineItemGroups: [
            {
              LineItems: [
                {
                  LineItemExpenseFields: [
                    { Type: { Text: "ITEM" }, ValueDetection: { Text: "Milk" } },
                    { Type: { Text: "PRICE" }, ValueDetection: { Text: "3.50" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AnalyzeExpenseCommandOutput;

    const items = parseExpense(output);
    expect(items).toEqual([{ name: "Milk", quantity: 1, unit: "unit", price: 3.5 }]);
  });

  it("returns an empty array when there are no documents", () => {
    expect(parseExpense({} as AnalyzeExpenseCommandOutput)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — cannot find module `./textract.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/backend/src/textract.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/textract.ts packages/backend/src/textract.test.ts
git commit -m "feat(backend): parse Textract AnalyzeExpense into line items"
```

---

## Task 6: Inventory merge logic + DynamoDB access

**Files:**
- Create: `packages/backend/src/inventory.ts`
- Test: `packages/backend/src/inventory.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/src/inventory.test.ts
import { describe, it, expect } from "vitest";
import { lineItemsToInventory } from "./inventory.js";
import type { ReceiptLineItem } from "@receipt-scanner/shared";

describe("lineItemsToInventory", () => {
  it("converts line items to inventory items scoped to a user and receipt", () => {
    const lines: ReceiptLineItem[] = [
      { name: "Milk", quantity: 1, unit: "unit", price: 3.5 },
    ];
    const result = lineItemsToInventory("user-1", "rec-1", lines, () => "item-1", () => "2026-06-14T00:00:00Z");
    expect(result).toEqual([
      {
        userId: "user-1",
        itemId: "item-1",
        name: "Milk",
        quantity: 1,
        unit: "unit",
        sourceReceiptId: "rec-1",
        updatedAt: "2026-06-14T00:00:00Z",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — cannot find module `./inventory.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/backend/src/inventory.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/inventory.ts packages/backend/src/inventory.test.ts
git commit -m "feat(backend): inventory mapping and DynamoDB access"
```

---

## Task 7: Receipts persistence

**Files:**
- Create: `packages/backend/src/receipts.ts`
- Test: `packages/backend/src/receipts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/src/receipts.test.ts
import { describe, it, expect } from "vitest";
import { buildReceipt } from "./receipts.js";
import type { ReceiptLineItem } from "@receipt-scanner/shared";

describe("buildReceipt", () => {
  it("assembles a Receipt record from parsed line items", () => {
    const lines: ReceiptLineItem[] = [{ name: "Milk", quantity: 1, unit: "unit", price: 3.5 }];
    const receipt = buildReceipt({
      userId: "user-1",
      receiptId: "rec-1",
      imageS3Key: "receipts/user-1/rec-1.jpg",
      lineItems: lines,
      now: () => "2026-06-14T00:00:00Z",
    });
    expect(receipt.total).toBe(3.5);
    expect(receipt.userId).toBe("user-1");
    expect(receipt.lineItems).toHaveLength(1);
    expect(receipt.createdAt).toBe("2026-06-14T00:00:00Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — cannot find module `./receipts.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/backend/src/receipts.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/receipts.ts packages/backend/src/receipts.test.ts
git commit -m "feat(backend): build and persist receipt records"
```

---

## Task 8: Recipes (Spoonacular client stub)

**Files:**
- Create: `packages/backend/src/recipes.ts`
- Test: `packages/backend/src/recipes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/src/recipes.test.ts
import { describe, it, expect, vi } from "vitest";
import { mapSpoonacularResults, suggestRecipes } from "./recipes.js";

describe("mapSpoonacularResults", () => {
  it("maps Spoonacular findByIngredients results to Recipe[]", () => {
    const raw = [
      {
        id: 42,
        title: "Pancakes",
        usedIngredients: [{ name: "milk" }],
        missedIngredients: [{ name: "flour" }],
      },
    ];
    expect(mapSpoonacularResults(raw)).toEqual([
      {
        id: "42",
        title: "Pancakes",
        usedIngredients: ["milk"],
        missedIngredients: ["flour"],
        sourceUrl: "https://spoonacular.com/recipes/pancakes-42",
      },
    ]);
  });
});

describe("suggestRecipes", () => {
  it("returns empty array when there are no ingredients", async () => {
    const fetchFn = vi.fn();
    const result = await suggestRecipes([], "fake-key", fetchFn);
    expect(result).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — cannot find module `./recipes.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/backend/src/recipes.ts
import type { Recipe } from "@receipt-scanner/shared";

interface SpoonacularIngredient { name: string }
interface SpoonacularResult {
  id: number;
  title: string;
  usedIngredients?: SpoonacularIngredient[];
  missedIngredients?: SpoonacularIngredient[];
}

export function mapSpoonacularResults(raw: SpoonacularResult[]): Recipe[] {
  return raw.map((r) => ({
    id: String(r.id),
    title: r.title,
    usedIngredients: (r.usedIngredients ?? []).map((i) => i.name),
    missedIngredients: (r.missedIngredients ?? []).map((i) => i.name),
    sourceUrl: `https://spoonacular.com/recipes/${r.title.toLowerCase().replace(/\s+/g, "-")}-${r.id}`,
  }));
}

/** Queries Spoonacular findByIngredients. `fetchFn` is injectable for testing. */
export async function suggestRecipes(
  ingredients: string[],
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<Recipe[]> {
  if (ingredients.length === 0) return [];
  // TODO: add ranking/number params and error handling for non-200 responses.
  const url = new URL("https://api.spoonacular.com/recipes/findByIngredients");
  url.searchParams.set("ingredients", ingredients.join(","));
  url.searchParams.set("number", "10");
  url.searchParams.set("apiKey", apiKey);
  const res = await fetchFn(url.toString());
  const raw = (await res.json()) as SpoonacularResult[];
  return mapSpoonacularResults(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/recipes.ts packages/backend/src/recipes.test.ts
git commit -m "feat(backend): Spoonacular recipe suggestion client"
```

---

## Task 9: API handler (route dispatch)

**Files:**
- Create: `packages/backend/src/handler.ts`
- Test: `packages/backend/src/handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/src/handler.test.ts
import { describe, it, expect } from "vitest";
import { route } from "./handler.js";

describe("route", () => {
  it("returns 401 when there is no user sub", async () => {
    const res = await route({
      method: "GET",
      path: "/inventory",
      userId: null,
      body: null,
      pathParams: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for an unknown route", async () => {
    const res = await route({
      method: "GET",
      path: "/nope",
      userId: "user-1",
      body: null,
      pathParams: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — cannot find module `./handler.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/backend/src/handler.ts
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { getUserId } from "./auth.js";
import { listItems, updateItem, deleteItem } from "./inventory.js";
import { suggestRecipes } from "./recipes.js";

export interface RouteInput {
  method: string;
  path: string;
  userId: string | null;
  body: string | null;
  pathParams: Record<string, string | undefined>;
}

export interface RouteResult {
  statusCode: number;
  body: string;
}

const json = (statusCode: number, data: unknown): RouteResult => ({
  statusCode,
  body: JSON.stringify(data),
});

/** Pure-ish dispatcher: maps a normalized request to a response. */
export async function route(req: RouteInput): Promise<RouteResult> {
  if (!req.userId) return json(401, { message: "Unauthorized" });

  if (req.method === "GET" && req.path === "/inventory") {
    return json(200, { items: await listItems(req.userId) });
  }
  if (req.method === "PATCH" && req.path.startsWith("/inventory/")) {
    const id = req.pathParams.id ?? "";
    await updateItem(req.userId, id, JSON.parse(req.body ?? "{}"));
    return json(200, { ok: true });
  }
  if (req.method === "DELETE" && req.path.startsWith("/inventory/")) {
    await deleteItem(req.userId, req.pathParams.id ?? "");
    return json(200, { ok: true });
  }
  if (req.method === "GET" && req.path === "/recipes") {
    const items = await listItems(req.userId);
    const apiKey = process.env.SPOONACULAR_API_KEY ?? "";
    const recipes = await suggestRecipes(items.map((i) => i.name), apiKey);
    return json(200, { recipes });
  }
  if (req.method === "POST" && req.path === "/receipts") {
    // TODO: presigned-upload + Textract + persistence flow wired in Task 10 follow-up.
    return json(501, { message: "Not implemented in scaffold" });
  }
  return json(404, { message: "Not found" });
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  let userId: string | null = null;
  try {
    userId = getUserId(event);
  } catch {
    userId = null;
  }
  const res = await route({
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    userId,
    body: event.body ?? null,
    pathParams: event.pathParameters ?? {},
  });
  return { statusCode: res.statusCode, headers: { "content-type": "application/json" }, body: res.body };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS (all backend tests green).

- [ ] **Step 5: Build the backend**

Run: `pnpm --filter @receipt-scanner/backend build`
Expected: compiles with no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/handler.ts packages/backend/src/handler.test.ts
git commit -m "feat(backend): API route dispatcher and Lambda handler"
```

---

## Task 10: CDK infra package setup

**Files:**
- Create: `packages/infra/package.json`
- Create: `packages/infra/tsconfig.json`
- Create: `packages/infra/cdk.json`
- Create: `packages/infra/vitest.config.ts`
- Create: `packages/infra/bin/app.ts`

- [ ] **Step 1: Create `packages/infra/package.json`**

```json
{
  "name": "infra",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "synth": "cdk synth",
    "deploy": "cdk deploy",
    "test": "vitest run"
  },
  "dependencies": {
    "@receipt-scanner/backend": "workspace:*",
    "aws-cdk-lib": "^2.150.0",
    "constructs": "^10.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "aws-cdk": "^2.150.0",
    "tsx": "^4.15.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/infra/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": ".", "module": "NodeNext", "moduleResolution": "NodeNext", "types": ["node"] },
  "include": ["bin", "lib", "test"]
}
```

- [ ] **Step 3: Create `packages/infra/cdk.json`**

```json
{
  "app": "tsx bin/app.ts"
}
```

- [ ] **Step 4: Create `packages/infra/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node", include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 5: Create `packages/infra/bin/app.ts`**

```typescript
import { App } from "aws-cdk-lib";
import { ReceiptScannerStack } from "../lib/receipt-scanner-stack.js";

const app = new App();
new ReceiptScannerStack(app, "ReceiptScannerStack", {});
```

- [ ] **Step 6: Install**

Run: `pnpm install`
Expected: installs CDK deps.

- [ ] **Step 7: Commit**

```bash
git add packages/infra pnpm-lock.yaml
git commit -m "chore(infra): set up CDK app skeleton"
```

---

## Task 11: CDK stack definition

**Files:**
- Create: `packages/infra/lib/receipt-scanner-stack.ts`
- Test: `packages/infra/test/stack.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/infra/test/stack.test.ts
import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ReceiptScannerStack } from "../lib/receipt-scanner-stack.js";

function template() {
  const app = new App();
  const stack = new ReceiptScannerStack(app, "TestStack", {});
  return Template.fromStack(stack);
}

describe("ReceiptScannerStack", () => {
  it("creates two DynamoDB tables", () => {
    template().resourceCountIs("AWS::DynamoDB::Table", 2);
  });

  it("creates a Cognito user pool", () => {
    template().resourceCountIs("AWS::Cognito::UserPool", 1);
  });

  it("creates an HTTP API", () => {
    template().resourceCountIs("AWS::ApiGatewayV2::Api", 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter infra test`
Expected: FAIL — cannot find module `../lib/receipt-scanner-stack.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/infra/lib/receipt-scanner-stack.ts
import { Stack, type StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { HttpApi, HttpMethod, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ReceiptScannerStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // --- Storage ---
    const receiptsBucket = new s3.Bucket(this, "ReceiptsBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const receiptsTable = new dynamodb.Table(this, "ReceiptsTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "receiptId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const inventoryTable = new dynamodb.Table(this, "InventoryTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "itemId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- Auth ---
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 8, requireDigits: true, requireLowercase: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPoolClient = userPool.addClient("WebClient", {
      authFlows: { userSrp: true },
    });

    // --- Config ---
    const spoonacularParam = new StringParameter(this, "SpoonacularKey", {
      parameterName: "/receipt-scanner/spoonacular-api-key",
      stringValue: "REPLACE_ME", // TODO: set the real key out-of-band; do not commit secrets.
    });

    // --- Compute ---
    const apiFn = new NodejsFunction(this, "ApiFn", {
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirname, "../../backend/src/handler.ts"),
      handler: "handler",
      environment: {
        RECEIPTS_TABLE: receiptsTable.tableName,
        INVENTORY_TABLE: inventoryTable.tableName,
        RECEIPTS_BUCKET: receiptsBucket.bucketName,
        SPOONACULAR_API_KEY: spoonacularParam.stringValue,
      },
      bundling: { format: undefined },
    });

    receiptsTable.grantReadWriteData(apiFn);
    inventoryTable.grantReadWriteData(apiFn);
    receiptsBucket.grantReadWrite(apiFn);
    apiFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["textract:AnalyzeExpense"],
        resources: ["*"],
      }),
    );

    // --- API ---
    const authorizer = new HttpJwtAuthorizer("JwtAuthorizer", userPool.userPoolProviderUrl, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });

    const httpApi = new HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.ANY],
        allowHeaders: ["authorization", "content-type"],
      },
    });

    const integration = new HttpLambdaIntegration("ApiIntegration", apiFn);
    for (const route of [
      { path: "/receipts", methods: [HttpMethod.POST] },
      { path: "/inventory", methods: [HttpMethod.GET] },
      { path: "/inventory/{id}", methods: [HttpMethod.PATCH, HttpMethod.DELETE] },
      { path: "/recipes", methods: [HttpMethod.GET] },
    ]) {
      httpApi.addRoutes({ path: route.path, methods: route.methods, integration, authorizer });
    }

    // --- Outputs (consumed by frontend build) ---
    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "Region", { value: this.region });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter infra test`
Expected: PASS (3 tests).

- [ ] **Step 5: Synth the stack end-to-end**

Run: `pnpm --filter infra synth`
Expected: prints CloudFormation YAML, no synth errors. (Requires Docker or esbuild for NodejsFunction bundling; if esbuild is missing, run `pnpm add -D esbuild -w` and retry.)

- [ ] **Step 6: Commit**

```bash
git add packages/infra/lib packages/infra/test
git commit -m "feat(infra): CDK stack for tables, Cognito, Lambda, HTTP API"
```

---

## Task 12: Frontend package setup

**Files:**
- Create: `packages/frontend/package.json`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/frontend/vite.config.ts`
- Create: `packages/frontend/index.html`

- [ ] **Step 1: Create `packages/frontend/package.json`**

```json
{
  "name": "@receipt-scanner/frontend",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview",
    "test": "echo \"no tests\" && exit 0"
  },
  "dependencies": {
    "@receipt-scanner/shared": "workspace:*",
    "aws-amplify": "^6.4.0",
    "@aws-amplify/ui-react": "^6.1.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.4.0",
    "vite": "^5.3.0"
  }
}
```

- [ ] **Step 2: Create `packages/frontend/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "noEmit": true, "types": ["vite/client"] },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/frontend/vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
```

- [ ] **Step 4: Create `packages/frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Receipt Scanner</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Install**

Run: `pnpm install`
Expected: installs frontend deps.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend pnpm-lock.yaml
git commit -m "chore(frontend): set up Vite + React package"
```

---

## Task 13: Frontend app (auth + API client + pages)

**Files:**
- Create: `packages/frontend/src/main.tsx`
- Create: `packages/frontend/src/App.tsx`
- Create: `packages/frontend/src/api.ts`
- Create: `packages/frontend/src/pages/Scan.tsx`
- Create: `packages/frontend/src/pages/Inventory.tsx`
- Create: `packages/frontend/src/pages/Recipes.tsx`
- Create: `packages/frontend/.env.example`

- [ ] **Step 1: Create `packages/frontend/.env.example`**

```
VITE_API_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com
VITE_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=us-east-1
```

- [ ] **Step 2: Create `packages/frontend/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import App from "./App.js";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Authenticator>{() => <App />}</Authenticator>
  </React.StrictMode>,
);
```

- [ ] **Step 3: Create `packages/frontend/src/api.ts`**

```typescript
import { fetchAuthSession } from "aws-amplify/auth";
import type {
  ListInventoryResponse,
  ListRecipesResponse,
} from "@receipt-scanner/shared";

const BASE = import.meta.env.VITE_API_URL as string;

async function authHeaders(): Promise<HeadersInit> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString() ?? "";
  return { authorization: token, "content-type": "application/json" };
}

export async function getInventory(): Promise<ListInventoryResponse> {
  const res = await fetch(`${BASE}/inventory`, { headers: await authHeaders() });
  return res.json();
}

export async function getRecipes(): Promise<ListRecipesResponse> {
  const res = await fetch(`${BASE}/recipes`, { headers: await authHeaders() });
  return res.json();
}

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

- [ ] **Step 4: Create `packages/frontend/src/pages/Scan.tsx`**

```tsx
import { useState } from "react";
import { uploadReceipt } from "../api.js";

export default function Scan() {
  const [status, setStatus] = useState("");
  return (
    <section>
      <h2>Scan a receipt</h2>
      <input
        type="file"
        accept="image/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setStatus("Uploading…");
          const res = await uploadReceipt(file);
          setStatus(res.ok ? "Uploaded" : `Error: ${res.status}`);
        }}
      />
      <p>{status}</p>
    </section>
  );
}
```

- [ ] **Step 5: Create `packages/frontend/src/pages/Inventory.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getInventory } from "../api.js";
import type { InventoryItem } from "@receipt-scanner/shared";

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  useEffect(() => {
    getInventory().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  return (
    <section>
      <h2>Inventory</h2>
      <ul>
        {items.map((i) => (
          <li key={i.itemId}>{i.name} — {i.quantity} {i.unit}</li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Create `packages/frontend/src/pages/Recipes.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getRecipes } from "../api.js";
import type { Recipe } from "@receipt-scanner/shared";

export default function Recipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  useEffect(() => {
    getRecipes().then((r) => setRecipes(r.recipes)).catch(() => setRecipes([]));
  }, []);
  return (
    <section>
      <h2>Recipe suggestions</h2>
      <ul>
        {recipes.map((r) => (
          <li key={r.id}><a href={r.sourceUrl}>{r.title}</a></li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 7: Create `packages/frontend/src/App.tsx`**

```tsx
import { useState } from "react";
import { signOut } from "aws-amplify/auth";
import Scan from "./pages/Scan.js";
import Inventory from "./pages/Inventory.js";
import Recipes from "./pages/Recipes.js";

type Tab = "scan" | "inventory" | "recipes";

export default function App() {
  const [tab, setTab] = useState<Tab>("scan");
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 640, margin: "2rem auto" }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <h1 style={{ marginRight: "auto" }}>Receipt Scanner</h1>
        <button onClick={() => signOut()}>Sign out</button>
      </header>
      <nav style={{ display: "flex", gap: 8, margin: "1rem 0" }}>
        <button onClick={() => setTab("scan")}>Scan</button>
        <button onClick={() => setTab("inventory")}>Inventory</button>
        <button onClick={() => setTab("recipes")}>Recipes</button>
      </nav>
      {tab === "scan" && <Scan />}
      {tab === "inventory" && <Inventory />}
      {tab === "recipes" && <Recipes />}
    </main>
  );
}
```

- [ ] **Step 8: Build the frontend**

Run: `pnpm --filter @receipt-scanner/frontend build`
Expected: type-checks and produces `packages/frontend/dist/`. (If env vars are unset, build still succeeds; values are read at runtime.)

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src packages/frontend/.env.example
git commit -m "feat(frontend): auth shell, API client, and three pages"
```

---

## Task 14: Frontend hosting in CDK + full verification

**Files:**
- Modify: `packages/infra/lib/receipt-scanner-stack.ts`
- Modify: `packages/infra/test/stack.test.ts`

- [ ] **Step 1: Add the failing test for CloudFront**

Add to `packages/infra/test/stack.test.ts`:

```typescript
it("creates a CloudFront distribution for the frontend", () => {
  template().resourceCountIs("AWS::CloudFront::Distribution", 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter infra test`
Expected: FAIL — 0 distributions found.

- [ ] **Step 3: Add frontend hosting to the stack**

Add these imports at the top of `receipt-scanner-stack.ts`:

```typescript
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
```

Add before the `CfnOutput`s in the constructor:

```typescript
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    new CfnOutput(this, "SiteBucketName", { value: siteBucket.bucketName });
    new CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter infra test`
Expected: PASS (4 tests).

- [ ] **Step 5: Full workspace build + test + synth**

Run: `pnpm install && pnpm -r build && pnpm -r test && pnpm --filter infra synth`
Expected: install OK; all packages build; all tests pass; synth prints a template with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/infra/lib packages/infra/test
git commit -m "feat(infra): host frontend on S3 + CloudFront"
```

---

## Task 15: Root README with deploy instructions

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Receipt Scanner

pnpm monorepo: scan receipts (Textract) → inventory (DynamoDB) → recipe suggestions (Spoonacular). React + Vite SPA, Node Lambda behind an API Gateway HTTP API with Cognito auth, deployed via AWS CDK.

## Packages
- `packages/shared` — shared TypeScript types
- `packages/backend` — Lambda handlers + domain logic
- `packages/frontend` — React + Vite SPA
- `packages/infra` — AWS CDK app (single stack)

## Develop
```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Deploy
```bash
# 1. Set the Spoonacular key (do not commit it)
aws ssm put-parameter --name /receipt-scanner/spoonacular-api-key --type String --value YOUR_KEY --overwrite

# 2. Deploy infra (outputs ApiUrl, UserPoolId, UserPoolClientId, Region, SiteBucketName)
pnpm --filter infra deploy

# 3. Configure the frontend from the stack outputs
cp packages/frontend/.env.example packages/frontend/.env   # fill in the output values

# 4. Build the frontend and upload to the site bucket
pnpm --filter @receipt-scanner/frontend build
aws s3 sync packages/frontend/dist s3://<SiteBucketName> --delete
```

## Scaffold status
Textract parsing, the `POST /receipts` flow, and Spoonacular calls are wired but minimally stubbed (see `// TODO` markers). Auth is email/password only.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with develop and deploy instructions"
```

---

## Notes for the implementer

- **ESM throughout.** All packages use `"type": "module"`; import local files with `.js` extensions in TypeScript source (e.g. `import { route } from "./handler.js"`).
- **Workspace links.** `@receipt-scanner/shared` must be built (`pnpm --filter @receipt-scanner/shared build`) before consuming packages type-check, since they import from its `dist`.
- **NodejsFunction bundling** transpiles the backend `handler.ts` (and its workspace imports) at synth/deploy time; you do not pre-build the backend for deployment, but `pnpm --filter @receipt-scanner/backend build` is still used to catch type errors and run tests.
- **Secrets.** Never commit the Spoonacular key. The SSM parameter is created with a placeholder; set the real value with the AWS CLI (see README).
```
