# Richer Recipe Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show recipe results as polished cards — photo, title, "have"/"missing" ingredient badges, and a "View recipe" button — by carrying the Spoonacular image URL through the backend into a redesigned Recipes page.

**Architecture:** Add an `image` field to the shared `Recipe` type and map Spoonacular's `image` in `mapSpoonacularResults` (backend, TDD). Then rebuild `Recipes.tsx` to render a responsive `SimpleGrid` of Mantine cards using the existing `usedIngredients`/`missedIngredients` plus the new `image`. No change to the scan/inventory pipeline or the `/recipes` request flow.

**Tech Stack:** TypeScript ESM (`.js` import extensions), Vitest (backend), React 18 + Mantine v7 + Vite (frontend, build is the gate — no unit-test harness).

---

## File Structure

- **Modify** `packages/shared/src/index.ts` — add `image` to `Recipe`.
- **Modify** `packages/backend/src/recipes.ts` — add `image` to `SpoonacularResult` + map it.
- **Modify** `packages/backend/src/recipes.test.ts` — cover the `image` mapping.
- **Modify** `packages/frontend/src/pages/Recipes.tsx` — richer card grid.

---

## Task 1: Carry the recipe image through the backend

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/backend/src/recipes.ts`
- Test: `packages/backend/src/recipes.test.ts`

- [ ] **Step 1: Update the tests (failing first)**

In `packages/backend/src/recipes.test.ts`, replace the entire `describe("mapSpoonacularResults", ...)` block (currently lines 4-24) with:
```ts
describe("mapSpoonacularResults", () => {
  it("maps Spoonacular findByIngredients results to Recipe[]", () => {
    const raw = [
      {
        id: 42,
        title: "Pancakes",
        image: "https://img.spoonacular.com/recipes/42-312x231.jpg",
        usedIngredients: [{ name: "milk" }],
        missedIngredients: [{ name: "flour" }],
      },
    ];
    expect(mapSpoonacularResults(raw)).toEqual([
      {
        id: "42",
        title: "Pancakes",
        image: "https://img.spoonacular.com/recipes/42-312x231.jpg",
        usedIngredients: ["milk"],
        missedIngredients: ["flour"],
        sourceUrl: "https://spoonacular.com/recipes/pancakes-42",
      },
    ]);
  });

  it("defaults image to an empty string when absent", () => {
    const raw = [{ id: 7, title: "Toast", usedIngredients: [], missedIngredients: [] }];
    expect(mapSpoonacularResults(raw)[0].image).toBe("");
  });
});
```
(Leave the `describe("suggestRecipes", ...)` block untouched.)

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
pnpm --filter @receipt-scanner/backend exec vitest run src/recipes.test.ts
```
Expected: FAIL — `mapSpoonacularResults` does not yet set `image` (the first test's `toEqual` mismatches; the second expects `""` but gets `undefined`).

- [ ] **Step 3: Add `image` to the shared `Recipe` type**

In `packages/shared/src/index.ts`, the `Recipe` interface currently is:
```ts
export interface Recipe {
  id: string;
  title: string;
  usedIngredients: string[];
  missedIngredients: string[];
  sourceUrl: string;
}
```
Add the `image` field after `title`:
```ts
export interface Recipe {
  id: string;
  title: string;
  image: string;
  usedIngredients: string[];
  missedIngredients: string[];
  sourceUrl: string;
}
```

- [ ] **Step 4: Map the image in `recipes.ts`**

In `packages/backend/src/recipes.ts`:

(a) Add `image?: string;` to the `SpoonacularResult` interface, which becomes:
```ts
interface SpoonacularResult {
  id: number;
  title: string;
  image?: string;
  usedIngredients?: SpoonacularIngredient[];
  missedIngredients?: SpoonacularIngredient[];
}
```

(b) Add the `image` line to `mapSpoonacularResults` so it reads:
```ts
export function mapSpoonacularResults(raw: SpoonacularResult[]): Recipe[] {
  return raw.map((r) => ({
    id: String(r.id),
    title: r.title,
    image: r.image ?? "",
    usedIngredients: (r.usedIngredients ?? []).map((i) => i.name),
    missedIngredients: (r.missedIngredients ?? []).map((i) => i.name),
    sourceUrl: `https://spoonacular.com/recipes/${r.title.toLowerCase().replace(/\s+/g, "-")}-${r.id}`,
  }));
}
```
(Do not change `suggestRecipes`.)

- [ ] **Step 5: Build shared + run the backend tests**

Run:
```bash
pnpm --filter @receipt-scanner/shared build && pnpm --filter @receipt-scanner/backend test
```
Expected: shared builds; all backend tests pass (including the two `mapSpoonacularResults` cases). (The shared build first ensures the backend type-checks against the new `Recipe.image`.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts packages/backend/src/recipes.ts packages/backend/src/recipes.test.ts
git commit -m "feat(backend): include recipe image URL in Recipe results"
```

---

## Task 2: Redesign the Recipes page as photo cards

**Files:**
- Modify: `packages/frontend/src/pages/Recipes.tsx`

No unit tests (no frontend harness); the gate is a clean build. Depends on Task 1's `Recipe.image`.

- [ ] **Step 1: Replace `Recipes.tsx`**

Replace the entire contents of `packages/frontend/src/pages/Recipes.tsx` with:
```tsx
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Group,
  Image,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { getRecipes } from "../api.js";
import type { Recipe } from "@receipt-scanner/shared";

export default function Recipes() {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  useEffect(() => {
    getRecipes()
      .then((r) => setRecipes(r.recipes))
      .catch(() => setRecipes([]));
  }, []);

  return (
    <Stack>
      <Title order={2}>Recipe suggestions</Title>
      {recipes === null ? (
        <Loader size="sm" />
      ) : recipes.length === 0 ? (
        <Text c="dimmed">No suggestions yet — add items to your inventory.</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {recipes.map((r) => (
            <Card key={r.id} withBorder shadow="sm" radius="md" padding="md">
              {r.image && (
                <Card.Section>
                  <Image src={r.image} h={160} alt={r.title} />
                </Card.Section>
              )}
              <Text fw={600} mt="sm" lineClamp={2}>
                {r.title}
              </Text>
              {r.usedIngredients.length > 0 && (
                <Stack gap={2} mt="sm">
                  <Text size="xs" c="dimmed">
                    You have
                  </Text>
                  <Group gap={4}>
                    {r.usedIngredients.map((ing, i) => (
                      <Badge key={i} variant="light" color="teal">
                        {ing}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              )}
              {r.missedIngredients.length > 0 && (
                <Stack gap={2} mt="sm">
                  <Text size="xs" c="dimmed">
                    Missing
                  </Text>
                  <Group gap={4}>
                    {r.missedIngredients.map((ing, i) => (
                      <Badge key={i} variant="light" color="red">
                        {ing}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              )}
              <Button
                component="a"
                href={r.sourceUrl}
                target="_blank"
                rel="noreferrer"
                variant="light"
                fullWidth
                mt="md"
              >
                View recipe
              </Button>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
```

What changed (for reviewer awareness): the bare `Anchor` is gone; cards now live in a responsive `SimpleGrid`, each with an optional photo `Card.Section`, a heading-weight title, conditional teal "have" / red "missing" badge rows, and a "View recipe" `Button` (polymorphic `component="a"`). The data fetch, loading, empty, and `.catch` states are unchanged. Index-based `key`s on badges avoid duplicate-key warnings if an ingredient name repeats.

- [ ] **Step 2: Verify the build**

Run:
```bash
pnpm --filter @receipt-scanner/frontend build
```
Expected: PASS — no TypeScript/Vite errors (requires Task 1's `Recipe.image`; the shared package must have been built in Task 1 Step 5).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/Recipes.tsx
git commit -m "feat(frontend): redesign Recipes as photo cards with have/missing badges"
```

---

## Final verification

- [ ] **Backend tests + frontend build:**
```bash
pnpm --filter @receipt-scanner/shared build && pnpm --filter @receipt-scanner/backend test && pnpm --filter @receipt-scanner/frontend build
```
Expected: shared builds; backend tests green; frontend builds with no errors.

- [ ] **Manual checklist** (after deploy or via `pnpm --filter @receipt-scanner/frontend dev`):
  1. Open the Recipes tab with inventory present → cards render in a grid with a recipe photo each.
  2. Each card shows teal "You have" badges and red "Missing" badges (rows hidden when empty).
  3. "View recipe" opens the Spoonacular page in a new tab.
  4. A recipe with no image still renders a clean card (no broken-image box).

Then hand off to `superpowers:finishing-a-development-branch`.
