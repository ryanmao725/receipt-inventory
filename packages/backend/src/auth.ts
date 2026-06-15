import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

export function getUserId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("Unauthorized");
  }
  return sub;
}
