import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GetParameterCommandOutput } from "@aws-sdk/client-ssm";
import {
  getSpoonacularApiKey,
  resetSpoonacularKeyCache,
  getAnthropicApiKey,
  resetAnthropicKeyCache,
} from "./config.js";

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

describe("getAnthropicApiKey", () => {
  it("resolves the parameter value from SSM and caches it", async () => {
    process.env.ANTHROPIC_PARAM_NAME = "/receipt-scanner/anthropic-api-key";
    resetAnthropicKeyCache();
    let calls = 0;
    const send = async () => {
      calls++;
      return { Parameter: { Value: "sk-test" }, $metadata: {} };
    };
    expect(await getAnthropicApiKey(send)).toBe("sk-test");
    expect(await getAnthropicApiKey(send)).toBe("sk-test");
    expect(calls).toBe(1); // second call is a cache hit
  });
});
