import { useState } from "react";
import { uploadReceipt } from "../api.js";
import type { ScanReceiptResponse } from "@receipt-scanner/shared";

export default function Scan() {
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<ScanReceiptResponse | null>(null);
  return (
    <section>
      <h2>Scan a receipt</h2>
      <input
        type="file"
        accept="image/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setStatus("Uploading and scanning…");
          setResult(null);
          try {
            const res = await uploadReceipt(file);
            setResult(res);
            setStatus(`Added ${res.addedItems.length} item(s) to inventory.`);
          } catch (err) {
            setStatus(err instanceof Error ? err.message : "Scan failed");
          }
        }}
      />
      <p>{status}</p>
      {result && (
        <div>
          <h3>
            {result.receipt.merchant} — ${result.receipt.total.toFixed(2)}
          </h3>
          <ul>
            {result.receipt.lineItems.map((li, i) => (
              <li key={i}>
                {li.quantity} × {li.name} — ${li.price.toFixed(2)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
