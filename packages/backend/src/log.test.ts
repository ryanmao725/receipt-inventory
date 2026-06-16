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
