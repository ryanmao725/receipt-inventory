import { useState } from "react";
import { Button, Group, NumberInput, Paper, Stack, Switch, Table, Text, TextInput, Badge } from "@mantine/core";
import type { ProposedLine, ConfirmedLine } from "@receipt-scanner/shared";

interface Row extends ConfirmedLine {}

function toRow(p: ProposedLine): Row {
  return {
    rawName: p.rawName,
    canonicalName: p.canonicalName,
    quantity: p.quantity,
    unit: p.unit,
    price: p.price,
    keep: p.isFood, // non-food defaults to off
  };
}

export default function ReceiptReview({
  proposals,
  onCommit,
  submitting,
}: {
  proposals: ProposedLine[];
  onCommit: (items: ConfirmedLine[]) => void;
  submitting: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(proposals.map(toRow));

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const kept = rows.filter((r) => r.keep);
  const total = kept.reduce((sum, r) => sum + r.price, 0);

  return (
    <Stack>
      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" align="center">
          <Text className="app-mono" size="sm" c="dimmed" style={{ letterSpacing: 2 }}>
            ◆ REVIEW ◆
          </Text>
          <span className="receipt-stamp">SCANNED</span>
        </Group>
        <div className="receipt-rule" />
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>From receipt</Table.Th>
              <Table.Th>Ingredient</Table.Th>
              <Table.Th>Qty</Table.Th>
              <Table.Th>Keep</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <Text className="app-mono" c="dimmed" size="xs">
                    {r.rawName}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <TextInput
                    value={r.canonicalName}
                    onChange={(e) => update(i, { canonicalName: e.currentTarget.value })}
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    value={r.quantity}
                    min={0}
                    onChange={(v) => update(i, { quantity: typeof v === "number" ? v : 1 })}
                    w={80}
                  />
                </Table.Td>
                <Table.Td>
                  <Switch
                    checked={r.keep}
                    onChange={(e) => update(i, { keep: e.currentTarget.checked })}
                  />
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={proposals[i].source === "cache" ? "gray" : "leaf"}>
                    {proposals[i].source === "cache" ? "cached" : "AI"}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <div className="receipt-rule" />
        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed">
            {kept.length} item{kept.length === 1 ? "" : "s"} to add
          </Text>
          <Text className="app-mono" fw={700} c="terra.7">
            ${total.toFixed(2)}
          </Text>
        </Group>
      </Paper>
      <Button onClick={() => onCommit(rows)} loading={submitting}>
        Confirm &amp; add to inventory
      </Button>
    </Stack>
  );
}
