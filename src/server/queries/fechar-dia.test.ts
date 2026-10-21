import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { comandaItems, comandas } from "../db/schema";
import { resetDb } from "../../../test/db";
import { ap, bahia, cliente, setSetting } from "../../../test/agenda-fixtures";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { item } from "../../../test/salon-fixtures";
import { openCash } from "../domain/caixa/cash";
import { cashStep, noOutcomeToday, openComandasUntil } from "./fechar-dia";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });
const FIM_DO_DIA = bahia(15, 18);

describe("Fechar o dia › horários sem desfecho", () => {
  it("horário do Avec que já acabou e segue agendado; com comanda do Avec no dia, a sugestão é Compareceu", async () => {
    const paula = await cliente("Paula Souza");
    const a = await ap({ startsAt: bahia(15, 10), contactId: paula.contactId, professionalId: s.ana.id });
    const b = await ap({ startsAt: bahia(15, 11), clientName: "Rita Lima" });
    await item({ day: "2026-10-15", clientName: "RITA LIMA", value: 9000 });
    const rows = await noOutcomeToday(FIM_DO_DIA);
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
    expect(rows[0]).toMatchObject({ clientName: "Paula Souza", professional: "Ana", service: "Corte", status: "agendado", avec: { status: "aberto", why: "status" }, suggest: null });
    expect(rows[1]).toMatchObject({ avec: { status: "compareceu", why: "comanda" }, suggest: "compareceu" });
  });

  it("homônima: comanda do Avec de outra cliente com o mesmo nome não vira 'veio' para quem tem contato", async () => {
    const paula = await cliente("Paula Souza");
    const outra = await cliente("Paula Souza");
    await ap({ startsAt: bahia(15, 10), contactId: paula.contactId });
    await item({ day: "2026-10-15", clientName: "Paula Souza", contactId: outra.contactId, value: 9000 });
    const [r] = await noOutcomeToday(FIM_DO_DIA);
    expect(r).toMatchObject({ avec: { status: "aberto", why: "status" }, suggest: null });
  });

  it("mexido no CRM com o Avec dizendo faltou; gêmeo do Avec cancelado; o gêmeo não vira linha", async () => {
    const x = await ap({ startsAt: bahia(15, 10), crmTouchedAt: bahia(15, 9), avecStatus: "faltou", status: "confirmado" });
    const y = await ap({ startsAt: bahia(15, 12), origin: "crm", status: "agendado" });
    await ap({ startsAt: bahia(15, 12), status: "cancelado", avecTwinOf: y.id });
    const rows = await noOutcomeToday(FIM_DO_DIA);
    expect(rows.map((r) => r.id)).toEqual([x.id, y.id]);
    expect(rows[0]).toMatchObject({ avec: { status: "faltou", why: "status" }, suggest: "faltou" });
    expect(rows[1]).toMatchObject({ avec: { status: "cancelado", why: "status" }, suggest: null });
  });

  it("fora: ainda dentro da duração, já com desfecho, lista de espera, ontem e só do CRM sem par mostra avec null", async () => {
    await ap({ startsAt: bahia(15, 17, 30) });                    // 17h30 + 60 min: ainda não acabou às 18h
    await ap({ startsAt: bahia(15, 10), status: "compareceu" });
    await ap({ startsAt: bahia(15, 10), status: "faltou" });
    await ap({ startsAt: bahia(15, 0), status: "espera" });
    await ap({ startsAt: bahia(14, 10) });
    const crm = await ap({ startsAt: bahia(15, 9), origin: "crm", status: "chegou", durationMin: null });
    const rows = await noOutcomeToday(FIM_DO_DIA);
    expect(rows).toEqual([expect.objectContaining({ id: crm.id, avec: null, suggest: null })]);
  });
});

describe("Fechar o dia › comandas abertas e caixa", () => {
  it("abertas até hoje, a mais antiga primeiro; fechada não entra; a vazia nunca vira pendência (QA r58, I-8)", async () => {
    const [old] = await db.insert(comandas).values({ day: "2026-10-14", number: 3, status: "aberta", openedBy: s.cati.id, clientName: "Bia" }).returning();
    const [hoje] = await db.insert(comandas).values({ day: "2026-10-15", number: 1, status: "aberta", openedBy: s.cati.id, clientName: "Ana" }).returning();
    await db.insert(comandaItems).values([{ comandaId: old.id, kind: "produto", label: "Kit", unitCents: 4000, addedBy: s.cati.id },
      { comandaId: hoje.id, kind: "produto", label: "Kit", unitCents: 1000, addedBy: s.cati.id }]);
    await db.insert(comandas).values({ day: "2026-10-15", number: 2, status: "fechada", openedBy: s.cati.id });
    await db.insert(comandas).values({ day: "2026-10-15", number: 4, status: "aberta", openedBy: s.cati.id, clientName: "Cliente de balcão" }); // vazia
    await db.insert(comandas).values({ day: "2026-10-16", number: 1, status: "aberta", openedBy: s.cati.id });
    const rows = await openComandasUntil("2026-10-15");
    expect(rows.map((r) => r.id)).toEqual([old.id, hoje.id]);
    expect(rows[0]).toMatchObject({ day: "2026-10-14", number: 3, clientName: "Bia", itens: 1, totalCents: 4000, paidCents: 0 });
    const cx = await openCash({ openingCents: 0 }, s.caixaRecepcao, bahia(15, 9));
    expect(await cashStep(s.caixaRecepcao)).toMatchObject({ open: { id: cx.id, openComandas: 2 } }); // as duas com item; as vazias não contam
  });

  it("caixa: Avec, CRM sem caixa e CRM com o caixa da própria pessoa (sem o esperado, por causa da contagem cega)", async () => {
    expect(await cashStep(s.caixaRecepcao)).toEqual({ mode: "crm", open: null, team: [], canGerir: false });
    const cx = await openCash({ openingCents: 10000 }, s.caixaRecepcao, bahia(15, 9));
    await db.insert(comandas).values({ day: "2026-10-15", number: 1, status: "aberta", openedBy: s.cati.id });
    await db.insert(comandaItems).values({ comandaId: (await db.select().from(comandas))[0].id, kind: "produto", label: "Kit", unitCents: 1000, addedBy: s.cati.id });
    const mine = await cashStep(s.caixaRecepcao);
    expect(mine).toEqual({ mode: "crm", open: { id: cx.id, openedByName: "Cati", openedAt: bahia(15, 9).toISOString(), openComandas: 1, blind: true, expected: null, byBrand: [] }, team: [], canGerir: false });
    await setSetting("caixa_modo", "avec");
    expect(await cashStep(s.caixaRecepcao)).toEqual({ mode: "avec" });
  });

  it("gestão (QA r58, I-3): vê os caixas abertos da equipe, com quem abriu e desde quando, além do próprio", async () => {
    const cx = await openCash({ openingCents: 10000 }, s.caixaRecepcao, bahia(15, 9));
    const g = await cashStep(s.caixaGestao);
    expect(g).toMatchObject({ mode: "crm", open: null, team: [expect.objectContaining({ id: cx.id, personName: "Cati", openedAt: bahia(15, 9).toISOString(), status: "aberto" })] });
    const meu = await openCash({ openingCents: 0 }, s.caixaGestao, bahia(15, 10));
    const g2 = await cashStep(s.caixaGestao);
    expect(g2).toMatchObject({ open: { id: meu.id }, team: [expect.objectContaining({ id: cx.id })] }); // o próprio fica fora da lista da equipe
    expect(await cashStep(s.caixaRecepcao)).toMatchObject({ team: [] }); // a equipe não vê o caixa das colegas
  });
});
