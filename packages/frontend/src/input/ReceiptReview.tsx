import { useState } from "react";
import { Button, NumberInput, Stack, Switch, Table, Text, TextInput, Badge } from "@mantine/core";
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

  return (
    <Stack>
      <Text fw={600}>Review before adding to inventory</Text>
      <Table>
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
                <Text c="dimmed" size="sm">
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
                <Switch checked={r.keep} onChange={(e) => update(i, { keep: e.currentTarget.checked })} />
              </Table.Td>
              <Table.Td>
                <Badge variant="light" color={proposals[i].source === "cache" ? "gray" : "teal"}>
                  {proposals[i].source === "cache" ? "cached" : "AI"}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Button onClick={() => onCommit(rows)} loading={submitting}>
        Confirm &amp; add to inventory
      </Button>
    </Stack>
  );
}
