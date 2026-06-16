# Backend Logging Design

**Date:** 2026-06-16

## Goal

Add structured logging to the Lambda backend using Pino, behind a thin internal
abstraction so the rest of the code never imports the logger library directly.
The backend currently has **zero logging** (no `console.*` anywhere). We want
request-lifecycle visibility, error capture with stack traces, and step-level
traces of the AWS-touching operations — emitted as JSON to CloudWatch, with
sensitive fields redacted.

## Context

- The backend is **raw AWS Lambda** — a single `handler` (`handler.ts:74`) and a
  hand-rolled `route()` dispatcher (`handler.ts:32`). No web framework
  (Express/Fastify/Hono/Middy). Modules are plain functions: `inventory.ts`,
  `recipes.ts`, `config.ts`, `textract.ts`, `upload.ts`, `receipts.ts`,
  `auth.ts`.
- ESM throughout (`"type": "module"`, `.js` import extensions in TS source).
- Bundled to Lambda via CDK `NodejsFunction` (esbuild), `NODEJS_20_X`
  (`backend-stack.ts:71`).
- Tests use Vitest; AWS-touching functions take injectable `send`/`fetch`/
  `presign` params so tests don't hit AWS.

## Design principle: avoid lock-in

A future migration to a web framework should re-wire **one file**, not every
call site. So:

- All application code imports `log` (and `runWithLogContext`) from a single
  internal module `src/log.ts`. **No other file imports `pino`.**
- Request correlation is carried via `AsyncLocalStorage`, not by threading a
  logger argument through every function signature — so there is no signature
  churn to undo later, and module code stays decoupled from how context is
  established.
- Pino is the backing choice because it is the de-facto logger for nearly every
  Node framework (Fastify native; `hono-pino`, `nestjs-pino`, `pino-http` for
  Express), so a framework migration becomes "let the framework own the Pino
  instance," not "rip out a logger."

## Architecture

### `src/log.ts` (new — the abstraction)

Wraps a single Pino instance and owns all logging concerns.

- **Level:** `process.env.LOG_LEVEL ?? "info"`.
- **Output:** plain JSON to stdout (Pino default). **No transports / no
  `pino-pretty`** — transports spawn worker threads that don't bundle cleanly
  into a Lambda esbuild bundle. Plain JSON is exactly what CloudWatch ingests.
- **Base fields:** `{ service: "receipt-scanner-backend" }`.
- **Redaction (safety net):** Pino `redact` with `censor: "[REDACTED]"` over a
  path list covering known-sensitive keys at top level and one level deep, e.g.
  `apiKey`, `apiKey` nested (`*.apiKey`), `authorization`, `Authorization`,
  `token`, `accessToken`, `jwt`, `password`, `secret`. Intent: even if a secret
  is accidentally passed in a log object, it never reaches CloudWatch. Code
  still must not deliberately log secret *values*.
- **Request context via `AsyncLocalStorage`:**
  - `const als = new AsyncLocalStorage<Record<string, unknown>>()`.
  - `export function runWithLogContext(ctx, fn) { return als.run(ctx, fn); }`.
  - The Pino instance is created with a `mixin: () => als.getStore() ?? {}` so
    every log line automatically includes the active request's
    `{ requestId, method, path, userId }`.
- **Exports:** `log` (the Pino logger) and `runWithLogContext`.

Interface the rest of the code relies on (kept minimal so it's
framework-portable): `log.debug(obj?, msg)`, `log.info(...)`, `log.warn(...)`,
`log.error(...)` — Pino's standard signature.

### `handler.ts` (request lifecycle + error capture)

- Extract `requestId` from `event.requestContext.requestId`, plus `method`,
  `path`, and `userId` (already resolved).
- Wrap the `route()` call in
  `runWithLogContext({ requestId, method, path, userId }, async () => { ... })`.
- `log.info("request received")` at the start (inside the context).
- Capture start time; on success `log.info({ statusCode, durationMs }, "request completed")`.
- **Add a `try/catch` around `route()`** — currently any throw inside `route()`
  propagates uncaught. On catch: `log.error({ err }, "request failed")` and
  return `{ statusCode: 500, body: JSON.stringify({ message: "Internal Server Error" }) }`
  with the JSON content-type header. (Pino serializes `err` with its stack via
  the standard error serializer.)
- The existing `getUserId` try/catch stays; on failure log at `debug`
  ("unauthenticated request") — not an error, since 401 is normal.

### Key-ops logs in modules

Each AWS-touching module imports `log` and adds mostly `debug`-level traces so
`info` stays clean (request received/completed + errors). No secret values are
ever passed to the logger.

- **`textract.ts`** — `analyzeReceipt`: `debug` "textract analyze start"
  (`{ bucket, key }`) before the call; after, `debug`
  `{ itemCount }` "textract analyze complete".
- **`upload.ts`** — `createUploadUrl`: `debug` `{ imageS3Key }` "presigned upload
  url issued". (Never log the signed URL — it embeds credentials.)
- **`receipts.ts`** — `putReceipt`: `debug` `{ receiptId, total, itemCount }`
  "receipt saved".
- **`inventory.ts`** — `putItems`: `debug` `{ count }` "inventory items written".
- **`recipes.ts`** — `suggestRecipes`: `debug` `{ ingredientCount }` "querying
  spoonacular"; after, `debug` `{ recipeCount, status }` "spoonacular responded".
  **The `apiKey` is never logged** (it's in the URL query string, so do not log
  the full URL).
- **`config.ts`** — `getSpoonacularApiKey`: `debug` "fetching spoonacular key
  from ssm" / "spoonacular key cache hit". **Never log the key value**; the
  "placeholder vs real" decision stays in the handler.

## Data flow

`handler` resolves `userId` → `runWithLogContext({requestId, method, path, userId})`
→ `log.info("request received")` → `route()` runs; any module `log.*` call inside
this async context automatically inherits the correlation fields via the ALS
mixin → on completion `log.info({statusCode, durationMs})`, or on throw
`log.error({err})` + 500.

## Error handling

- Handler-level `try/catch` converts uncaught route errors into a logged `500`.
- Module functions do **not** swallow errors for logging — they let errors
  propagate to the handler (single place that logs failures), except where a
  module already has meaningful local context worth a `debug` line before
  rethrowing. We do not add new catch blocks that hide failures.

## Testing

- New **`src/log.test.ts`** (Vitest):
  1. Redaction: build a child/log call with `{ apiKey, authorization, password }`
     and assert the serialized output censors them to `[REDACTED]`. (Capture
     output by constructing a Pino instance writing to an in-memory stream, or
     by asserting on the redaction config — implementation detail for the plan.)
  2. Context mixin: inside `runWithLogContext({ requestId: "abc" }, ...)`, assert
     a log line includes `requestId: "abc"`; outside the context, it does not.
- Set `LOG_LEVEL=silent` for the Vitest run (e.g. in the test setup / script env)
  so existing tests don't emit log noise; the `log.test.ts` cases that assert on
  output use their own Pino instance/stream at an explicit level rather than the
  module singleton, or temporarily set the level.
- Existing tests remain unchanged and must still pass (`pnpm --filter @receipt-scanner/backend test`).
- Build gate: `pnpm --filter @receipt-scanner/backend build`.

## Infra

- Add `LOG_LEVEL: "info"` to the `apiFn` `environment` in `backend-stack.ts:75`.
- Add `pino` to `packages/backend/package.json` dependencies. esbuild bundles it
  into the Lambda artifact (pure-JS, no native deps when used without transports).

## Out of scope (YAGNI)

- Any web framework (Express/Fastify/Hono/Middy).
- Log shipping beyond CloudWatch; metrics, tracing, X-Ray.
- Frontend logging.
- `pino-pretty` / local pretty output (transports don't bundle into Lambda; if
  desired for local dev later, that's a separate change).
- Per-route sampling, log retention/alarms (CloudWatch defaults stand).
