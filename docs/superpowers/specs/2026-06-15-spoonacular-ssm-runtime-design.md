# Runtime Spoonacular Key Resolution Design

**Date:** 2026-06-15

## Goal

Make the backend Lambda read the real Spoonacular API key from SSM Parameter Store **at runtime**, instead of the value baked into the Lambda environment at deploy time. Currently `backend-stack.ts` sets `SPOONACULAR_API_KEY` to `spoonacularParam.stringValue`, which is the literal placeholder `REPLACE_ME` captured at synth — so the real key set out-of-band in SSM never reaches the running Lambda.

## Scope

Narrow: SSM key wiring only. The scan/Textract pipeline (`POST /receipts`, currently `501`) and manual inventory creation are **out of scope**. As a result `GET /recipes` will still return `[]` until inventory is populated by other means — expected and acceptable for this change.

## Approach

Runtime SSM fetch with a warm-container cache. On the first `/recipes` invocation, the Lambda fetches the parameter and caches it in a module-level variable for the lifetime of the execution environment. Rotating the key in SSM then takes effect on the next cold start with no redeploy, and the secret is never written into the CloudFormation template or the Lambda environment.

Rejected alternatives:
- **CDK deploy-time resolution** (`valueForStringParameter`/`stringValue`): bakes the value into the template/env and requires a redeploy on rotation — the exact footgun being removed.
- **Secrets Manager + caching extension**: heavier infra for no benefit at this scope.

## Components

### New: `packages/backend/src/config.ts`
- `getSpoonacularApiKey(): Promise<string>` — reads the parameter name from `process.env.SPOONACULAR_PARAM_NAME`, fetches the value via `@aws-sdk/client-ssm` `GetParameterCommand`, and caches it in a module-level variable. Subsequent calls return the cached value without re-fetching.
- The SSM client's `send` is injectable (parameter with a default) so unit tests don't hit AWS.
- A `resetSpoonacularKeyCache()` export (test-only helper) clears the module cache between tests.
- If `SPOONACULAR_PARAM_NAME` is unset, throw a clear error (misconfiguration).

### Modified: `packages/backend/src/handler.ts`
- `GET /recipes` calls `await getSpoonacularApiKey()` instead of reading `process.env.SPOONACULAR_API_KEY`.
- Guard: if the resolved key is empty or equals `REPLACE_ME`, return `{ recipes: [] }` without calling Spoonacular (avoids a guaranteed-bad external call when the key hasn't been set yet).

### Modified: `packages/infra/lib/backend-stack.ts`
- Replace the Lambda env `SPOONACULAR_API_KEY: spoonacularParam.stringValue` with `SPOONACULAR_PARAM_NAME: spoonacularParam.parameterName`.
- Add `spoonacularParam.grantRead(apiFn)` so the function's role gets `ssm:GetParameter` on that parameter.

### Modified: `packages/backend/package.json`
- Add dependency `@aws-sdk/client-ssm` (same major version as the other AWS SDK v3 deps).

## Data flow

`GET /recipes` → `getUserId` → `listItems(userId)` → `getSpoonacularApiKey()` (SSM, cached) → if key unset/`REPLACE_ME` return `[]`, else `suggestRecipes(ingredients, key)` → `{ recipes }`.

## Error handling

- Missing `SPOONACULAR_PARAM_NAME` env → throw (misconfiguration; should never happen once the stack sets it).
- Unset/placeholder key (`""` or `REPLACE_ME`) → return empty recipes, no external call.
- SSM fetch failure propagates as a 500 from the handler's normal error path (no special handling added at this scope).

## Testing (TDD)

`packages/backend/src/config.test.ts`:
- Fetches the value from the injected SSM send using the env param name; returns it.
- Caches: a second call does not invoke the SSM send again.
- Throws when `SPOONACULAR_PARAM_NAME` is unset.

`packages/backend/src/handler.test.ts` (additions):
- `/recipes` short-circuits to `{ recipes: [] }` when the resolved key is `REPLACE_ME`. The test sets `SPOONACULAR_PARAM_NAME`, calls `resetSpoonacularKeyCache()`, then primes the module cache by calling `getSpoonacularApiKey(stubSend)` with a stub `send` returning `REPLACE_ME`. The subsequent `route(...)` call reads the cached value (no AWS call) and returns empty recipes.

Existing infra stack tests remain green (resource counts unchanged; only env var and an IAM grant change).

## Out of scope (YAGNI)

- Textract scan pipeline and `POST /receipts`.
- Manual `POST /inventory`.
- TTL-based cache expiry (warm-container lifetime caching is sufficient; cold starts pick up rotations).
