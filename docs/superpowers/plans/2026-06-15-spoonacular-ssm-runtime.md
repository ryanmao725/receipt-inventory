# Runtime Spoonacular Key Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend Lambda read the Spoonacular API key from SSM Parameter Store at runtime (cached per warm container) instead of using the placeholder value baked into the Lambda environment at deploy time.

**Architecture:** A new `config.ts` module fetches the parameter named by `SPOONACULAR_PARAM_NAME` via the AWS SDK v3 SSM client and caches it in a module-level variable. `handler.ts` resolves the key through it and short-circuits `/recipes` to an empty list when the key is unset or still `REPLACE_ME`. The CDK backend stack passes the parameter *name* (not value) and grants `ssm:GetParameter`.

**Tech Stack:** TypeScript (ESM, Node 20), `@aws-sdk/client-ssm`, Vitest, AWS CDK v2.

---

## File Structure

```
packages/backend/
├─ package.json                 # + @aws-sdk/client-ssm dependency
└─ src/
   ├─ config.ts                 # NEW: getSpoonacularApiKey() + resetSpoonacularKeyCache()
   ├─ config.test.ts            # NEW
   ├─ handler.ts                # MODIFY: /recipes uses config, short-circuits on placeholder
   └─ handler.test.ts           # MODIFY: add placeholder short-circuit test
packages/infra/
└─ lib/backend-stack.ts         # MODIFY: env SPOONACULAR_PARAM_NAME + grantRead
```

---

## Task 1: SSM key resolver module

**Files:**
- Modify: `packages/backend/package.json`
- Create: `packages/backend/src/config.ts`
- Test: `packages/backend/src/config.test.ts`

- [ ] **Step 1: Add the SSM SDK dependency**

In `packages/backend/package.json`, add to `"dependencies"` (keep alphabetical-ish with the other `@aws-sdk/*` entries), matching their version range:

```json
"@aws-sdk/client-ssm": "^3.600.0",
```

Then run: `pnpm install`
Expected: installs `@aws-sdk/client-ssm` into the backend package.

- [ ] **Step 2: Write the failing test**

Create `packages/backend/src/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GetParameterCommandOutput } from "@aws-sdk/client-ssm";
import { getSpoonacularApiKey, resetSpoonacularKeyCache } from "./config.js";

function sendReturning(value: string) {
  return vi.fn(async (): Promise<GetParameterCommandOutput> => ({
    Parameter: { Value: value },
    $metadata: {},
  }));
}

describe("getSpoonacularApiKey", () => {
  beforeEach(() => {
    resetSpoonacularKeyCache();
    process.env.SPOONACULAR_PARAM_NAME = "/receipt-scanner/spoonacular-api-key";
  });

  it("fetches and returns the parameter value", async () => {
    const send = sendReturning("real-key");
    expect(await getSpoonacularApiKey(send)).toBe("real-key");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("caches the value across calls", async () => {
    const send = sendReturning("real-key");
    await getSpoonacularApiKey(send);
    await getSpoonacularApiKey(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("throws when SPOONACULAR_PARAM_NAME is unset", async () => {
    resetSpoonacularKeyCache();
    delete process.env.SPOONACULAR_PARAM_NAME;
    const send = sendReturning("real-key");
    await expect(getSpoonacularApiKey(send)).rejects.toThrow("SPOONACULAR_PARAM_NAME");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — cannot find module `./config.js`.

- [ ] **Step 4: Write minimal implementation**

Create `packages/backend/src/config.ts`:

```typescript
import {
  SSMClient,
  GetParameterCommand,
  type GetParameterCommandOutput,
} from "@aws-sdk/client-ssm";

/** Injectable send so tests don't hit AWS. */
export type SsmSend = (command: GetParameterCommand) => Promise<GetParameterCommandOutput>;

const client = new SSMClient({});
const defaultSend: SsmSend = (command) => client.send(command);

let cached: string | undefined;

/** Test helper: clears the module-level cache. */
export function resetSpoonacularKeyCache(): void {
  cached = undefined;
}

/**
 * Resolves the Spoonacular API key from SSM (parameter named by
 * SPOONACULAR_PARAM_NAME), caching it for the lifetime of the execution
 * environment so warm invocations don't re-fetch.
 */
export async function getSpoonacularApiKey(send: SsmSend = defaultSend): Promise<string> {
  if (cached !== undefined) return cached;
  const name = process.env.SPOONACULAR_PARAM_NAME;
  if (!name) throw new Error("SPOONACULAR_PARAM_NAME is not set");
  const res = await send(new GetParameterCommand({ Name: name }));
  cached = res.Parameter?.Value ?? "";
  return cached;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS (config: 3 tests; all other backend tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/package.json packages/backend/src/config.ts packages/backend/src/config.test.ts pnpm-lock.yaml
git commit -m "feat(backend): resolve Spoonacular key from SSM at runtime with caching

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wire the handler to the resolver

**Files:**
- Modify: `packages/backend/src/handler.ts`
- Test: `packages/backend/src/handler.test.ts`

- [ ] **Step 1: Add the failing test**

Add these imports at the top of `packages/backend/src/handler.test.ts` (alongside the existing `import { route } from "./handler.js";`):

```typescript
import { getSpoonacularApiKey, resetSpoonacularKeyCache } from "./config.js";
```

Add this test inside the existing `describe("route", () => { ... })` block:

```typescript
  it("returns empty recipes when the key is the placeholder", async () => {
    process.env.SPOONACULAR_PARAM_NAME = "/receipt-scanner/spoonacular-api-key";
    resetSpoonacularKeyCache();
    // Prime the cache with the placeholder via an injected send (no AWS, no DynamoDB).
    await getSpoonacularApiKey(async () => ({
      Parameter: { Value: "REPLACE_ME" },
      $metadata: {},
    }));

    const res = await route({
      method: "GET",
      path: "/recipes",
      userId: "user-1",
      body: null,
      pathParams: {},
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ recipes: [] });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: FAIL — the current `/recipes` branch calls `listItems` (DynamoDB) and reads `process.env.SPOONACULAR_API_KEY`, so it does not short-circuit and the test errors/does not return `{ recipes: [] }`.

- [ ] **Step 3: Update the `/recipes` branch in `packages/backend/src/handler.ts`**

Change the import line:

```typescript
import { suggestRecipes } from "./recipes.js";
```

to add the config import right after it:

```typescript
import { suggestRecipes } from "./recipes.js";
import { getSpoonacularApiKey } from "./config.js";
```

Replace the existing `/recipes` block:

```typescript
  if (req.method === "GET" && req.path === "/recipes") {
    const items = await listItems(req.userId);
    const apiKey = process.env.SPOONACULAR_API_KEY ?? "";
    const recipes = await suggestRecipes(items.map((i) => i.name), apiKey);
    return json(200, { recipes });
  }
```

with (resolve the key first and short-circuit before touching DynamoDB):

```typescript
  if (req.method === "GET" && req.path === "/recipes") {
    const apiKey = await getSpoonacularApiKey();
    if (!apiKey || apiKey === "REPLACE_ME") return json(200, { recipes: [] });
    const items = await listItems(req.userId);
    const recipes = await suggestRecipes(items.map((i) => i.name), apiKey);
    return json(200, { recipes });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @receipt-scanner/backend test`
Expected: PASS (all backend tests green, including the new placeholder test).

- [ ] **Step 5: Build the backend to catch type errors**

Run: `pnpm --filter @receipt-scanner/backend build`
Expected: compiles with no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/handler.ts packages/backend/src/handler.test.ts
git commit -m "feat(backend): use runtime SSM key for /recipes, short-circuit on placeholder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Pass the parameter name and grant read in CDK

**Files:**
- Modify: `packages/infra/lib/backend-stack.ts`

- [ ] **Step 1: Change the Lambda environment variable**

In `packages/infra/lib/backend-stack.ts`, inside the `new NodejsFunction(this, "ApiFn", { ... environment: { ... } })` block, replace this line:

```typescript
        SPOONACULAR_API_KEY: spoonacularParam.stringValue,
```

with:

```typescript
        SPOONACULAR_PARAM_NAME: spoonacularParam.parameterName,
```

- [ ] **Step 2: Grant the function read access to the parameter**

Immediately after the existing grant lines (after `receiptsBucket.grantReadWrite(apiFn);` and before the `apiFn.addToRolePolicy(` for textract), add:

```typescript
    spoonacularParam.grantRead(apiFn);
```

- [ ] **Step 3: Run the infra tests**

Run: `pnpm --filter infra test`
Expected: PASS — resource counts are unchanged (backend 4, frontend 2, oidc 3); only an env var and an IAM grant changed.

- [ ] **Step 4: Synthesize to confirm the stack is valid**

Run: `pnpm --filter infra exec cdk synth receipt-scanner-backend --profile receipt-inventory`
Expected: synth succeeds, no errors. (If the `receipt-inventory` profile is unavailable in the execution environment, run without `--profile`; synth itself does not require credentials.)

- [ ] **Step 5: Commit**

```bash
git add packages/infra/lib/backend-stack.ts
git commit -m "feat(infra): pass Spoonacular SSM param name to Lambda and grant read

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **ESM imports** use `.js` extensions in TS source (`./config.js`), matching the rest of the backend.
- **Why the key is resolved before `listItems`:** the placeholder short-circuit must avoid both the Spoonacular call and the DynamoDB read, which is what makes the handler test runnable without AWS (the primed cache returns `REPLACE_ME`, so `route` returns early).
- **No deploy in this plan.** After all three tasks, redeploying the backend (`cdk deploy receipt-scanner-backend`) is what makes the running Lambda pick up the new env var + IAM grant; that deploy is a separate step to run when ready, not part of the plan.
- **Cache rotation behavior:** the key is cached per warm container, so rotating it in SSM takes effect on the next cold start — acceptable per the spec (no TTL).
```
