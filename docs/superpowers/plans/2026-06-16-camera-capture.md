# Browser Camera Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live in-browser camera (rear camera on phones, webcam on desktop) to the Scan page, with a review/confirm step, feeding the captured JPEG into the existing upload→scan pipeline; keep file upload as a fallback.

**Architecture:** A new self-contained `CameraCapture` component owns the `getUserMedia` lifecycle and a `live → review` state machine, handing back a `File` via `onCapture`. `Scan.tsx` becomes a thin orchestrator that offers "Use camera" vs "Upload image" and funnels both into the unchanged `uploadReceipt(file)`. No backend/API/infra changes.

**Tech Stack:** React 18, Mantine v7, TypeScript ESM (`.js` import extensions), Vite. No frontend unit-test harness — the verification gate is a clean `pnpm --filter @receipt-scanner/frontend build`.

---

## File Structure

- **Create** `packages/frontend/src/camera/CameraCapture.tsx` — camera lifecycle + capture/review UI; emits a `File`. Only this file touches `getUserMedia`/`canvas`.
- **Modify** `packages/frontend/src/pages/Scan.tsx` — add a `mode` toggle (idle/camera), render `CameraCapture` in camera mode, route the captured `File` into the existing `handleFile`.

---

## Task 1: `CameraCapture` component

**Files:**
- Create: `packages/frontend/src/camera/CameraCapture.tsx`

No unit tests (no frontend harness); the gate is a clean build.

- [ ] **Step 1: Create the component**

Create `packages/frontend/src/camera/CameraCapture.tsx` with exactly this content:
```tsx
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Image, Loader, Stack, Text } from "@mantine/core";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

type Phase = "starting" | "live" | "review" | "denied" | "unsupported";

export default function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedUrlRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("starting");
  const [captured, setCaptured] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState("");

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const revokeCaptured = () => {
    if (capturedUrlRef.current) {
      URL.revokeObjectURL(capturedUrlRef.current);
      capturedUrlRef.current = null;
    }
  };

  // Start the camera on mount; stop tracks + revoke URLs on unmount.
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase("unsupported");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPhase("live");
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setPhase(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unsupported");
      }
    }
    void start();
    return () => {
      cancelled = true;
      stopStream();
      revokeCaptured();
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Could not capture the photo. Try again.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Could not capture the photo. Try again.");
          return;
        }
        const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        capturedUrlRef.current = url;
        setCaptured({ file, url });
        setError("");
        setPhase("review");
      },
      "image/jpeg",
      0.9,
    );
  };

  const handleRetake = () => {
    revokeCaptured();
    setCaptured(null);
    setPhase("live");
  };

  const handleUse = () => {
    if (!captured) return;
    stopStream();
    onCapture(captured.file);
  };

  if (phase === "denied" || phase === "unsupported") {
    return (
      <Stack>
        <Alert color="red">
          {phase === "denied"
            ? "Camera permission was denied — you can upload an image instead."
            : "Camera isn't available on this device or browser — use Upload image instead."}
        </Alert>
        <Group>
          <Button variant="default" onClick={onClose}>
            Back
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack>
      {phase === "starting" && (
        <Group>
          <Loader size="sm" />
          <Text c="dimmed">Starting camera…</Text>
        </Group>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", borderRadius: 8, display: phase === "live" ? "block" : "none" }}
      />
      {phase === "review" && captured && (
        <Image src={captured.url} alt="Captured receipt" radius="sm" />
      )}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {error && <Alert color="red">{error}</Alert>}
      <Group>
        {phase === "live" && (
          <>
            <Button onClick={handleCapture}>Capture</Button>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
          </>
        )}
        {phase === "review" && (
          <>
            <Button onClick={handleUse}>Use this photo</Button>
            <Button variant="default" onClick={handleRetake}>
              Retake
            </Button>
          </>
        )}
      </Group>
    </Stack>
  );
}
```

Key correctness notes (already reflected above; do not change):
- The `<video>` is always mounted (hidden until `live`) so `videoRef.current` exists when `getUserMedia` resolves and `srcObject` can be set.
- `playsInline` is required for iOS Safari inline preview; `muted` avoids autoplay restrictions.
- The `cancelled` flag + cleanup stop tracks if the component unmounts mid-start (prevents a leaked stream / stuck camera light).

- [ ] **Step 2: Verify the build**

Run (from repo root `D:\dev\receipt-scanner`):
```bash
pnpm --filter @receipt-scanner/frontend build
```
Expected: PASS — TypeScript type-check + Vite build succeed, no errors. (If `tsc` complains that `playsInline`/`muted` are unknown, that would indicate a types problem — but React 18's `@types/react` includes both on `video` props, so it should compile cleanly.)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/camera/CameraCapture.tsx
git commit -m "feat(frontend): add CameraCapture component (live preview + review)"
```

---

## Task 2: Wire camera into the Scan page

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
  FileButton,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { uploadReceipt } from "../api.js";
import CameraCapture from "../camera/CameraCapture.js";
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
        <Group>
          <Button onClick={() => setMode("camera")}>Use camera</Button>
          <FileButton onChange={handleFile} accept="image/*">
            {(props) => (
              <Button variant="default" {...props}>
                Choose receipt image
              </Button>
            )}
          </FileButton>
          {status === "working" && <Loader size="sm" />}
        </Group>
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

What changed vs. the original (for reviewer awareness): added `mode` state, the `CameraCapture` import (`../camera/CameraCapture.js`), `handleCapture`, the "Use camera" button, and the camera-vs-actions conditional. The "Choose receipt image" button is now `variant="default"` (secondary) since "Use camera" is the primary CTA. The `handleFile`, result `Card`, status `Alert`/`Text`, and `uploadReceipt` flow are otherwise unchanged.

- [ ] **Step 2: Verify the build**

Run:
```bash
pnpm --filter @receipt-scanner/frontend build
```
Expected: PASS — no TypeScript/Vite errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/Scan.tsx
git commit -m "feat(frontend): offer camera capture on the Scan page with file fallback"
```

---

## Final verification

- [ ] **Clean build:**
```bash
pnpm --filter @receipt-scanner/frontend build
```
Expected: succeeds with no errors.

- [ ] **Manual checklist** (after deploy or via `pnpm --filter @receipt-scanner/frontend dev`, over https/localhost):
  1. **Use camera** → allow permission → live preview → **Capture** → **Use this photo** → receipt scans and the result card appears.
  2. **Retake** returns to live preview without re-prompting.
  3. On a phone, the rear camera is used and preview is inline (iOS).
  4. Deny permission → the "permission was denied" Alert appears; **Choose receipt image** still scans.
  5. After **Use this photo** / **Cancel/Back** / leaving the page, the camera indicator turns off.
  6. Existing file-upload path still works.

Then hand off to `superpowers:finishing-a-development-branch`.
