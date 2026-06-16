# Browser Camera Capture Design

**Date:** 2026-06-16

## Goal

Let users photograph a receipt with a live in-browser camera (rear camera on
phones, webcam on desktop) instead of only picking an existing image file. The
captured photo flows into the existing scan pipeline unchanged. The current
file-upload path is kept as a fallback for when the camera is unavailable or
permission is denied.

## Context

- The Scan page (`packages/frontend/src/pages/Scan.tsx`) currently uses a Mantine
  `FileButton` (`accept="image/*"`) → `uploadReceipt(file)` in `api.ts`, which
  presigns an S3 URL, PUTs the file, then calls `POST /receipts` (Textract →
  parse → save → add inventory) and renders a result `Card`.
- `uploadReceipt(file: File)` already accepts any `File`, so a camera-captured
  JPEG `File` works with zero backend or API changes.
- Frontend is React 18 + Mantine v7, TypeScript ESM (`.js` import extensions).
  No frontend unit-test harness — the build is the verification gate.
- The app is served over HTTPS via CloudFront, satisfying the secure-context
  requirement of `getUserMedia`. `localhost` is also a secure context for dev.

## Architecture

### New component: `packages/frontend/src/camera/CameraCapture.tsx`

A self-contained Mantine component that owns the entire camera lifecycle and
hands back a `File` when the user confirms a photo. It does **not** call the API
— it only produces a `File` via a callback, keeping it decoupled and reusable.

**Props:**
```ts
interface CameraCaptureProps {
  onCapture: (file: File) => void; // user confirmed a captured photo
  onClose: () => void;             // user backed out of camera mode
}
```

**Internal state machine** (`useState` `phase`):
- `"starting"` — awaiting `getUserMedia`; show a `Loader`.
- `"live"` — stream attached to `<video>`; show preview + **Capture** button.
- `"review"` — a still was captured; show the image + **Retake** / **Use this photo**.
- `"denied"` — permission refused (`NotAllowedError`/`SecurityError`).
- `"unsupported"` — no `navigator.mediaDevices?.getUserMedia`, no camera
  (`NotFoundError`/`NotReadableError`/`OverconstrainedError`), or insecure context.

**Refs:** `videoRef` (`<video>`), `canvasRef` (offscreen `<canvas>`),
`streamRef` (the active `MediaStream`), and a `capturedUrlRef` for the review
object URL (so it can be revoked).

**Lifecycle / behavior:**
- On mount, if `navigator.mediaDevices?.getUserMedia` is missing → `unsupported`.
  Otherwise call
  `getUserMedia({ video: { facingMode: "environment" }, audio: false })`,
  assign the stream to `videoRef.current.srcObject`, store it in `streamRef`,
  set `phase = "live"`. On throw, map the error name to `denied` or `unsupported`.
- **Capture:** read the video's intrinsic size (`videoWidth`/`videoHeight`), size
  the canvas to match, `ctx.drawImage(video, 0, 0)`, then
  `canvas.toBlob(cb, "image/jpeg", 0.9)`. In the callback: if `blob` is null →
  set an error message, stay `live`; else build
  `new File([blob], \`receipt-${Date.now()}.jpg\`, { type: "image/jpeg" })`,
  create an object URL for preview, set `phase = "review"`. Keep the stream
  running (Retake returns to it without re-requesting).
- **Retake:** revoke the review object URL, clear the captured file, `phase = "live"`.
- **Use this photo:** stop the stream, then call `onCapture(file)`.
- **Stop the stream** (`streamRef.current?.getTracks().forEach(t => t.stop())`)
  on: Use-this-photo, `onClose`, and component unmount (cleanup in `useEffect`).
  Revoke any outstanding object URL on unmount too.
- `<video>` element rendered with `autoPlay playsInline muted` (`playsInline` is
  required for iOS Safari to preview inline rather than going fullscreen).

### `packages/frontend/src/pages/Scan.tsx` (orchestrator)

- Add a `mode` state: `"idle" | "camera"`.
- In `idle`: render two side-by-side actions in the existing `Group` — a
  **Use camera** `Button` (sets `mode = "camera"`) and the existing
  **Choose receipt image** `FileButton` (unchanged).
- In `camera`: render `<CameraCapture onCapture={...} onClose={() => setMode("idle")} />`.
  - `onCapture(file)` → `setMode("idle")` then the existing `handleFile(file)`
    (which sets `working`, calls `uploadReceipt`, renders result/error).
- The result `Card`, status `Alert`/`Text`, and `uploadReceipt` flow are unchanged.

## Data flow

`Scan` (mode=camera) → `CameraCapture` → `getUserMedia` stream → `<video>` live
preview → **Capture** → `<canvas>` → `toBlob` JPEG → `File` → review → **Use this
photo** → `onCapture(file)` → `Scan.handleFile(file)` → `uploadReceipt(file)`
(presign → S3 PUT → `POST /receipts`) → existing result `Card`.

## Error handling

- **Permission denied** (`NotAllowedError`/`SecurityError`) → `denied` phase: an
  `Alert color="red"` ("Camera permission was denied — you can upload an image
  instead.") plus a **Back** button to `onClose`. File upload remains available.
- **No camera / unsupported / insecure context** → `unsupported` phase: an
  `Alert` ("Camera isn't available on this device/browser — use Upload image.")
  plus **Back**.
- **`toBlob` returns null** → inline error text, remain in `live` so the user can
  retry Capture.
- **Scan/Textract failures** → handled by the existing `Scan.handleFile` catch
  (unchanged).

## Testing

- No frontend unit-test harness exists; the verification gate is
  `pnpm --filter @receipt-scanner/frontend build` (TypeScript type-check + Vite
  production build). A clean build is the pass condition.
- **Manual checklist (post-deploy / dev):**
  1. Desktop: **Use camera** → allow → live preview → **Capture** → **Use this
     photo** → receipt scans and the result card appears.
  2. **Retake** returns to live preview without re-prompting for permission.
  3. Mobile: rear camera is used; preview is inline (not fullscreen) on iOS.
  4. Deny permission → `denied` Alert shows; **Choose receipt image** still works.
  5. After **Use this photo** / **Back** / leaving the page, the camera
     indicator turns off (tracks stopped).
  6. Existing file-upload path still scans correctly.

## Out of scope (YAGNI)

- Front/back camera flip toggle, torch/flash, zoom controls.
- Image cropping, perspective correction, or auto-edge detection.
- Multi-page / multi-photo receipts.
- Any backend, API, or infra change (the existing `uploadReceipt` pipeline is
  reused as-is).
- A frontend test harness (build remains the gate, consistent with the rest of
  the frontend).
