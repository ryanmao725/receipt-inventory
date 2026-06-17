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
      let sawFile = false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file") continue;
        sawFile = true;
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            if (file.size > MAX_SIZE) {
              onError("That image is too large (max 10 MB).");
              return;
            }
            onFile(file);
            return;
          }
        }
      }
      // Only complain when a file was pasted that wasn't a usable image.
      // Pure-text pastes are ignored so we don't surface spurious errors.
      if (sawFile) {
        onError("Paste an image of a receipt.");
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onFile, onError, disabled]);

  return (
    <Dropzone
      onDrop={(files: FileWithPath[]) => {
        if (disabled) return;
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
