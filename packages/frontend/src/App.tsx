import { useState } from "react";
import { signOut } from "aws-amplify/auth";
import Scan from "./pages/Scan.js";
import Inventory from "./pages/Inventory.js";
import Recipes from "./pages/Recipes.js";

type Tab = "scan" | "inventory" | "recipes";

export default function App() {
  const [tab, setTab] = useState<Tab>("scan");
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 640, margin: "2rem auto" }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <h1 style={{ marginRight: "auto" }}>Receipt Scanner</h1>
        <button onClick={() => signOut()}>Sign out</button>
      </header>
      <nav style={{ display: "flex", gap: 8, margin: "1rem 0" }}>
        <button onClick={() => setTab("scan")}>Scan</button>
        <button onClick={() => setTab("inventory")}>Inventory</button>
        <button onClick={() => setTab("recipes")}>Recipes</button>
      </nav>
      {tab === "scan" && <Scan />}
      {tab === "inventory" && <Inventory />}
      {tab === "recipes" && <Recipes />}
    </main>
  );
}
