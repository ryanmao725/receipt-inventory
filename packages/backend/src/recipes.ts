import type { Recipe } from "@receipt-scanner/shared";
import { log } from "./log.js";

interface SpoonacularIngredient { name: string }
interface SpoonacularResult {
  id: number;
  title: string;
  usedIngredients?: SpoonacularIngredient[];
  missedIngredients?: SpoonacularIngredient[];
}

export function mapSpoonacularResults(raw: SpoonacularResult[]): Recipe[] {
  return raw.map((r) => ({
    id: String(r.id),
    title: r.title,
    usedIngredients: (r.usedIngredients ?? []).map((i) => i.name),
    missedIngredients: (r.missedIngredients ?? []).map((i) => i.name),
    sourceUrl: `https://spoonacular.com/recipes/${r.title.toLowerCase().replace(/\s+/g, "-")}-${r.id}`,
  }));
}

/** Queries Spoonacular findByIngredients. `fetchFn` is injectable for testing. */
export async function suggestRecipes(
  ingredients: string[],
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<Recipe[]> {
  if (ingredients.length === 0) return [];
  log.debug({ ingredientCount: ingredients.length }, "querying spoonacular");
  // TODO: add ranking/number params and error handling for non-200 responses.
  const url = new URL("https://api.spoonacular.com/recipes/findByIngredients");
  url.searchParams.set("ingredients", ingredients.join(","));
  url.searchParams.set("number", "10");
  url.searchParams.set("apiKey", apiKey);
  let raw: SpoonacularResult[];
  let status: number;
  try {
    const res = await fetchFn(url.toString());
    status = res.status;
    raw = (await res.json()) as SpoonacularResult[];
  } catch {
    // The request URL carries the apiKey in its query string; never let it reach
    // logs via an error's message/cause chain. Throw a sanitized error instead.
    throw new Error("spoonacular request failed");
  }
  log.debug({ recipeCount: raw.length, status }, "spoonacular responded");
  return mapSpoonacularResults(raw);
}
