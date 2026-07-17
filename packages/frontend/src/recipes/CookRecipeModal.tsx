import { useState } from "react";
import { Button, Group, Modal, NumberInput, Stack, Switch, Table, Text } from "@mantine/core";
import { cookRecipe } from "../api.js";
import type { ConsumeIngredientsResponse } from "@receipt-scanner/shared";

interface Row {
  ingredient: string;
  amount: number;
  keep: boolean;
}

/** Summarizes the batch-consume result into a single human-readable line. */
export function summarize(result: ConsumeIngredientsResponse): string {
  if (result.used.length === 0 && result.notFound.length === 0) {
    return "Nothing was deducted.";
  }
  const parts = [`Used ${result.used.length} ingredient${result.used.length === 1 ? "" : "s"}`];
  if (result.notFound.length > 0) {
    parts.push(`${result.notFound.length} wasn't in your inventory`);
  }
  return `${parts.join(" — ")}.`;
}

export default function CookRecipeModal({
  title,
  usedIngredients,
  opened,
  onClose,
  onDone,
}: {
  title: string;
  usedIngredients: string[];
  opened: boolean;
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>(
    usedIngredients.map((ingredient) => ({ ingredient, amount: 1, keep: true })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const confirm = async () => {
    setError("");
    setBusy(true);
    try {
      const items = rows
        .filter((r) => r.keep && r.amount > 0)
        .map((r) => ({ ingredient: r.ingredient, amount: r.amount }));
      const result = await cookRecipe(items);
      onDone(summarize(result));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update inventory");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`I cooked: ${title}`} centered>
      <Stack>
        <Text size="sm" c="dimmed">
          Deduct these ingredients from your inventory.
        </Text>
        <Table>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={i}>
                <Table.Td>{r.ingredient}</Table.Td>
                <Table.Td>
                  <NumberInput
                    value={r.amount}
                    min={1}
                    w={72}
                    disabled={!r.keep}
                    onChange={(v) => update(i, { amount: typeof v === "number" ? v : 1 })}
                  />
                </Table.Td>
                <Table.Td>
                  <Switch
                    checked={r.keep}
                    onChange={(e) => update(i, { keep: e.currentTarget.checked })}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={confirm}>
            Deduct from inventory
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
