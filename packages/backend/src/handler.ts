import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { getUserId } from "./auth.js";
import { listItems, updateItem, deleteItem } from "./inventory.js";
import { suggestRecipes } from "./recipes.js";

export interface RouteInput {
  method: string;
  path: string;
  userId: string | null;
  body: string | null;
  pathParams: Record<string, string | undefined>;
}

export interface RouteResult {
  statusCode: number;
  body: string;
}

const json = (statusCode: number, data: unknown): RouteResult => ({
  statusCode,
  body: JSON.stringify(data),
});

/** Pure-ish dispatcher: maps a normalized request to a response. */
export async function route(req: RouteInput): Promise<RouteResult> {
  if (!req.userId) return json(401, { message: "Unauthorized" });

  if (req.method === "GET" && req.path === "/inventory") {
    return json(200, { items: await listItems(req.userId) });
  }
  if (req.method === "PATCH" && req.path.startsWith("/inventory/")) {
    const id = req.pathParams.id ?? "";
    await updateItem(req.userId, id, JSON.parse(req.body ?? "{}"));
    return json(200, { ok: true });
  }
  if (req.method === "DELETE" && req.path.startsWith("/inventory/")) {
    await deleteItem(req.userId, req.pathParams.id ?? "");
    return json(200, { ok: true });
  }
  if (req.method === "GET" && req.path === "/recipes") {
    const items = await listItems(req.userId);
    const apiKey = process.env.SPOONACULAR_API_KEY ?? "";
    const recipes = await suggestRecipes(items.map((i) => i.name), apiKey);
    return json(200, { recipes });
  }
  if (req.method === "POST" && req.path === "/receipts") {
    // TODO: presigned-upload + Textract + persistence flow wired in Task 10 follow-up.
    return json(501, { message: "Not implemented in scaffold" });
  }
  return json(404, { message: "Not found" });
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  let userId: string | null = null;
  try {
    userId = getUserId(event);
  } catch {
    userId = null;
  }
  const res = await route({
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    userId,
    body: event.body ?? null,
    pathParams: event.pathParameters ?? {},
  });
  return { statusCode: res.statusCode, headers: { "content-type": "application/json" }, body: res.body };
}
