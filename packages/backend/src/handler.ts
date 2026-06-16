import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { getUserId } from "./auth.js";
import { listItems, updateItem, deleteItem, lineItemsToInventory, putItems } from "./inventory.js";
import { suggestRecipes } from "./recipes.js";
import { getSpoonacularApiKey } from "./config.js";
import { analyzeReceipt } from "./textract.js";
import { buildReceipt, putReceipt } from "./receipts.js";
import { createUploadUrl, isOwnedKey, parseReceiptId } from "./upload.js";
import { log, runWithLogContext } from "./log.js";

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

const JSON_HEADERS = { "content-type": "application/json" } as const;

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
    const apiKey = await getSpoonacularApiKey();
    if (!apiKey || apiKey === "REPLACE_ME") return json(200, { recipes: [] });
    const items = await listItems(req.userId);
    const recipes = await suggestRecipes(items.map((i) => i.name), apiKey);
    return json(200, { recipes });
  }
  if (req.method === "POST" && req.path === "/receipts/upload-url") {
    const { uploadUrl, imageS3Key } = await createUploadUrl(req.userId);
    return json(200, { uploadUrl, imageS3Key });
  }
  if (req.method === "POST" && req.path === "/receipts") {
    const imageS3Key: string = JSON.parse(req.body ?? "{}").imageS3Key ?? "";
    if (!imageS3Key) return json(400, { message: "imageS3Key is required" });
    if (!isOwnedKey(req.userId, imageS3Key)) return json(403, { message: "Forbidden" });
    const receiptId = parseReceiptId(imageS3Key);
    const bucket = process.env.RECEIPTS_BUCKET ?? "";
    const lineItems = await analyzeReceipt(bucket, imageS3Key);
    const receipt = buildReceipt({ userId: req.userId, receiptId, imageS3Key, lineItems });
    await putReceipt(receipt);
    const addedItems = lineItemsToInventory(req.userId, receiptId, lineItems);
    await putItems(addedItems);
    return json(200, { receipt, addedItems });
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

  const requestId = event.requestContext.requestId;
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;

  return runWithLogContext({ requestId, method, path, userId }, async () => {
    const start = Date.now();
    log.info("request received");
    if (userId === null) log.debug("unauthenticated request");

    try {
      const res = await route({
        method,
        path,
        userId,
        body: event.body ?? null,
        pathParams: event.pathParameters ?? {},
      });
      log.info({ statusCode: res.statusCode, durationMs: Date.now() - start }, "request completed");
      return {
        statusCode: res.statusCode,
        headers: JSON_HEADERS,
        body: res.body,
      };
    } catch (err) {
      log.error({ err, durationMs: Date.now() - start }, "request failed");
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ message: "Internal Server Error" }),
      };
    }
  });
}
