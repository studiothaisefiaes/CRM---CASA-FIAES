import { beforeEach, expect, it } from "vitest";
import { db } from "../../db";
import { resetDb } from "../../../../test/db";
import { cliente } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { money } from "@/lib/format";
import { addCreditTx, creditBalance } from "./credits";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });

it("saldo = soma dos lançamentos; nunca fica negativo, nem com dois usos ao mesmo tempo", async () => {
  const p = await cliente("Paula Souza");
  await db.transaction((tx) => addCreditTx(tx, { contactId: p.contactId, deltaCents: 3000, reason: "troco" }, s.cati.id));
  expect(await creditBalance(p.contactId)).toBe(3000);
  await expect(db.transaction((tx) => addCreditTx(tx, { contactId: p.contactId, deltaCents: -5000, reason: "pagamento" }, s.cati.id, "Paula Souza")))
    .rejects.toThrow(`Saldo insuficiente: Paula tem ${money(3000)} de crédito.`);
  const use = () => db.transaction((tx) => addCreditTx(tx, { contactId: p.contactId, deltaCents: -2000, reason: "pagamento" }, s.cati.id, "Paula Souza"));
  const r = await Promise.allSettled([use(), use()]);
  expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(await creditBalance(p.contactId)).toBe(1000);
});
