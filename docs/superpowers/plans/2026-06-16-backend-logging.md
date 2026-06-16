# Backend Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured Pino logging to the Lambda backend behind a single-file abstraction (`log.ts`), with request-lifecycle logs, error capture, key-op debug traces, secret redaction, and env-driven level.

**Architecture:** All app code imports `log` / `runWithLogContext` from `src/log.ts` — the only file that imports `pino`. Request correlation flows through `AsyncLocalStorage` + a Pino `mixin`, so no logger argument is threaded through function signatures. Output is plain JSON to stdout (CloudWatch-native); no transports (they don't bundle into Lambda).

**Tech Stack:** TypeScript ESM, Node 20, AWS Lambda, Pino, Vitest, AWS CDK (`NodejsFunction`).

---

## File Structure

- **Create** `packages/backend/src/log.ts` — Pino instance + `AsyncLocalStorage` context + redaction. Exports `log`, `runWithLogContext`, and internal `buildLogger` (for tests).
- **Create** `packages/backend/src/log.test.ts` — redaction + context-mixin tests.
- **Modify** `packages/backend/src/handler.ts` — request lifecycle logging + `try/catch` → logged 500.
- **Modify** `packages/backend/src/textract.ts`, `upload.ts`, `receipts.ts`, `inventory.ts`, `recipes.ts`, `config.ts` — `debug`-level key-op traces.
- **Modify** `packages/backend/vitest.config.ts` — set `LOG_LEVEL=silent` for the test run.
- **Modify** `packages/backend/package.json` — add `pino` dependency.
- **Modify** `packages/infra/lib/backend-stack.ts` — add `LOG_LEVEL: "info"` to the Lambda env.

---

## Task 1: Logging module (`log.ts`) with redaction + context

**Files:**
- Create: `packages/backend/src/log.ts`
- Test: `packages/backend/src/log.test.ts`
- Modify: `packages/backend/package.json`
- Modify: `packages/backend/vitest.config.ts`

- [ ] **Step 1: Add the Pino dependency**

Run (from repo root):
```bash
pnpm --filter @receipt-scanner/backend add pino@^9.0.0
```
Expected: `pino` appears under `dependencies` in `packages/backend/package.json` and the lockfile updates.

- [ ] **Step 2: Silence logs during the test run**

Replace the contents of `packages/backend/vitest.config.ts` with:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { LOG_LEVEL: "silent" },
  },
});
```
(This sets `process.env.LOG_LEVEL` before modules load, so the `log` singleton is silent in existing tests. `log.test.ts` builds its own logger at an explicit level, so it is unaffected.)

- [ ] **Step 3: Write the failing test**

Create `packages/backend/src/log.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { buildLogger, runWithLogContext } from "./log.js";

/** Builds a logger writing JSON lines into an array; forces debug level. */
function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = buildLogger(stream);
  logger.level = "debug";
  const last = () => JSON.parse(lines[lines.length - 1]);
  return { logger, last };
}

describe("log redaction", () => {
  it("censors known sensitive fields", () => {
    const { logger, last } = capture();
    logger.info(
      { apiKey: "super-secret", authorization: "Bearer x", password: "p" },
      "sensitive",
    );
    const entry = last();
    expect(entry.apiKey).toBe("[REDACTED]");
    expect(entry.authorization).toBe("[REDACTED]");
    expect(entry.password).toBe("[REDACTED]");
  });

  it("censors sensitive fields nested one level deep", () => {
    const { logger, last } = capture();
    logger.info({ outer: { apiKey: "nested-secret" } }, "nested");
    expect(last().outer.apiKey).toBe("[REDACTED]");
  });

  it("stamps the service base field", () => {
    const { logger, last } = capture();
    logger.info("hello");
    expect(last().service).toBe("receipt-scanner-backend");
  });
});

describe("log context via AsyncLocalStorage", () => {
  it("includes context fields for logs inside runWithLogContext", () => {
    const { logger, last } = capture();
    runWithLogContext({ requestId: "abc", userId: "user-1" }, () => {
      logger.info("inside");
    });
    const entry = last();
    expect(entry.requestId).toBe("abc");
    expect(entry.userId).toBe("user-1");
  });

  it("omits context fields outside runWithLogContext", () => {
    const { logger, last } = capture();
    logger.info("outside");
    expect(last().requestId).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run:
```bash
pnpm --filter @receipt-scanner/backend exec vitest run src/log.test.ts
```
Expected: FAIL — cannot resolve `./log.js` (module not created yet).

- [ ] **Step 5: Implement `log.ts`**

Create `packages/backend/src/log.ts`:
```ts
import { AsyncLocalStorage } from "node:async_hooks";
import pino, { type Logger, type DestinationStream } from "pino";

/** Per-request correlation fields, carried without threading a logger arg. */
const als = new AsyncLocalStorage<Record<string, unknown>>();

/** Runs `fn` with the given correlation context attached to every log line. */
export function runWithLogContext<T>(ctx: Record<string, unknown>, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Fields that must never reach CloudWatch, censored as a safety net. */
const redactPaths = [
  "apiKey",
  "apikey",
  "authorization",
  "Authorization",
  "token",
  "accessToken",
  "jwt",
  "password",
  "secret",
  "*.apiKey",
  "*.apikey",
  "*.authorization",
  "*.token",
  "*.password",
  "*.secret",
];

/** Builds a Pino logger. `destination` defaults to stdout (CloudWatch). */
export function buildLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      base: { service: "receipt-scanner-backend" },
      redact: { paths: redactPaths, censor: "[REDACTED]" },
      mixin: () => als.getStore() ?? {},
    },
    destination as DestinationStream,
  );
}

/** Singleton logger used across the backend. Import this, never `pino`. */
export const log: Logger = buildLogger();
```

- [ ] **Step 6: Run the test to verify it passes**

Run:
```bash
pnpm --filter @receipt-scanner/backend exec vitest run src/log.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/log.ts packages/backend/src/log.test.ts packages/backend/vitest.config.ts packages/backend/package.json pnpm-lock.yaml
git commit -m "feat(backend): add Pino logging module with redaction and ALS context"
```

---

## Task 2: Request lifecycle + error logging in the handler

**Files:**
- Modify: `packages/backend/src/handler.ts`

The existing tests cover `route()` only and stay green. The new behavior (lifecycle logs + `try/catch` → 500) is verified by build + existing test suite; `LOG_LEVEL=silent` keeps test output clean.

- [ ] **Step 1: Import the logger**

In `packages/backend/src/handler.ts`, add to the import block (after the existing imports, around line 11):
```ts
import { log, runWithLogContext } from "./log.js";
```

- [ ] **Step 2: Replace the `handler` function**

Replace the entire `handler` function (currently `handler.ts:74-91`) with:
```ts
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  let userId: string | null = null;
  try {
    userId = getUserId(event);
  } catch {
    userId = null;
  }

  const requestId = event.requestContext.requestId;
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;

  return runWithLogContext({ requestId, method, path, userId }, async () => {
    const start = Date.now();
    log.info("request received");
    if (!userId) log.debug("unauthenticated request");

    try {
      const res = await route({
        method,
        path,
        userId,
        body: event.body ?? null,
        pathParams: event.pathParameters ?? {},
      });
      log.info({ statusCode: res.statusCode, durationMs: Date.now() - start }, "request completed");
      return {
        statusCode: res.statusCode,
        headers: { "content-type": "application/json" },
        body: res.body,
      };
    } catch (err) {
      log.error({ err, durationMs: Date.now() - start }, "request failed");
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Internal Server Error" }),
      };
    }
  });
}
```

- [ ] **Step 3: Type-check / build**

Run:
```bash
pnpm --filter @receipt-scanner/backend build
```
Expected: PASS (no TypeScript errors).

- [ ] **Step 4: Run the full backend test suite**

Run:
```bash
pnpm --filter @receipt-scanner/backend test
```
Expected: PASS — all existing `route` tests plus `log.test.ts`, with no log output (silent level).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/handler.ts
git commit -m "feat(backend): log request lifecycle and catch handler errors as 500"
```

---

## Task 3: Key-op debug traces in AWS-touching modules

**Files:**
- Modify: `packages/backend/src/textract.ts`
- Modify: `packages/backend/src/upload.ts`
- Modify: `packages/backend/src/receipts.ts`
- Modify: `packages/backend/src/inventory.ts`
- Modify: `packages/backend/src/recipes.ts`
- Modify: `packages/backend/src/config.ts`

All traces are `debug`-level (so `info` stays at lifecycle + errors). **No secret values or signed URLs are ever logged.**

- [ ] **Step 1: `textract.ts` — log analyze start/complete**

Add the import at the top (after the existing imports):
```ts
import { log } from "./log.js";
```
Then replace the body of `analyzeReceipt` (currently `textract.ts:11-16`) with:
```ts
export async function analyzeReceipt(bucket: string, key: string): Promise<ReceiptLineItem[]> {
  log.debug({ bucket, key }, "textract analyze start");
  const output = await client.send(
    new AnalyzeExpenseCommand({ Document: { S3Object: { Bucket: bucket, Name: key } } }),
  );
  const items = parseExpense(output);
  log.debug({ itemCount: items.length }, "textract analyze complete");
  return items;
}
```

- [ ] **Step 2: `upload.ts` — log presign issued**

Add the import at the top:
```ts
import { log } from "./log.js";
```
Then, in `createUploadUrl` (currently `upload.ts:34-43`), add a log line after `uploadUrl` is computed, before the `return`:
```ts
  const uploadUrl = await presign(new PutObjectCommand({ Bucket: BUCKET, Key: imageS3Key }));
  log.debug({ imageS3Key }, "presigned upload url issued");
  return { uploadUrl, imageS3Key };
```
(Do **not** log `uploadUrl` — it embeds credentials.)

- [ ] **Step 3: `receipts.ts` — log receipt saved**

Add the import at the top:
```ts
import { log } from "./log.js";
```
Then replace `putReceipt` (currently `receipts.ts:30-32`) with:
```ts
export async function putReceipt(receipt: Receipt): Promise<void> {
  await doc.send(new PutCommand({ TableName: TABLE, Item: receipt }));
  log.debug(
    { receiptId: receipt.receiptId, total: receipt.total, itemCount: receipt.lineItems.length },
    "receipt saved",
  );
}
```

- [ ] **Step 4: `inventory.ts` — log items written**

Add the import at the top:
```ts
import { log } from "./log.js";
```
Then replace `putItems` (currently `inventory.ts:33-36`) with:
```ts
export async function putItems(items: InventoryItem[]): Promise<void> {
  // TODO: batch with BatchWriteCommand for >25 items.
  await Promise.all(items.map((item) => doc.send(new PutCommand({ TableName: TABLE, Item: item }))));
  log.debug({ count: items.length }, "inventory items written");
}
```

- [ ] **Step 5: `recipes.ts` — log query/response (never the key or URL)**

Add the import at the top (after the existing `import type` line):
```ts
import { log } from "./log.js";
```
Then, in `suggestRecipes` (currently `recipes.ts:22-36`), add traces around the fetch:
```ts
  if (ingredients.length === 0) return [];
  log.debug({ ingredientCount: ingredients.length }, "querying spoonacular");
  // TODO: add ranking/number params and error handling for non-200 responses.
  const url = new URL("https://api.spoonacular.com/recipes/findByIngredients");
  url.searchParams.set("ingredients", ingredients.join(","));
  url.searchParams.set("number", "10");
  url.searchParams.set("apiKey", apiKey);
  const res = await fetchFn(url.toString());
  const raw = (await res.json()) as SpoonacularResult[];
  log.debug({ recipeCount: raw.length, status: res.status }, "spoonacular responded");
  return mapSpoonacularResults(raw);
```
(Do **not** log `url` or `apiKey` — the key is in the query string.)

- [ ] **Step 6: `config.ts` — log SSM fetch vs cache hit (never the value)**

Add the import at the top (after the existing imports):
```ts
import { log } from "./log.js";
```
Then replace `getSpoonacularApiKey` (currently `config.ts:25-32`) with:
```ts
export async function getSpoonacularApiKey(send: SsmSend = defaultSend): Promise<string> {
  if (cached !== undefined) {
    log.debug("spoonacular key cache hit");
    return cached;
  }
  const name = process.env.SPOONACULAR_PARAM_NAME;
  if (!name) throw new Error("SPOONACULAR_PARAM_NAME is not set");
  log.debug({ parameterName: name }, "fetching spoonacular key from ssm");
  const res = await send(new GetParameterCommand({ Name: name }));
  cached = res.Parameter?.Value ?? "";
  return cached;
}
```
(`parameterName` is the SSM path, not the secret value — safe to log.)

- [ ] **Step 7: Build and run the full test suite**

Run:
```bash
pnpm --filter @receipt-scanner/backend build && pnpm --filter @receipt-scanner/backend test
```
Expected: PASS — build clean; all tests green (existing `config`, `textract`, `upload`, `receipts`, `inventory`, `recipes`, `handler` tests unaffected; logs silent).

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/textract.ts packages/backend/src/upload.ts packages/backend/src/receipts.ts packages/backend/src/inventory.ts packages/backend/src/recipes.ts packages/backend/src/config.ts
git commit -m "feat(backend): add debug-level traces to AWS-touching modules"
```

---

## Task 4: Wire `LOG_LEVEL` into the Lambda environment

**Files:**
- Modify: `packages/infra/lib/backend-stack.ts`

- [ ] **Step 1: Add `LOG_LEVEL` to the Lambda env**

In `packages/infra/lib/backend-stack.ts`, in the `apiFn` `environment` block (currently `backend-stack.ts:75-80`), add the `LOG_LEVEL` entry:
```ts
      environment: {
        RECEIPTS_TABLE: receiptsTable.tableName,
        INVENTORY_TABLE: inventoryTable.tableName,
        RECEIPTS_BUCKET: receiptsBucket.bucketName,
        SPOONACULAR_PARAM_NAME: spoonacularParam.parameterName,
        LOG_LEVEL: "info",
      },
```

- [ ] **Step 2: Build infra and synth to verify**

Run (from `packages/infra`):
```bash
cd packages/infra && pnpm exec cdk synth receipt-scanner-backend > /dev/null && echo SYNTH_OK
```
Expected: prints `SYNTH_OK` (CloudFormation template synthesizes without error; the Lambda now carries `LOG_LEVEL`).

- [ ] **Step 3: Commit**

```bash
git add packages/infra/lib/backend-stack.ts
git commit -m "feat(infra): set LOG_LEVEL on the backend Lambda"
```

---

## Final verification

- [ ] **Full backend build + test:**
```bash
pnpm --filter @receipt-scanner/backend build && pnpm --filter @receipt-scanner/backend test
```
Expected: clean build; all tests pass with no log noise.

- [ ] **Infra synth:**
```bash
cd packages/infra && pnpm exec cdk synth receipt-scanner-backend > /dev/null && echo SYNTH_OK
```
Expected: `SYNTH_OK`.

Then hand off to `superpowers:finishing-a-development-branch` to merge.
