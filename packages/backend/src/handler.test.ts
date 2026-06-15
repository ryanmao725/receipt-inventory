import { describe, it, expect } from "vitest";
import { route } from "./handler.js";
import { getSpoonacularApiKey, resetSpoonacularKeyCache } from "./config.js";

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
});
