import { describe, it, expect, vi } from "vitest";
import {
  buildNormalizationPrompt,
  parseNormalizationResponse,
  normalizeLineItems,
} from "./normalize.js";
import type { ReceiptLineItem } from "@receipt-scanner/shared";

describe("buildNormalizationPrompt", () => {
  it("includes every raw name", () => {
    const prompt = buildNormalizationPrompt(["GV LETTUCE", "BAG FEE"]);
    expect(prompt).toContain("GV LETTUCE");
    expect(prompt).toContain("BAG FEE");
  });
});

describe("parseNormalizationResponse", () => {
  it("maps a well-formed JSON array", () => {
    const text = JSON.stringify([
      { rawName: "GV LETTUCE", canonicalName: "lettuce", isFood: true },
      { rawName: "BAG FEE", canonicalName: "bag fee", isFood: false },
    ]);
    expect(parseNormalizationResponse(text, ["GV LETTUCE", "BAG FEE"])).toEqual([
      { rawName: "GV LETTUCE", canonicalName: "lettuce", isFood: true },
      { rawName: "BAG FEE", canonicalName: "bag fee", isFood: false },
    ]);
  });

  it("falls back to the raw name and isFood true on unparseable output", () => {
    expect(parseNormalizationResponse("not json", ["MILK"])).toEqual([
      { rawName: "MILK", canonicalName: "MILK", isFood: true },
    ]);
  });

  it("tolerates code fences around the JSON", () => {
    const text = "```json\n[{\"rawName\":\"MILK\",\"canonicalName\":\"milk\",\"isFood\":true}]\n```";
    expect(parseNormalizationResponse(text, ["MILK"])[0].canonicalName).toBe("milk");
  });
});

describe("normalizeLineItems", () => {
  const lines: ReceiptLineItem[] = [
    { name: "GV LETTUCE", quantity: 2, unit: "unit", price: 1.49 },
    { name: "365 ROMAINE", quantity: 1, unit: "unit", price: 2.99 },
  ];

  it("resolves cache hits without calling Claude and carries qty/unit/price through", async () => {
    const callClaude = vi.fn();
    const result = await normalizeLineItems("user-1", lines, {
      getCachedFn: async () => new Map([["GV LETTUCE", "lettuce"], ["365 ROMAINE", "romaine lettuce"]]),
      getApiKey: async () => "sk-test",
      callClaude,
    });
    expect(callClaude).not.toHaveBeenCalled();
    expect(result[0]).toEqual({
      rawName: "GV LETTUCE",
      canonicalName: "lettuce",
      quantity: 2,
      unit: "unit",
      price: 1.49,
      isFood: true,
      source: "cache",
    });
    expect(result[1].canonicalName).toBe("romaine lettuce");
  });

  it("calls Claude once for cache misses and tags them source=claude", async () => {
    const callClaude = vi.fn(async () =>
      JSON.stringify([
        { rawName: "GV LETTUCE", canonicalName: "lettuce", isFood: true },
        { rawName: "365 ROMAINE", canonicalName: "romaine lettuce", isFood: true },
      ]),
    );
    const result = await normalizeLineItems("user-1", lines, {
      getCachedFn: async () => new Map(),
      getApiKey: async () => "sk-test",
      callClaude,
    });
    expect(callClaude).toHaveBeenCalledTimes(1);
    expect(result.map((r) => r.source)).toEqual(["claude", "claude"]);
    expect(result[0].canonicalName).toBe("lettuce");
  });

  it("degrades to raw names when the key is unset", async () => {
    const callClaude = vi.fn();
    const result = await normalizeLineItems("user-1", lines, {
      getCachedFn: async () => new Map(),
      getApiKey: async () => "REPLACE_ME",
      callClaude,
    });
    expect(callClaude).not.toHaveBeenCalled();
    expect(result[0].canonicalName).toBe("GV LETTUCE");
    expect(result[0].isFood).toBe(true);
  });
});
