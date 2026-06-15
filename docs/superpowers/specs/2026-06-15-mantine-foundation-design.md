# Mantine Foundation + Restyle Design (Plan A)

**Date:** 2026-06-15

## Goal

Introduce Mantine as the frontend UI library: set it up correctly for Vite, apply a teal-branded theme with a light/dark toggle, and restyle the app shell plus the three pages (Scan, Inventory, Recipes) with Mantine components.

## Scope

**In (Plan A):**
- Mantine install + Vite/PostCSS setup + provider/theme.
- Light default with teal primary; header light/dark toggle (persisted).
- Restyle the app shell (header + tab nav) and all three page bodies with Mantine components.

**Out (Plan B — separate spec/plan, brainstormed after A ships):**
- Redesigning the sign-in screen. Amplify's default `<Authenticator>` UI stays as-is in Plan A; Plan B replaces it with a custom Mantine auth UI built on `aws-amplify/auth` APIs.

## Setup (Mantine + Vite)

- Dependencies: `@mantine/core`, `@mantine/hooks`. Dev dependencies: `postcss-preset-mantine`, `postcss-simple-vars`.
- New `packages/frontend/postcss.config.cjs`:
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
  (Required so Mantine's CSS compiles under Vite.)
- Color-scheme flash prevention: render `<ColorSchemeScript defaultColorScheme="light" />` (from `@mantine/core`) in `main.tsx` immediately before `<MantineProvider>`, inside the `ReactDOM.createRoot(...).render(...)` tree. (No `index.html` change needed for the Vite CSR app.)
- `main.tsx`:
  - `import "@mantine/core/styles.css";` (after the existing Amplify styles import).
  - Define `const theme = createTheme({ primaryColor: "teal" });`.
  - Wrap the tree:
    ```tsx
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Authenticator>{() => <App />}</Authenticator>
    </MantineProvider>
    ```
  - Keep the existing `Amplify.configure(...)` and the `<Authenticator>` exactly as-is (auth UI untouched in Plan A). `MantineProvider` wraps the Authenticator so the app is themed; Amplify's own screen renders unaffected.

## Components

### App shell — `packages/frontend/src/App.tsx`
- Replace the inline-styled `<main>`/`<header>`/`<nav>` with Mantine:
  - A `Container` (size `sm`/`md`) wrapping everything.
  - A header `Group` with: `Title` ("Receipt Scanner"), a spacer, an `ActionIcon` light/dark toggle (uses `useMantineColorScheme().toggleColorScheme` and shows a sun/moon — icons via inline SVG or text to avoid adding an icon dependency), and a `Button variant="default"` "Sign out" calling `signOut()` from `aws-amplify/auth`.
  - Navigation via Mantine `Tabs` (controlled by local state `tab`), with `Tabs.List` of three `Tabs.Tab` (Scan / Inventory / Recipes) and three `Tabs.Panel`s rendering `<Scan/>`, `<Inventory/>`, `<Recipes/>`.
- No new icon library: the toggle uses a simple character/SVG to keep the dependency footprint minimal.

### `packages/frontend/src/pages/Scan.tsx`
- Use Mantine `FileButton` (or a styled file input) to choose the image; on change run the existing `uploadReceipt(file)` flow (unchanged API).
- Status: a `Loader` + `Text` while uploading/scanning; an `Alert color="red"` on error.
- Result: a `Card` showing `Title` `{merchant} — ${total}` and a `Table` of line items (`{quantity} × {name}` and `${price}`). Keep the existing `ScanReceiptResponse` shape.

### `packages/frontend/src/pages/Inventory.tsx`
- Keep the existing `getInventory()` fetch in `useEffect`.
- Render a Mantine `Table` (columns: Name, Quantity, Unit). Show a `Loader` while loading and `Text` "No items yet." when empty.

### `packages/frontend/src/pages/Recipes.tsx`
- Keep the existing `getRecipes()` fetch.
- Render a `Stack` of `Card`s, each with the recipe `Title` as a Mantine `Anchor` (`href={r.sourceUrl}`, `target="_blank"`). Empty-state `Text`.

## Theming / dark mode

- `primaryColor: "teal"` from Mantine's built-in palette.
- `defaultColorScheme: "light"`; the header `ActionIcon` toggles light/dark. Mantine persists the choice in `localStorage` automatically via the provider; `ColorSchemeScript` prevents a flash of the wrong scheme on reload.

## Error handling

- Scan errors surface in an `Alert` (already thrown by `uploadReceipt`); Inventory/Recipes fetch failures fall back to empty lists (existing `.catch(() => set([]))` behavior preserved).

## Testing

- The frontend has no unit-test harness; the verification gate is `pnpm --filter @receipt-scanner/frontend build` (TypeScript type-check + Vite production build, which also compiles the PostCSS/Mantine pipeline). A successful build with no type errors is the pass condition for each task.
- Manual sanity (optional, not required by the plan): `pnpm --filter @receipt-scanner/frontend dev` and click through the tabs + dark toggle.

## Out of scope (YAGNI)

- Icon library (`@tabler/icons-react`): use a minimal inline glyph for the toggle instead.
- `@mantine/notifications`, forms, or other Mantine sub-packages — not needed for these pages.
- Any change to backend, infra, or the Amplify auth screen.
