import { useEffect, useState } from "react";
import { getRecipes } from "../api.js";
import type { Recipe } from "@receipt-scanner/shared";

export default function Recipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  useEffect(() => {
    getRecipes().then((r) => setRecipes(r.recipes)).catch(() => setRecipes([]));
  }, []);
  return (
    <section>
      <h2>Recipe suggestions</h2>
      <ul>
        {recipes.map((r) => (
          <li key={r.id}><a href={r.sourceUrl}>{r.title}</a></li>
        ))}
      </ul>
    </section>
  );
}
