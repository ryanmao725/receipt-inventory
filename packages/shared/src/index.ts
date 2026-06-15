export interface ReceiptLineItem {
  name: string;
  quantity: number;
  unit: string;
  price: number;
}

export interface Receipt {
  userId: string;
  receiptId: string;
  merchant: string;
  purchasedAt: string; // ISO date
  total: number;
  imageS3Key: string;
  lineItems: ReceiptLineItem[];
  createdAt: string; // ISO date
}

export interface InventoryItem {
  userId: string;
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  sourceReceiptId: string | null;
  updatedAt: string; // ISO date
}

export interface Recipe {
  id: string;
  title: string;
  usedIngredients: string[];
  missedIngredients: string[];
  sourceUrl: string;
}

// API DTOs
export interface ScanReceiptResponse {
  receipt: Receipt;
  addedItems: InventoryItem[];
}

export interface ListInventoryResponse {
  items: InventoryItem[];
}

export interface UpdateInventoryItemRequest {
  quantity?: number;
  unit?: string;
  name?: string;
}

export interface ListRecipesResponse {
  recipes: Recipe[];
}

export interface CreateUploadUrlResponse {
  uploadUrl: string;
  imageS3Key: string;
}
