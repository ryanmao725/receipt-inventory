import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./inventory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory.js")>()),
  consumeItem: vi.fn(),
}));

import { route } from "./handler.js";
import { consumeItem } from "./inventory.js";

const mockConsume = vi.mocked(consumeItem);
const item = (quantity: number) => ({
  userId: "u",
  itemId: "lettuce",
  name: "lettuce",
  quantity,
  unit: "unit",
  sourceReceiptId: null,
  updatedAt: "t",
});

beforeEach(() => {
  mockConsume.mockReset();
});

describe("POST /inventory/{id}/consume", () => {
  const call = (body: unknown) =>
    route({
      method: "POST",
      path: "/inventory/lettuce/consume",
      userId: "u",
      body: JSON.stringify(body),
      pathParams: { id: "lettuce" },
    });

  it("returns 400 when amount is missing or non-positive", async () => {
    expect((await call({})).statusCode).toBe(400);
    expect((await call({ amount: 0 })).statusCode).toBe(400);
    expect((await call({ amount: -3 })).statusCode).toBe(400);
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it("returns 200 with the updated item", async () => {
    mockConsume.mockResolvedValue({ status: "updated", item: item(1) });
    const res = await call({ amount: 2 });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).item.quantity).toBe(1);
    expect(mockConsume).toHaveBeenCalledWith("u", "lettuce", 2);
  });

  it("returns 200 with item null when the item was removed", async () => {
    mockConsume.mockResolvedValue({ status: "removed" });
    const res = await call({ amount: 5 });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).item).toBeNull();
  });

  it("returns 404 when the item is not found", async () => {
    mockConsume.mockResolvedValue({ status: "not_found" });
    const res = await call({ amount: 1 });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /inventory/consume (batch)", () => {
  it("splits ingredients into used / removed / notFound and matches by slug", async () => {
    mockConsume.mockImplementation(async (_userId, itemId) => {
      if (itemId === "lettuce") return { status: "updated", item: item(1) };
      if (itemId === "olive-oil") return { status: "removed" };
      return { status: "not_found" };
    });
    const res = await route({
      method: "POST",
      path: "/inventory/consume",
      userId: "u",
      body: JSON.stringify({
        items: [
          { ingredient: "Lettuce", amount: 1 },
          { ingredient: "Olive Oil", amount: 2 },
          { ingredient: "Unicorn Horn", amount: 1 },
        ],
      }),
      pathParams: {},
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      used: ["Lettuce", "Olive Oil"],
      removed: ["Olive Oil"],
      notFound: ["Unicorn Horn"],
    });
  });

  it("skips malformed entries without failing", async () => {
    mockConsume.mockResolvedValue({ status: "updated", item: item(1) });
    const res = await route({
      method: "POST",
      path: "/inventory/consume",
      userId: "u",
      body: JSON.stringify({
        items: [
          { ingredient: "", amount: 1 },
          { ingredient: "Milk", amount: 0 },
          { ingredient: "Eggs", amount: 2 },
        ],
      }),
      pathParams: {},
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).used).toEqual(["Eggs"]);
    expect(mockConsume).toHaveBeenCalledTimes(1);
  });
});
