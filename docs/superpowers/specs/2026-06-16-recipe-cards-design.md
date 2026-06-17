# Richer Recipe Cards Design

**Date:** 2026-06-16

## Goal

Replace the bare title-link recipe list with polished recipe cards: a recipe
photo, the title as a heading, "you have" / "missing" ingredient badges, and a
"View recipe" button. Carry the Spoonacular image URL through the backend so the
frontend can render it.

## Context

- `GET /recipes` → `suggestRecipes` (`packages/backend/src/recipes.ts`) calls
  Spoonacular `findByIngredients` and maps results via `mapSpoonacularResults`
  into the shared `Recipe` type.
- The `findByIngredients` response includes an `image` field — a public CDN URL
  (e.g. `https://img.spoonacular.com/recipes/640352-312x231.jpg`, a 312×231
  JPEG). No API key is in the URL; nothing secret. The current
  `SpoonacularResult` interface and `Recipe` type omit it, so it's discarded.
- `Recipe` (`packages/shared/src/index.ts:29`) currently has `id`, `title`,
  `usedIngredients`, `missedIngredients`, `sourceUrl`.
- `Recipes.tsx` (`packages/frontend/src/pages/Recipes.tsx`) renders each recipe
  as a `Card` containing only a title `Anchor`; it ignores both ingredient
  arrays.
- Frontend is React 18 + Mantine v7, TypeScript ESM (`.js` import extensions),
  no unit-test harness (build is the gate). Backend uses Vitest.

## Architecture

### Backend — carry the image through

1. **`packages/shared/src/index.ts`** — add `image: string;` to the `Recipe`
   interface (after `title`).
2. **`packages/backend/src/recipes.ts`**:
   - Add `image?: string;` to the `SpoonacularResult` interface.
   - In `mapSpoonacularResults`, set `image: r.image ?? ""` on each mapped recipe.
   - `suggestRecipes` is otherwise unchanged.
3. The shared package is rebuilt as part of the build so both backend and
   frontend see the new field.

### Frontend — `packages/frontend/src/pages/Recipes.tsx`

- Lay the cards out in a Mantine `SimpleGrid cols={{ base: 1, sm: 2 }}`
  (single column on phones, two on wider screens) instead of a single `Stack`.
- Each recipe renders a Mantine `Card withBorder shadow="sm" radius="md"`:
  - **Photo:** when `r.image` is non-empty, a `Card.Section` with
    `<Image src={r.image} h={160} alt={r.title} />`. When `r.image` is empty,
    omit the image section (no broken-image box).
  - **Title:** `<Text fw={600} mt="sm" lineClamp={2}>{r.title}</Text>` (heading
    weight, not a link).
  - **"You have"** row (only if `usedIngredients.length > 0`): a
    `<Text size="xs" c="dimmed">You have</Text>` label above a
    `<Group gap={4}>` of `<Badge variant="light" color="teal">` per ingredient.
  - **"Missing"** row (only if `missedIngredients.length > 0`): same pattern with
    `<Badge variant="light" color="red">`.
  - **"View recipe"** `<Button component="a" href={r.sourceUrl} target="_blank"
    rel="noreferrer" fullWidth mt="md" variant="light">View recipe</Button>`.
- Keep the existing states: `Loader` while `recipes === null`, the
  "No suggestions yet — add items to your inventory." `Text` when empty, and the
  `getRecipes().catch(() => setRecipes([]))` fallback.

## Data flow

`GET /recipes` → `suggestRecipes` → `mapSpoonacularResults` (now includes
`image`) → `getRecipes()` in `api.ts` (unchanged) → `Recipes.tsx` renders a
`SimpleGrid` of photo cards. Image URLs are public CDN links rendered directly by
`<Image>`.

## Error handling

- Empty/absent `image` → the card omits the photo section (handled by the
  `r.image` conditional); no backend error since `mapSpoonacularResults` defaults
  it to `""`.
- A broken image URL at runtime → Mantine `<Image>` simply fails to paint; the
  rest of the card is unaffected. (No `fallbackSrc` needed; out of scope.)
- Recipe fetch failure → existing `.catch(() => setRecipes([]))` shows the empty
  state (unchanged).

## Testing

- **Backend (Vitest):** update the existing `mapSpoonacularResults` test in
  `packages/backend/src/recipes.test.ts` so the input includes an `image` and the
  expected `Recipe` includes `image`. Add/confirm a case where `image` is absent
  maps to `image: ""`. Run `pnpm --filter @receipt-scanner/backend test` — all
  green.
- **Frontend:** no unit-test harness; the gate is
  `pnpm --filter @receipt-scanner/frontend build` (type-check + Vite build). The
  new `Recipe.image` field must type-check through `Recipes.tsx`.
- **Manual:** open the Recipes tab with inventory present → cards show the recipe
  photo, title, teal "have" badges, red "missing" badges, and a working
  "View recipe" button opening the Spoonacular page in a new tab.

## Out of scope (YAGNI)

- Ingredient-name normalization / better matching (separate concern).
- In-app recipe detail view, pagination, or infinite scroll.
- Image caching/proxying or a custom placeholder image.
- Any change to the scan/inventory pipeline.
