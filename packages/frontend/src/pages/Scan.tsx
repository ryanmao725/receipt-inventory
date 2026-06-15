import { useState } from "react";
import { uploadReceipt } from "../api.js";

export default function Scan() {
  const [status, setStatus] = useState("");
  return (
    <section>
      <h2>Scan a receipt</h2>
      <input
        type="file"
        accept="image/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setStatus("Uploading…");
          const res = await uploadReceipt(file);
          setStatus(res.ok ? "Uploaded" : `Error: ${res.status}`);
        }}
      />
      <p>{status}</p>
    </section>
  );
}
