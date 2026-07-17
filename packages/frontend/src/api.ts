import { fetchAuthSession } from "aws-amplify/auth";
import type {
  ListInventoryResponse,
  ListRecipesResponse,
  CreateUploadUrlResponse,
  ScanReceiptResponse,
  ProposeReceiptResponse,
  CommitReceiptRequest,
  ConsumeInventoryItemResponse,
  ConsumeIngredientsRequest,
  ConsumeIngredientsResponse,
} from "@receipt-scanner/shared";

const BASE = import.meta.env.VITE_API_URL as string;

async function authHeaders(): Promise<HeadersInit> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString() ?? "";
  return { authorization: token, "content-type": "application/json" };
}

export async function getInventory(): Promise<ListInventoryResponse> {
  const res = await fetch(`${BASE}/inventory`, { headers: await authHeaders() });
  return res.json();
}

export async function getRecipes(): Promise<ListRecipesResponse> {
  const res = await fetch(`${BASE}/recipes`, { headers: await authHeaders() });
  return res.json();
}

export async function getUploadUrl(): Promise<CreateUploadUrlResponse> {
  const res = await fetch(`${BASE}/receipts/upload-url`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Could not get upload URL: ${res.status}`);
  return res.json();
}

export async function uploadToS3(uploadUrl: string, file: File): Promise<void> {
  // Presigned URL — no auth header; the URL itself authorizes the PUT.
  const res = await fetch(uploadUrl, { method: "PUT", body: file });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

export async function proposeReceipt(file: File): Promise<ProposeReceiptResponse> {
  const { uploadUrl, imageS3Key } = await getUploadUrl();
  await uploadToS3(uploadUrl, file);
  const res = await fetch(`${BASE}/receipts/propose`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ imageS3Key }),
  });
  if (!res.ok) throw new Error(`Scan failed: ${res.status}`);
  return res.json();
}

export async function commitReceipt(req: CommitReceiptRequest): Promise<ScanReceiptResponse> {
  const res = await fetch(`${BASE}/receipts/commit`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Commit failed: ${res.status}`);
  return res.json();
}

export async function consumeItem(
  itemId: string,
  amount: number,
): Promise<ConsumeInventoryItemResponse> {
  const res = await fetch(`${BASE}/inventory/${encodeURIComponent(itemId)}/consume`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) throw new Error(`Could not use item: ${res.status}`);
  return res.json();
}

export async function removeItem(itemId: string): Promise<void> {
  const res = await fetch(`${BASE}/inventory/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Could not remove item: ${res.status}`);
}

export async function cookRecipe(
  items: ConsumeIngredientsRequest["items"],
): Promise<ConsumeIngredientsResponse> {
  const res = await fetch(`${BASE}/inventory/consume`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Could not update inventory: ${res.status}`);
  return res.json();
}
