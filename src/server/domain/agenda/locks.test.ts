import { expect, it } from "vitest";
import { db } from "../../db";
import { agendaLockKeys, lockAgendaTx } from "./locks";

it("chaves em ordem, sem repetição; cliente e profissional por dia", () => {
  expect(agendaLockKeys({ professionalIds: ["b", "a", "a", null], contactId: "c", days: ["2026-10-16"] }))
    .toEqual(["agenda:cli:c:2026-10-16", "agenda:pro:a:2026-10-16", "agenda:pro:b:2026-10-16"]);
  expect(agendaLockKeys({ professionalIds: [], contactId: null, days: ["2026-10-16"] })).toEqual([]);
});

it("a segunda transação espera a primeira soltar a trava", async () => {
  const order: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  const input = { professionalIds: ["p-teste-trava"], contactId: null, days: ["2026-10-16"] };
  const first = db.transaction(async (tx) => { await lockAgendaTx(tx, input); order.push("1 travou"); await hold; order.push("1 soltou"); });
  await new Promise((r) => setTimeout(r, 80));
  const second = db.transaction(async (tx) => { await lockAgendaTx(tx, input); order.push("2 travou"); });
  await new Promise((r) => setTimeout(r, 150));
  expect(order).toEqual(["1 travou"]);
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(["1 travou", "1 soltou", "2 travou"]);
});
