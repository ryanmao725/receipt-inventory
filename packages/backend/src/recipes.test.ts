import { describe, it, expect, vi } from "vitest";
import { mapSpoonacularResults, suggestRecipes } from "./recipes.js";

describe("mapSpoonacularResults", () => {
  it("maps Spoonacular findByIngredients results to Recipe[]", () => {
    const raw = [
      {
        id: 42,
        title: "Pancakes",
        usedIngredients: [{ name: "milk" }],
        missedIngredients: [{ name: "flour" }],
      },
    ];
    expect(mapSpoonacularResults(raw)).toEqual([
      {
        id: "42",
        title: "Pancakes",
        usedIngredients: ["milk"],
        missedIngredients: ["flour"],
        sourceUrl: "https://spoonacular.com/recipes/pancakes-42",
      },
    ]);
  });
});

describe("suggestRecipes", () => {
  it("returns empty array when there are no ingredients", async () => {
    const fetchFn = vi.fn();
    const result = await suggestRecipes([], "fake-key", fetchFn);
    expect(result).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
