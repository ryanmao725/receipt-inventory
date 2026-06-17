# Generic Receipt Input Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Scan page's "Choose receipt image" button with a unified area that accepts a receipt image via drag-and-drop, click-to-pick, and clipboard paste, alongside the existing "Use camera" button — all feeding the unchanged upload→scan pipeline.

**Architecture:** A new self-contained `ReceiptDropzone` wraps Mantine's `<Dropzone>` (drag/click) and installs a document-level paste listener, emitting a `File` via `onFile` and validation problems via `onError`. `Scan.tsx` swaps its `FileButton` for it and keeps orchestrating camera vs. input. No backend/API/infra changes.

**Tech Stack:** React 18, Mantine v7 (`@mantine/core@7.17.8` + new `@mantine/dropzone`), TypeScript ESM (`.js` import extensions), Vite. No frontend unit-test harness — the gate is a clean `pnpm --filter @receipt-scanner/frontend build`.

---

## File Structure

- **Create** `packages/frontend/src/input/ReceiptDropzone.tsx` — dropzone + paste; emits a `File`. Only this file knows about `@mantine/dropzone` / the paste event.
- **Modify** `packages/frontend/src/main.tsx` — import the Dropzone stylesheet.
- **Modify** `packages/frontend/src/pages/Scan.tsx` — render `ReceiptDropzone` instead of `FileButton`.
- **Modify** `packages/frontend/package.json` — add `@mantine/dropzone`.

---

## Task 1: `ReceiptDropzone` component (+ dependency + styles)

**Files:**
- Modify: `packages/frontend/package.json`
- Modify: `packages/frontend/src/main.tsx`
- Create: `packages/frontend/src/input/ReceiptDropzone.tsx`

No unit tests (no frontend harness); the gate is a clean build.

- [ ] **Step 1: Add the Dropzone dependency**

Run (from repo root `D:\dev\receipt-scanner`):
```bash
pnpm --filter @receipt-scanner/frontend add @mantine/dropzone@^7.17.0
```
Expected: `@mantine/dropzone` (a `7.17.x`) appears under `dependencies` in
`packages/frontend/package.json`; lockfile updates.

- [ ] **Step 2: Import the Dropzone stylesheet**

In `packages/frontend/src/main.tsx`, add the import immediately after the existing
`import "@mantine/core/styles.css";` line:
```ts
import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
```
(No other change to `main.tsx`.)

- [ ] **Step 3: Create the component**

Create `packages/frontend/src/input/ReceiptDropzone.tsx` with exactly this content:
```tsx
import { useEffect } from "react";
import { Dropzone, IMAGE_MIME_TYPE, type FileWithPath } from "@mantine/dropzone";
import { Group, Stack, Text } from "@mantine/core";

interface ReceiptDropzoneProps {
  onFile: (file: File) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

const MAX_SIZE = 10 * 1024 ** 2; // 10 MB

export default function ReceiptDropzone({
  onFile,
  onError,
  disabled = false,
}: ReceiptDropzoneProps) {
  // Clipboard paste: grab the first image pasted anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            onFile(file);
            return;
          }
        }
      }
      // A paste happened but carried no image (e.g. text).
      if (e.clipboardData && e.clipboardData.types.length > 0) {
        onError("Paste an image of a receipt.");
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onFile, onError, disabled]);

  return (
    <Dropzone
      onDrop={(files: FileWithPath[]) => {
        if (files[0]) onFile(files[0]);
      }}
      onReject={() => onError("That file isn't a supported image.")}
      accept={IMAGE_MIME_TYPE}
      maxSize={MAX_SIZE}
      loading={disabled}
      multiple={false}
    >
      <Group justify="center" mih={120} style={{ pointerEvents: "none" }}>
        <Stack gap={4} align="center">
          <Dropzone.Accept>
            <Text>Drop the image to scan it</Text>
          </Dropzone.Accept>
          <Dropzone.Reject>
            <Text c="red">That file isn't a supported image</Text>
          </Dropzone.Reject>
          <Dropzone.Idle>
            <Text>Drag a receipt image here, paste it, or click to choose</Text>
            <Text size="sm" c="dimmed">
              PNG or JPEG, up to 10 MB
            </Text>
          </Dropzone.Idle>
        </Stack>
      </Group>
    </Dropzone>
  );
}
```

Notes (already reflected above; do not change):
- The paste loop is index-based because `DataTransferItemList` is not iterable in
  the DOM lib types (a `for…of` would not type-check).
- `pointerEvents: "none"` on the inner `Group` lets clicks fall through to the
  Dropzone's own click-to-open handler.
- `multiple={false}` + `files[0]` enforce a single image.

- [ ] **Step 4: Verify the build**

Run:
```bash
pnpm --filter @receipt-scanner/frontend build
```
Expected: PASS — TypeScript type-check + Vite build succeed (the component
type-checks even though nothing imports it yet, because `tsc` compiles all of
`src`). No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/package.json packages/frontend/src/main.tsx packages/frontend/src/input/ReceiptDropzone.tsx pnpm-lock.yaml
git commit -m "feat(frontend): add ReceiptDropzone (drag/click/paste image input)"
```

---

## Task 2: Wire `ReceiptDropzone` into the Scan page

**Files:**
- Modify: `packages/frontend/src/pages/Scan.tsx`

- [ ] **Step 1: Replace `Scan.tsx`**

Replace the entire contents of `packages/frontend/src/pages/Scan.tsx` with:
```tsx
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { uploadReceipt } from "../api.js";
import CameraCapture from "../camera/CameraCapture.js";
import ReceiptDropzone from "../input/ReceiptDropzone.js";
import type { ScanReceiptResponse } from "@receipt-scanner/shared";

export default function Scan() {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ScanReceiptResponse | null>(null);
  const [mode, setMode] = useState<"idle" | "camera">("idle");

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

  const handleCapture = (file: File) => {
    setMode("idle");
    void handleFile(file);
  };

  return (
    <Stack>
      <Title order={2}>Scan a receipt</Title>
      {mode === "camera" ? (
        <CameraCapture onCapture={handleCapture} onClose={() => setMode("idle")} />
      ) : (
        <Stack>
          <Group>
            <Button onClick={() => setMode("camera")}>Use camera</Button>
            {status === "working" && <Loader size="sm" />}
          </Group>
          <ReceiptDropzone
            onFile={handleFile}
            onError={(m) => {
              setStatus("error");
              setMessage(m);
            }}
            disabled={status === "working"}
          />
        </Stack>
      )}
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

What changed vs. the current file (for reviewer awareness): removed the
`FileButton` import and the standalone "Choose receipt image" `FileButton`; added
the `ReceiptDropzone` import; wrapped the idle UI in a `Stack` with the
**Use camera** button + loader on top and `<ReceiptDropzone>` below. `handleFile`,
`handleCapture`, the camera branch, the result `Card`, and the status
`Alert`/`Text` are unchanged.

- [ ] **Step 2: Verify the build**

Run:
```bash
pnpm --filter @receipt-scanner/frontend build
```
Expected: PASS — no TypeScript/Vite errors (note `FileButton` is no longer
imported, so there must be no remaining reference to it).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/Scan.tsx
git commit -m "feat(frontend): use ReceiptDropzone on the Scan page (drag/click/paste)"
```

---

## Final verification

- [ ] **Clean build:**
```bash
pnpm --filter @receipt-scanner/frontend build
```
Expected: succeeds with no errors.

- [ ] **Manual checklist** (after deploy or via `pnpm --filter @receipt-scanner/frontend dev`):
  1. Copy a screenshot → on the Scan page press **Ctrl/Cmd+V** → it uploads and
     scans; result card appears.
  2. **Drag-and-drop** an image file onto the area → scans.
  3. **Click** the area → file picker → choose an image → scans.
  4. **Use camera** still captures and scans.
  5. Paste plain text, or drop a `.txt`/oversized file → the red error Alert shows
     and no scan runs.
  6. During a scan, the Dropzone shows its loading overlay and ignores new input.

Then hand off to `superpowers:finishing-a-development-branch`.
