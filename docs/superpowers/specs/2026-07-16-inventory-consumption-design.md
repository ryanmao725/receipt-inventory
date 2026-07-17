# Inventory Consumption Design

**Date:** 2026-07-16

## Goal

Let users remove what they've consumed from inventory, by amount, from two
places: (1) the Inventory page — a per-row "Use N" and an outright "Remove";
and (2) a recipe card — "I cooked this", which deducts the recipe's used
ingredients from inventory in one step. When an item's quantity reaches zero it
is deleted. No consumption history is kept (quantity adjustment only).

## Scope

**In:**
- Atomic decrement of an inventory item by an amount; delete when quantity ≤ 0.
- Inventory page becomes interactive: per-row amount input + "Use" + "Remove".
- Recipe card "I cooked this" → confirm dialog (used ingredients, editable
  amounts, skip toggles) → batch deduct.
- Matching recipe ingredients to inventory via the existing canonical-slug
  identity (`itemId = slug(canonicalName)`), so `slug(ingredient)` resolves the
  item — no fuzzy matching.

**Out (YAGNI):**
- Consumption history / log table and any waste/consumption analytics.
- Incrementing inventory from these controls (no "+" stepper); adds happen via
  the receipt flow.
- Unit-aware amounts from recipes (recipes carry no inventory-unit amounts);
  the recipe dialog defaults to 1 per used ingredient.

## Architecture

Three write paths share one core `consumeItem`:

- `POST /inventory/{id}/consume` `{ amount }` — Inventory-page "Use".
- `POST /inventory/consume` `{ items: [{ ingredient, amount }] }` — recipe cook
  (loops `consumeItem` with `itemId = slug(ingredient)`).
- `DELETE /inventory/{id}` — existing route, the "Remove" button (frontend
  wiring only; no backend change).

## Components

### `packages/backend/src/inventory.ts` (modify)
Add `consumeItem`, returning a discriminated result so callers know what
happened:
```typescript
export type ConsumeResult =
  | { status: "updated"; item: InventoryItem }
  | { status: "removed" }
  | { status: "not_found" };

export async function consumeItem(
  userId: string,
  itemId: string,
  amount: number,
  now?: () => string,
  send?: UpdateSend,               // injectable (reuses the existing type)
  del?: (userId: string, itemId: string) => Promise<void>, // defaults to deleteItem
): Promise<ConsumeResult>;
```
Implementation: one `UpdateCommand` — `SET updatedAt = :now ADD quantity :neg`
(`:neg = -amount`), `ConditionExpression: "attribute_exists(itemId)"`,
`ReturnValues: "ALL_NEW"`. On `ConditionalCheckFailedException` → `not_found`
(item already gone / never existed — the condition prevents resurrecting a
deleted row). If the returned `quantity <= 0` → call `del` and return `removed`.
Otherwise return `updated` with the new item. `slug` (already exported) is used
by the batch route to resolve ingredient → itemId.

### `packages/backend/src/handler.ts` (modify)
Add, in the inventory route group:
- **`POST /inventory/consume`** (exact match, checked BEFORE the single route so
  it doesn't fall through): parse `items: {ingredient, amount}[]`; for each with
  a non-empty `ingredient` and finite `amount > 0`, call
  `consumeItem(userId, slug(ingredient), amount)`; accumulate into
  `{ used, removed, notFound }` (an updated or removed ingredient counts as
  `used`; removed also lands in `removed`; `not_found` → `notFound`). Return 200.
- **`POST /inventory/{id}/consume`** (`path.startsWith("/inventory/") &&
  path.endsWith("/consume")`): validate `amount` finite `> 0` → else 400;
  `consumeItem(userId, pathParams.id, amount)`; `not_found` → 404; else 200 with
  `{ item }` (`item = null` when removed).

Imports gain `consumeItem` and `slug`.

### `packages/shared/src/index.ts` (modify)
```typescript
export interface ConsumeInventoryItemRequest { amount: number }
export interface ConsumeInventoryItemResponse { item: InventoryItem | null }
export interface ConsumeIngredientsRequest {
  items: { ingredient: string; amount: number }[];
}
export interface ConsumeIngredientsResponse {
  used: string[];
  removed: string[];
  notFound: string[];
}
```

### `packages/infra/lib/backend-stack.ts` (modify)
Add two routes to the HTTP API loop (same integration + JWT authorizer):
`POST /inventory/{id}/consume` and `POST /inventory/consume`. No new grants —
the Lambda already has read/write on the inventory table. `DELETE /inventory/{id}`
already exists.

### Frontend
- `packages/frontend/src/api.ts`: `consumeItem(itemId, amount)` →
  `POST /inventory/{id}/consume`; `removeItem(itemId)` → `DELETE /inventory/{id}`;
  `cookRecipe(items)` → `POST /inventory/consume`.
- `packages/frontend/src/pages/Inventory.tsx`: hold items in state; each row adds
  an amount `NumberInput` (default 1), a "Use" button (→ `consumeItem`; update
  the row's quantity, or drop it if the response `item` is null), and a "Remove"
  button (→ `removeItem`; drop the row). Errors surface in an `Alert`.
- `packages/frontend/src/recipes/CookRecipeModal.tsx` (new): a Mantine `Modal`
  listing the recipe's `usedIngredients`, each with an amount `NumberInput`
  (default 1) and a keep/skip `Switch`. Confirm → `cookRecipe(keptItems)`,
  close, and report a one-line summary via a callback.
- `packages/frontend/src/pages/Recipes.tsx`: each card gains an "I cooked this"
  button that opens `CookRecipeModal`; the returned summary renders inline
  (e.g. "Used 4 ingredients — 1 wasn't in your inventory"). No new dependency.

## Data flow

Inventory "Use": `Inventory.tsx` → `consumeItem(itemId, amount)` → backend
`consumeItem` (atomic ADD, delete if ≤ 0) → `{ item | null }` → row updated or
dropped.

Recipe "I cooked this": `Recipes.tsx` → `CookRecipeModal` → `cookRecipe(items)`
→ backend maps each `slug(ingredient)` → `consumeItem` → `{ used, removed,
notFound }` → inline summary.

## Error handling

- Single consume: missing/non-positive `amount` → 400; item not present → 404;
  DynamoDB error → 500 (handler's normal path). Consuming ≥ current quantity
  removes the item (returns `{ item: null }`), not an error.
- Batch consume: malformed entries (blank ingredient or non-positive amount) are
  skipped, not failed; unmatched ingredients report in `notFound`; the call is
  200 as long as the request is well-formed.
- Auth/ownership unchanged: `userId` from JWT scopes every DynamoDB key.

## Testing (TDD)

`packages/backend/src/inventory.test.ts` (add):
- `consumeItem` returns `updated` with decremented quantity (injected `send`
  returns `ALL_NEW` attributes with quantity > 0).
- `consumeItem` returns `removed` and calls `del` when the new quantity ≤ 0.
- `consumeItem` returns `not_found` when `send` throws
  `ConditionalCheckFailedException` (name-based).

`packages/backend/src/handler.*.test.ts` (add):
- `POST /inventory/{id}/consume`: 200 with updated item; `{ item: null }` when
  removed; 400 on missing/non-positive amount; 404 when `consumeItem` reports
  `not_found` (mock `consumeItem`).
- `POST /inventory/consume`: given a mix of ingredients, returns the correct
  `{ used, removed, notFound }` split (mock `consumeItem`).

`packages/infra/test/backend-stack.test.ts` (add): the two new routes exist.

Frontend has no test harness; the modal's confirm-payload building is kept
simple and is build-checked.

## Security notes

- `userId` comes only from JWT claims; every `consumeItem` / `deleteItem`
  DynamoDB key is `{ userId, itemId }`, so a user can only decrement or remove
  their own items. The batch route resolves ingredient → `slug(ingredient)` but
  still keys the write by the caller's `userId`.
