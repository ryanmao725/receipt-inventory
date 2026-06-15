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
import type { ScanReceiptResponse } from "@receipt-scanner/shared";

export default function Scan() {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ScanReceiptResponse | null>(null);

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

  return (
    <Stack>
      <Title order={2}>Scan a receipt</Title>
      <Group>
        <FileButton onChange={handleFile} accept="image/*">
          {(props) => <Button {...props}>Choose receipt image</Button>}
        </FileButton>
        {status === "working" && <Loader size="sm" />}
      </Group>
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
