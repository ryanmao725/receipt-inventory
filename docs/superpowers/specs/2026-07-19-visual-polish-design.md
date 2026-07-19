# Visual Polish — Identity & Restyle (Pass 1)

**Date:** 2026-07-19

## Goal

Give the app an intentional visual identity and restyle the existing screens to
match. Direction (validated via mockups): a warm-paper base with a fresh-green
action accent and a **receipt "signature"** — mono numerals, dashed receipt-rule
dividers, a SCANNED stamp, terracotta for money — used only where it belongs
(the Scan screen and monetary/scan numbers), not across the whole app.

Frontend-only. No backend, infra, or data-model changes.

## Scope

**In:**
- App-wide Mantine theme: warm palette, custom green primary + terracotta accent,
  fonts (Fraunces titles / DM Sans UI / Space Mono numerals, self-hosted via
  `@fontsource`), radii, warm page background (light + a warm dark).
- App shell restyle: wordmark + pill tabs.
- Scan restyle: receipt signature on the review table (dashed rules, mono line
  items, SCANNED stamp, terracotta total).
- Inventory restyle: row list with an Item/Qty/Actions header, sans quantity
  chips, client-side **search** + **sort** (recently-used / name), hover, solid
  dividers, "added Xd ago" (from `updatedAt`), and a subtle **low** tag when
  quantity ≤ 1. Existing amount + Use + Remove kept.
- Recipes restyle: warm cards, serif title, have/missing badges, an "N/M on
  hand" count, and the existing "I cooked this".

**Out (each its own follow-up):**
- Home dashboard + nav restructure (needs its own design pass).
- Spending tile/page (separate feature; needs receipt-total read path).
- Category grouping (needs a Bedrock `category` field + storage).
- Expiry / "use soon" (needs data not tracked).

## Components

### `packages/frontend/src/theme.ts` (new)
`createTheme({...})` with:
- custom `leaf` (green, primary, ~`#3E7C47`) and `terra` (terracotta, ~`#C4562F`)
  10-shade colors; `primaryColor: "leaf"`, `primaryShade: { light: 7, dark: 5 }`.
- `fontFamily: "'DM Sans', system-ui, sans-serif"`,
  `headings.fontFamily: "'Fraunces', Georgia, serif"`, `defaultRadius: "md"`.
- `other.mono: "'Space Mono', monospace"` (referenced by the receipt bits).

### `packages/frontend/src/theme.css` (new)
- Warm page background via `--mantine-color-body` (light `#F7F1E6`; a warm dark).
- Utility classes reused across screens: `.mono` (Space Mono), `.receipt-rule`
  (2px dashed divider), `.stamp` (rotated terracotta outline badge).

### `packages/frontend/src/main.tsx` (modify)
Import `@fontsource/dm-sans`, `@fontsource/fraunces`, `@fontsource/space-mono`
(specific weights), `./theme.css`, and the new `theme`; pass it to
`MantineProvider`. Keep the existing Amplify config and dark-scheme toggle.

### `packages/frontend/src/App.tsx` (modify)
Wordmark (Fraunces) in the header; Tabs restyled to pill style. Keep the
color-scheme toggle and sign-out.

### `packages/frontend/src/pages/Scan.tsx` + `input/ReceiptReview.tsx` (modify)
Apply the receipt signature to the review step: dashed `.receipt-rule` dividers,
mono raw line text + quantities, a `.stamp` "SCANNED"/AI badge, terracotta for
any total. Behavior unchanged (propose → review → commit).

### `packages/frontend/src/pages/Inventory.tsx` (modify)
Rework the read-only/plain table into the row list: a header row (Item / Qty /
Use-remove), each item a row with name + "added Xd ago" subtitle, a sans quantity
chip (warns when low), a **low** badge for quantity ≤ 1, hover highlight, and the
existing amount `NumberInput` + Use + Remove on the right. Add a `TextInput`
search and a sort control (recently used | name), filtering/sorting the items
array client-side. A small `relativeTime(iso)` helper renders "added Xd ago".

### `packages/frontend/src/pages/Recipes.tsx` + `recipes/CookRecipeModal.tsx` (modify)
Warm card styling, serif titles, have/missing badges, an "N/M on hand" count
(`usedIngredients.length` / `usedIngredients + missedIngredients`). "View recipe"
and "I cooked this" unchanged.

## Testing

The frontend has no test harness; verification is `pnpm --filter
@receipt-scanner/frontend build` (tsc + vite) passing, plus the two new deps
resolving. The `relativeTime` helper is kept a small pure function. No backend
tests change (nothing backend changes).

## Notes

- Fonts are self-hosted (`@fontsource`) rather than linked from Google, so there's
  no external request at runtime — friendlier for a future PWA and offline.
- Dark mode is preserved (Mantine toggle); the warm identity is primarily the
  light theme, with a warm-dark page background.
