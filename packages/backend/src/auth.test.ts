import { describe, it, expect } from "vitest";
import { getUserId } from "./auth.js";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

function eventWithSub(sub: string | undefined) {
  return {
    requestContext: { authorizer: { jwt: { claims: sub ? { sub } : {} } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe("getUserId", () => {
  it("returns the sub claim", () => {
    expect(getUserId(eventWithSub("user-123"))).toBe("user-123");
  });

  it("throws when sub is missing", () => {
    expect(() => getUserId(eventWithSub(undefined))).toThrow("Unauthorized");
  });
});
