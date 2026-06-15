import { useEffect, useState } from "react";
import { getInventory } from "../api.js";
import type { InventoryItem } from "@receipt-scanner/shared";

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  useEffect(() => {
    getInventory().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  return (
    <section>
      <h2>Inventory</h2>
      <ul>
        {items.map((i) => (
          <li key={i.itemId}>{i.name} — {i.quantity} {i.unit}</li>
        ))}
      </ul>
    </section>
  );
}
