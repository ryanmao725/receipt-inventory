# Mantine Foundation + Restyle Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Mantine to the frontend with a teal theme + light/dark toggle, and restyle the app shell and the three pages (Scan, Inventory, Recipes) with Mantine components.

**Architecture:** Mantine 7/8 with Vite requires a PostCSS preset; `MantineProvider` wraps the app (outside the Amplify `<Authenticator>`, which stays as-is in Plan A). The custom auth screen is Plan B (separate). The frontend has no unit-test harness, so each task's verification gate is a clean `pnpm --filter @receipt-scanner/frontend build` (tsc type-check + Vite build, which also compiles the Mantine/PostCSS pipeline).

**Tech Stack:** React 18, Vite, TypeScript (ESM), `@mantine/core` + `@mantine/hooks`, `postcss-preset-mantine`.

---

## File Structure

```
packages/frontend/
├─ package.json                # + @mantine/core, @mantine/hooks (deps); + postcss-preset-mantine, postcss-simple-vars (dev)
├─ postcss.config.cjs          # NEW — Mantine PostCSS preset
└─ src/
   ├─ main.tsx                 # MODIFY — MantineProvider + theme + ColorSchemeScript + styles import
   ├─ App.tsx                  # MODIFY — Mantine shell (Container, Group, Tabs, dark toggle)
   └─ pages/
      ├─ Scan.tsx              # MODIFY — Mantine FileButton/Card/Table/Alert
      ├─ Inventory.tsx         # MODIFY — Mantine Table + loading/empty states
      └─ Recipes.tsx           # MODIFY — Mantine Cards + Anchor
```

---

## Task 1: Install Mantine + PostCSS + provider wiring

**Files:**
- Modify: `packages/frontend/package.json` (via `pnpm add`)
- Create: `packages/frontend/postcss.config.cjs`
- Modify: `packages/frontend/src/main.tsx`

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm --filter @receipt-scanner/frontend add @mantine/core @mantine/hooks
pnpm --filter @receipt-scanner/frontend add -D postcss-preset-mantine postcss-simple-vars
```
Expected: installs current Mantine + PostCSS packages and updates `packages/frontend/package.json` + `pnpm-lock.yaml`. (Letting `pnpm add` resolve versions avoids pinning incompatible majors.)

- [ ] **Step 2: Create `packages/frontend/postcss.config.cjs`**

```js
module.exports = {
  plugins: {
    "postcss-preset-mantine": {},
    "postcss-simple-vars": {
      variables: {
        "mantine-breakpoint-xs": "36em",
        "mantine-breakpoint-sm": "48em",
        "mantine-breakpoint-md": "62em",
        "mantine-breakpoint-lg": "75em",
        "mantine-breakpoint-xl": "88em",
      },
    },
  },
};
```

- [ ] **Step 3: Replace `packages/frontend/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { ColorSchemeScript, MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import App from "./App.js";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    },
  },
});

const theme = createTheme({ primaryColor: "teal" });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ColorSchemeScript defaultColorScheme="light" />
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Authenticator>{() => <App />}</Authenticator>
    </MantineProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 4: Build to verify the Mantine/PostCSS pipeline compiles**

Run: `pnpm --filter @receipt-scanner/frontend build`
Expected: tsc + Vite build succeed with no errors (a chunk-size warning is fine). `App.tsx` is still the old inline-styled version at this point — it renders fine inside `MantineProvider`.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/package.json packages/frontend/postcss.config.cjs packages/frontend/src/main.tsx pnpm-lock.yaml
git commit -m "feat(frontend): add Mantine provider, theme, and PostCSS setup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Restyle the app shell

**Files:**
- Modify: `packages/frontend/src/App.tsx`

- [ ] **Step 1: Replace `packages/frontend/src/App.tsx`**

```tsx
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
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List mb="md">
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
```

- [ ] **Step 2: Build to verify**

Run: `pnpm --filter @receipt-scanner/frontend build`
Expected: succeeds, no type errors. (The pages are still their old versions — they render inside the new Tabs panels fine.)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "feat(frontend): Mantine app shell with tabs and dark-mode toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Restyle the Scan page

**Files:**
- Modify: `packages/frontend/src/pages/Scan.tsx`

- [ ] **Step 1: Replace `packages/frontend/src/pages/Scan.tsx`**

```tsx
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  FileButton,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { uploadReceipt } from "../api.js";
import type { ScanReceiptResponse } from "@receipt-scanner/shared";

export default function Scan() {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ScanReceiptResponse | null>(null);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setStatus("working");
    setMessage("Uploading and scanning…");
    setResult(null);
    try {
      const res = await uploadReceipt(file);
      setResult(res);
      setStatus("idle");
      setMessage(`Added ${res.addedItems.length} item(s) to inventory.`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Scan failed");
    }
  };

  return (
    <Stack>
      <Title order={2}>Scan a receipt</Title>
      <Group>
        <FileButton onChange={handleFile} accept="image/*">
          {(props) => <Button {...props}>Choose receipt image</Button>}
        </FileButton>
        {status === "working" && <Loader size="sm" />}
      </Group>
      {status === "error" ? (
        <Alert color="red">{message}</Alert>
      ) : (
        message !== "" && <Text c="dimmed">{message}</Text>
      )}
      {result && (
        <Card withBorder padding="md">
          <Title order={3} mb="sm">
            {result.receipt.merchant} — ${result.receipt.total.toFixed(2)}
          </Title>
          <Table>
            <Table.Tbody>
              {result.receipt.lineItems.map((li, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    {li.quantity} × {li.name}
                  </Table.Td>
                  <Table.Td ta="right">${li.price.toFixed(2)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}
```

- [ ] **Step 2: Build to verify**

Run: `pnpm --filter @receipt-scanner/frontend build`
Expected: succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/Scan.tsx
git commit -m "feat(frontend): Mantine-styled Scan page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Restyle the Inventory and Recipes pages

**Files:**
- Modify: `packages/frontend/src/pages/Inventory.tsx`
- Modify: `packages/frontend/src/pages/Recipes.tsx`

- [ ] **Step 1: Replace `packages/frontend/src/pages/Inventory.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Loader, Stack, Table, Text, Title } from "@mantine/core";
import { getInventory } from "../api.js";
import type { InventoryItem } from "@receipt-scanner/shared";

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  useEffect(() => {
    getInventory()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  return (
    <Stack>
      <Title order={2}>Inventory</Title>
      {items === null ? (
        <Loader size="sm" />
      ) : items.length === 0 ? (
        <Text c="dimmed">No items yet.</Text>
      ) : (
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Quantity</Table.Th>
              <Table.Th>Unit</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((i) => (
              <Table.Tr key={i.itemId}>
                <Table.Td>{i.name}</Table.Td>
                <Table.Td>{i.quantity}</Table.Td>
                <Table.Td>{i.unit}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
```

- [ ] **Step 2: Replace `packages/frontend/src/pages/Recipes.tsx`**

```tsx
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
```

- [ ] **Step 3: Build the frontend and the whole workspace**

Run: `pnpm --filter @receipt-scanner/frontend build`
Expected: succeeds, no type errors.

Run: `pnpm -r build && pnpm -r test`
Expected: all packages build; backend/infra tests still green (this change is frontend-only, so nothing else should be affected).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/Inventory.tsx packages/frontend/src/pages/Recipes.tsx
git commit -m "feat(frontend): Mantine-styled Inventory and Recipes pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **ESM imports** use `.js` extensions for local files (`./App.js`, `../api.js`); Mantine package imports do not.
- **Mantine styles import** (`@mantine/core/styles.css`) must be present once (in `main.tsx`) — Mantine components render unstyled without it.
- **No icon library:** the dark-mode toggle uses a plain emoji glyph in an `ActionIcon` to avoid adding `@tabler/icons-react`.
- **Loading vs empty:** Inventory/Recipes use `null` initial state to show a `Loader` until the fetch resolves, then `[]` distinguishes the empty state. The existing `.catch(() => set([]))` keeps a failed fetch from spinning forever.
- **No deploy in this plan.** When ready, pushing to `master` (which touches `packages/frontend/**`) auto-runs the deploy-frontend workflow; or redeploy manually.
- **Verification gate:** there are no frontend unit tests, so a clean `pnpm --filter @receipt-scanner/frontend build` (type-check + Vite build through the PostCSS pipeline) is the pass condition for every task.
```
