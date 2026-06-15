import type { Recipe } from "@receipt-scanner/shared";

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
  // TODO: add ranking/number params and error handling for non-200 responses.
  const url = new URL("https://api.spoonacular.com/recipes/findByIngredients");
  url.searchParams.set("ingredients", ingredients.join(","));
  url.searchParams.set("number", "10");
  url.searchParams.set("apiKey", apiKey);
  const res = await fetchFn(url.toString());
  const raw = (await res.json()) as SpoonacularResult[];
  return mapSpoonacularResults(raw);
}
