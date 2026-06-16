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
