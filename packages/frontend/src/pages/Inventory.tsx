import { useEffect, useState } from "react";
import { Loader, Stack, Table, Text, Title } from "@mantine/core";
import { getInventory } from "../api.js";
import type { InventoryItem } from "@receipt-scanner/shared";

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  useEffect(() => {
    getInventory()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  return (
    <Stack>
      <Title order={2}>Inventory</Title>
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
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((i) => (
              <Table.Tr key={i.itemId}>
                <Table.Td>{i.name}</Table.Td>
                <Table.Td>{i.quantity}</Table.Td>
                <Table.Td>{i.unit}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
