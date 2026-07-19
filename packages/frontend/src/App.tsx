import { useState } from "react";
import { signOut } from "aws-amplify/auth";
import {
  ActionIcon,
  Button,
  Container,
  Group,
  Tabs,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import Scan from "./pages/Scan.js";
import Inventory from "./pages/Inventory.js";
import Recipes from "./pages/Recipes.js";

export default function App() {
  const [tab, setTab] = useState<string | null>("scan");
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const toggleScheme = () => setColorScheme(computed === "dark" ? "light" : "dark");

  return (
    <Container size="sm" py="xl">
      <Group mb="lg">
        <Title order={1} style={{ marginRight: "auto" }}>
          Receipt Scanner
        </Title>
        <ActionIcon
          onClick={toggleScheme}
          variant="default"
          size="lg"
          aria-label="Toggle color scheme"
        >
          {computed === "dark" ? "☀" : "🌙"}
        </ActionIcon>
        <Button variant="default" onClick={() => signOut()}>
          Sign out
        </Button>
      </Group>
      <Tabs value={tab} onChange={setTab} variant="pills" radius="xl" color="leaf">
        <Tabs.List mb="lg">
          <Tabs.Tab value="scan">Scan</Tabs.Tab>
          <Tabs.Tab value="inventory">Inventory</Tabs.Tab>
          <Tabs.Tab value="recipes">Recipes</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="scan">
          <Scan />
        </Tabs.Panel>
        <Tabs.Panel value="inventory">
          <Inventory />
        </Tabs.Panel>
        <Tabs.Panel value="recipes">
          <Recipes />
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}
