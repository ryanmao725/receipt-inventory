import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { getInventory, consumeItem, removeItem } from "../api.js";
import type { InventoryItem } from "@receipt-scanner/shared";

/** "added 3 days ago" from an ISO timestamp. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "added today";
  if (days < 7) return `added ${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `added ${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `added ${months} month${months === 1 ? "" : "s"} ago`;
}

type Sort = "recent" | "name";

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");

  useEffect(() => {
    getInventory()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  const amountFor = (itemId: string) => amounts[itemId] ?? 1;

  const visible = useMemo(() => {
    const list = (items ?? []).filter((i) =>
      i.name.toLowerCase().includes(query.trim().toLowerCase()),
    );
    return list.sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [items, query, sort]);

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
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={2}>Inventory</Title>
        <Group gap="sm">
          <TextInput
            placeholder="Search items…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={180}
          />
          <SegmentedControl
            size="xs"
            value={sort}
            onChange={(v) => setSort(v as Sort)}
            data={[
              { label: "Recent", value: "recent" },
              { label: "Name", value: "name" },
            ]}
          />
        </Group>
      </Group>

      {error && <Alert color="red">{error}</Alert>}

      {items === null ? (
        <Loader size="sm" />
      ) : items.length === 0 ? (
        <Text c="dimmed">No items yet.</Text>
      ) : visible.length === 0 ? (
        <Text c="dimmed">No items match “{query}”.</Text>
      ) : (
        <Paper withBorder radius="md" p={0} style={{ overflow: "hidden" }}>
          <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Item</Table.Th>
                <Table.Th>Qty</Table.Th>
                <Table.Th ta="right">Use / remove</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map((i) => {
                const low = i.quantity <= 1;
                return (
                  <Table.Tr key={i.itemId}>
                    <Table.Td>
                      <Group gap="xs">
                        <Text fw={700}>{i.name}</Text>
                        {low && (
                          <Badge size="xs" color="terra" variant="light">
                            low
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {relativeTime(i.updatedAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={low ? "terra" : "leaf"}
                        size="lg"
                        radius="sm"
                      >
                        {i.quantity} {i.unit}
                        {i.quantity === 1 ? "" : "s"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <NumberInput
                          value={amountFor(i.itemId)}
                          min={1}
                          w={64}
                          size="xs"
                          onChange={(v) =>
                            setAmounts((a) => ({
                              ...a,
                              [i.itemId]: typeof v === "number" ? v : 1,
                            }))
                          }
                        />
                        <Button
                          size="xs"
                          loading={busy === i.itemId}
                          onClick={() => use(i)}
                        >
                          Use
                        </Button>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={`Remove ${i.name}`}
                          loading={busy === i.itemId}
                          onClick={() => remove(i)}
                        >
                          🗑
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
