import { useState } from "react";
import { Alert, Button, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { proposeReceipt, commitReceipt } from "../api.js";
import CameraCapture from "../camera/CameraCapture.js";
import ReceiptDropzone from "../input/ReceiptDropzone.js";
import ReceiptReview from "../input/ReceiptReview.js";
import type { ConfirmedLine, ProposeReceiptResponse } from "@receipt-scanner/shared";

export default function Scan() {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<ProposeReceiptResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"idle" | "camera">("idle");

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setStatus("working");
    setMessage("Uploading and scanning…");
    setProposal(null);
    try {
      const res = await proposeReceipt(file);
      setProposal(res);
      setStatus("idle");
      setMessage(res.proposals.length === 0 ? "No line items found." : "");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Scan failed");
    }
  };

  const handleCommit = async (items: ConfirmedLine[]) => {
    if (!proposal) return;
    setSubmitting(true);
    try {
      const res = await commitReceipt({ imageS3Key: proposal.imageS3Key, items });
      setProposal(null);
      setMessage(`Added ${res.addedItems.length} item(s) to inventory.`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setSubmitting(false);
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
      {proposal && proposal.proposals.length > 0 && (
        <ReceiptReview proposals={proposal.proposals} onCommit={handleCommit} submitting={submitting} />
      )}
    </Stack>
  );
}
