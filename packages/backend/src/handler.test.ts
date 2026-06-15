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
