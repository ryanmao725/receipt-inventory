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
import CookRecipeModal from "../recipes/CookRecipeModal.js";
import type { Recipe } from "@receipt-scanner/shared";

export default function Recipes() {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [cooking, setCooking] = useState<Recipe | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    getRecipes()
      .then((r) => setRecipes(r.recipes))
      .catch(() => setRecipes([]));
  }, []);

  return (
    <Stack>
      <Title order={2}>Recipe suggestions</Title>
      {message && <Text c="dimmed">{message}</Text>}
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
              {r.usedIngredients.length > 0 && (
                <Button variant="subtle" fullWidth mt="xs" onClick={() => setCooking(r)}>
                  I cooked this
                </Button>
              )}
            </Card>
          ))}
        </SimpleGrid>
      )}
      {cooking && (
        <CookRecipeModal
          key={cooking.id}
          title={cooking.title}
          usedIngredients={cooking.usedIngredients}
          opened={cooking !== null}
          onClose={() => setCooking(null)}
          onDone={setMessage}
        />
      )}
    </Stack>
  );
}
