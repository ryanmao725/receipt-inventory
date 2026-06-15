import { fetchAuthSession } from "aws-amplify/auth";
import type {
  ListInventoryResponse,
  ListRecipesResponse,
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

export async function uploadReceipt(file: File): Promise<Response> {
  // TODO: switch to presigned S3 upload; scaffold posts the raw file.
  const headers = await authHeaders();
  return fetch(`${BASE}/receipts`, {
    method: "POST",
    headers: { authorization: (headers as Record<string, string>).authorization },
    body: file,
  });
}
