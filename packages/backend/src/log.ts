import { AsyncLocalStorage } from "node:async_hooks";
import pino, { type Logger, type DestinationStream } from "pino";

/** Per-request correlation fields, carried without threading a logger arg. */
const als = new AsyncLocalStorage<Record<string, unknown>>();

/** Runs `fn` with the given correlation context attached to every log line. */
export function runWithLogContext<T>(ctx: Record<string, unknown>, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Fields that must never reach CloudWatch, censored as a safety net. */
// Pino redaction is not recursive: these cover top-level and one-level-deep keys only.
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
  "*.Authorization",
  "*.token",
  "*.accessToken",
  "*.jwt",
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
