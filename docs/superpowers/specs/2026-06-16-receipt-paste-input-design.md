# Generic Receipt Input Area Design

**Date:** 2026-06-16

## Goal

Replace the standalone "Choose receipt image" file button on the Scan page with a
unified input area that accepts a receipt image via **drag-and-drop**, **click to
pick**, and **clipboard paste** (Ctrl/Cmd+V), alongside the existing **Use
camera** button. All sources feed the existing upload→scan pipeline unchanged.

## Context

- The Scan page (`packages/frontend/src/pages/Scan.tsx`) currently has a
  "Use camera" `Button` (renders `CameraCapture`) and a Mantine `FileButton`
  "Choose receipt image", both calling `handleFile(file)` →
  `uploadReceipt(file)` in `api.ts` (presign → S3 PUT → `POST /receipts`).
- `uploadReceipt(file: File)` accepts any `File`/blob and only uses its bytes
  (the S3 PUT body), so a pasted/dropped image works with no backend/API change.
- Frontend is React 18 + Mantine v7 (`@mantine/core@7.17.8`), TypeScript ESM
  (`.js` import extensions). No frontend unit-test harness — the build is the
  verification gate.
- `main.tsx` imports `@mantine/core/styles.css` and wraps the app in
  `MantineProvider` (teal theme).

## Architecture

### New component: `packages/frontend/src/input/ReceiptDropzone.tsx`

A self-contained component that handles drag-and-drop, click-to-pick, and
clipboard paste, emitting a single `File`. It does **not** call the API and does
**not** know about the camera — keeping it decoupled and reusable.

**Props:**
```ts
interface ReceiptDropzoneProps {
  onFile: (file: File) => void;   // a valid image was provided
  onError: (message: string) => void; // wrong type / too large / non-image paste
  disabled?: boolean;             // a scan is in flight; ignore new input
}
```

**Dropzone:** render Mantine `<Dropzone>` from `@mantine/dropzone`:
- `accept={IMAGE_MIME_TYPE}` (Mantine's exported image MIME list).
- `maxSize={10 * 1024 ** 2}` (10 MB — comfortably covers phone photos).
- `loading={disabled}` (Dropzone shows its overlay while a scan runs).
- `onDrop={(files) => { if (files[0]) onFile(files[0]); }}`.
- `onReject={() => onError("That file isn't a supported image.")}`.
- Content: a `Dropzone.Idle` / `Dropzone.Accept` / `Dropzone.Reject` group with
  a short instruction `Text` — e.g. "Drag a receipt image here, paste it, or
  click to choose" plus a dimmed hint "PNG or JPEG, up to 10 MB".

**Paste:** a `useEffect` installs a `document` `"paste"` listener:
```ts
useEffect(() => {
  const onPaste = (e: ClipboardEvent) => {
    if (disabled) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          onFile(file);
          return;
        }
      }
    }
    // Paste happened but contained no image (e.g. text).
    if (e.clipboardData && e.clipboardData.types.length > 0) {
      onError("Paste an image of a receipt.");
    }
  };
  document.addEventListener("paste", onPaste);
  return () => document.removeEventListener("paste", onPaste);
}, [onFile, onError, disabled]);
```
- Clipboard images arrive as a `File` with a generic name (e.g. `image.png`);
  `uploadReceipt` ignores the name, so that is fine.
- The listener is `document`-level so a paste anywhere on the Scan page is
  captured. The Scan page has no text inputs, so this does not interfere with
  typing. It is inert while `disabled` and removed on unmount.

### `packages/frontend/src/pages/Scan.tsx` (orchestrator)

- In idle mode (`mode !== "camera"`): render `<ReceiptDropzone>` and keep the
  **Use camera** `Button` above it.
  - `onFile={handleFile}` (existing handler, unchanged).
  - `onError={(m) => { setStatus("error"); setMessage(m); }}`.
  - `disabled={status === "working"}`.
- Remove the standalone `FileButton` "Choose receipt image" (its job — click to
  pick — is now covered by the Dropzone).
- Camera mode, `handleFile`, `handleCapture`, the result `Card`, and the status
  `Alert`/`Text` are unchanged.

### `packages/frontend/src/main.tsx`

- Add `import "@mantine/dropzone/styles.css";` immediately after the existing
  `import "@mantine/core/styles.css";` (Dropzone requires its stylesheet).

### Dependency

- Add `@mantine/dropzone` pinned to the v7 line (matching `@mantine/core@7.17.8`,
  e.g. `^7.17.0`) so it stays React 18 compatible. It is bundled by Vite into the
  frontend build.

## Data flow

drop / click / paste → `ReceiptDropzone` → `onFile(file)` → `Scan.handleFile` →
`uploadReceipt(file)` (presign → S3 PUT → `POST /receipts`) → existing result
`Card`. Camera path unchanged: `CameraCapture` → `onCapture` →
`Scan.handleCapture` → `handleFile`.

## Error handling

- Unsupported type or over `maxSize` → Dropzone `onReject` → `onError` → the
  existing red `Alert`.
- Paste containing no image (e.g. text) → `onError("Paste an image of a
  receipt.")`.
- Upload / Textract failures → handled by the existing `Scan.handleFile` catch
  (unchanged).

## Testing

- No frontend unit-test harness; the gate is
  `pnpm --filter @receipt-scanner/frontend build` (TypeScript type-check + Vite
  build). A clean build is the pass condition.
- **Manual checklist (dev or post-deploy):**
  1. Copy an image (e.g. a screenshot) → focus the Scan page → **paste** → it
     uploads and scans, result card appears.
  2. **Drag-and-drop** an image file onto the area → scans.
  3. **Click** the area → file picker → choose an image → scans.
  4. **Use camera** still captures and scans.
  5. Paste plain text, or drop a `.txt`/oversized file → the red error Alert
     shows and no scan runs.
  6. While a scan is in flight, the Dropzone shows its loading overlay and new
     input is ignored.

## Out of scope (YAGNI)

- Multi-file / batch upload (take the first image only).
- Pasting an image *URL* (only raw clipboard image data is handled).
- Image cropping or editing.
- Any backend, API, or infra change (the existing `uploadReceipt` pipeline is
  reused as-is).
- A frontend test harness (build remains the gate).
