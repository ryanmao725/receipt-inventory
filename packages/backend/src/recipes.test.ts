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

  it("throws a sanitized error (no apiKey/url) when fetch fails", async () => {
    const apiKey = "super-secret-key";
    // Simulate an undici-style error whose cause embeds the full request URL.
    const fetchFn = vi.fn(async (input: string) => {
      throw new Error(`fetch failed for ${input}`);
    }) as unknown as typeof fetch;

    await expect(suggestRecipes(["milk"], apiKey, fetchFn)).rejects.toThrow();
    let err: Error | undefined;
    try {
      await suggestRecipes(["milk"], apiKey, fetchFn);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).not.toContain(apiKey);
    expect(err!.message.toLowerCase()).not.toContain("apikey");
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});
