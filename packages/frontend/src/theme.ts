import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Fresh-green primary — drives actions across the app.
const leaf: MantineColorsTuple = [
  "#eef6f0",
  "#dcebdf",
  "#b7d6bd",
  "#90c098",
  "#6fae79",
  "#59a364",
  "#4a9d57",
  "#3e7c47", // primaryShade (light)
  "#356b3d",
  "#295231",
];

// Terracotta — the receipt/money "signature" accent.
const terra: MantineColorsTuple = [
  "#fdefe8",
  "#f7dccf",
  "#eeb49c",
  "#e58e6d",
  "#de6f47",
  "#da5c30",
  "#c4562f", // signature shade
  "#a8471f",
  "#8a3a19",
  "#6f2f14",
];

export const theme = createTheme({
  primaryColor: "leaf",
  primaryShade: { light: 7, dark: 5 },
  colors: { leaf, terra },
  defaultRadius: "md",
  fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
  fontFamilyMonospace: "'Space Mono', ui-monospace, monospace",
  headings: { fontFamily: "'Fraunces', Georgia, serif", fontWeight: "600" },
});
