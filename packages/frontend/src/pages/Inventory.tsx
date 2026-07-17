import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, NumberInput, Stack, Table, Text, Title } from "@mantine/core";
import { getInventory, consumeItem, removeItem } from "../api.js";
import type { InventoryItem } from "@receipt-scanner/shared";

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getInventory()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  const amountFor = (itemId: string) => amounts[itemId] ?? 1;

  const use = async (item: InventoryItem) => {
    setError("");
    setBusy(item.itemId);
    try {
      const { item: updated } = await consumeItem(item.itemId, amountFor(item.itemId));
      setItems((cur) =>
        (cur ?? []).flatMap((i) =>
          i.itemId !== item.itemId ? [i] : updated ? [updated] : [],
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use item");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: InventoryItem) => {
    setError("");
    setBusy(item.itemId);
    try {
      await removeItem(item.itemId);
      setItems((cur) => (cur ?? []).filter((i) => i.itemId !== item.itemId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove item");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack>
      <Title order={2}>Inventory</Title>
      {error && <Alert color="red">{error}</Alert>}
      {items === null ? (
        <Loader size="sm" />
      ) : items.length === 0 ? (
        <Text c="dimmed">No items yet.</Text>
      ) : (
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Quantity</Table.Th>
              <Table.Th>Unit</Table.Th>
              <Table.Th>Use</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((i) => (
              <Table.Tr key={i.itemId}>
                <Table.Td>{i.name}</Table.Td>
                <Table.Td>{i.quantity}</Table.Td>
                <Table.Td>{i.unit}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <NumberInput
                      value={amountFor(i.itemId)}
                      min={1}
                      w={72}
                      onChange={(v) =>
                        setAmounts((a) => ({ ...a, [i.itemId]: typeof v === "number" ? v : 1 }))
                      }
                    />
                    <Button
                      size="xs"
                      variant="light"
                      loading={busy === i.itemId}
                      onClick={() => use(i)}
                    >
                      Use
                    </Button>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    loading={busy === i.itemId}
                    onClick={() => remove(i)}
                  >
                    Remove
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
