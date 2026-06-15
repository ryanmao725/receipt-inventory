import { useEffect, useState } from "react";
import { Anchor, Card, Loader, Stack, Text, Title } from "@mantine/core";
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
        recipes.map((r) => (
          <Card key={r.id} withBorder padding="sm">
            <Anchor href={r.sourceUrl} target="_blank" rel="noreferrer">
              {r.title}
            </Anchor>
          </Card>
        ))
      )}
    </Stack>
  );
}
