import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb } from "../../../test/db";
import { ap, bahia, setSetting, setupAgenda } from "../../../test/agenda-fixtures";
import { db } from "../db";
import { agendaBlocks, professionals } from "../db/schema";
import { salonRange } from "../../lib/salon-period";
import { loadOcupacao } from "./ocupacao";

const RANGE = salonRange({ periodo: "livre", de: "2026-10-12", ate: "2026-10-18" }, bahia(15, 9)); // seg 12 a dom 18
const GESTAO = { perms: ["relatorios.ver", "relatorios.equipe", "valores.ver"] };
const SEM_VALORES = { perms: ["relatorios.ver", "relatorios.equipe"] };
const TER = "2026-10-13";

let s: Awaited<ReturnType<typeof setupAgenda>>;
const block = (over: Partial<typeof agendaBlocks.$inferInsert> = {}) =>
  db.insert(agendaBlocks).values({ professionalId: s.ana.id, title: "Almoço", startsOn: TER, endsOn: TER, startTime: "12:00", endTime: "13:00", externalKey: `b:${Math.random()}`, origin: "crm", ...over }).returning();

/** Ana trabalha só na terça, 9–18, com almoço 12–13; dois horários de 60 min (10h e 14h) e um que faltou (16h). Bia não trabalha. */
beforeEach(async () => {
  await resetDb();
  s = await setupAgenda();
  const off = { "0": null, "1": null, "2": [["09:00", "18:00"]], "3": null, "4": null, "5": null, "6": null };
  await db.update(professionals).set({ workHours: off as never }).where(eq(professionals.id, s.ana.id));
  await db.update(professionals).set({ workHours: { "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null } }).where(eq(professionals.id, s.bia.id));
  await block();
  await ap({ professionalId: s.ana.id, startsAt: bahia(13, 10), durationMin: 60, priceCents: 12000, status: "confirmado" });
  await ap({ professionalId: s.ana.id, startsAt: bahia(13, 14), durationMin: 60, priceCents: 9000 });
  await ap({ professionalId: s.ana.id, startsAt: bahia(13, 16), durationMin: 60, priceCents: 5000, status: "faltou" });
  await ap({ professionalId: s.ana.id, startsAt: bahia(13, 0), durationMin: 60, priceCents: 7000 }); // sem hora do Avec (00:00)
});

const ana = (v: Awaited<ReturnType<typeof loadOcupacao>>) => v.professionals.find((p) => p.id === s.ana.id)!;

it("grade conta 2 na terça às 10h e 14h; ocupação da Ana = 120/480 = 25%", async () => {
  const v = await loadOcupacao(GESTAO, RANGE, {});
  expect(v.grid[2][10]).toBe(1);
  expect(v.grid[2][14]).toBe(1);
  expect(v.grid.flat().reduce((a, b) => a + b, 0)).toBe(2); // faltou e 00:00 ficam fora
  expect(ana(v)).toMatchObject({ availableMin: 480, bookedMin: 120, pct: 25, days: 1 });
});

it("a folga do serviço entra no agendado; gêmeo do Avec e lista de espera não entram", async () => {
  const [twin] = await Promise.all([ap({ professionalId: s.ana.id, startsAt: bahia(13, 11), durationMin: 60 })]);
  await ap({ professionalId: s.ana.id, startsAt: bahia(13, 15), durationMin: 60, avecTwinOf: twin.id });
  await ap({ professionalId: s.ana.id, startsAt: bahia(13, 17), durationMin: 30, bufferMin: 15 });
  const v = await loadOcupacao(GESTAO, RANGE, {});
  expect(ana(v).bookedMin).toBe(120 + 60 + 45);
  expect(v.grid[2][15]).toBe(0);
});

it("sem valores.ver: medida 'valor' cai para 'horarios'; com a permissão, soma o preço", async () => {
  const sem = await loadOcupacao(SEM_VALORES, RANGE, { medida: "valor" });
  expect(sem.medida).toBe("horarios");
  expect(sem.money).toBe(false);
  expect(sem.grid[2][10]).toBe(1);
  const com = await loadOcupacao(GESTAO, RANGE, { medida: "valor" });
  expect(com.medida).toBe("valor");
  expect(com.grid[2][10]).toBe(12000);
  expect(com.grid[2][14]).toBe(9000);
});

it("filtro por profissional muda a grade, não a lista de ocupação", async () => {
  await ap({ professionalId: s.bia.id, startsAt: bahia(14, 11), durationMin: 60 });
  const todas = await loadOcupacao(GESTAO, RANGE, {});
  const soBia = await loadOcupacao(GESTAO, RANGE, { professionalId: s.bia.id });
  expect(todas.grid[3][11]).toBe(1);
  expect(soBia.professionalId).toBe(s.bia.id);
  expect(soBia.grid[2][10]).toBe(0);
  expect(soBia.grid[3][11]).toBe(1);
  expect(soBia.professionals.map((p) => p.id).sort()).toEqual(todas.professionals.map((p) => p.id).sort());
  expect(ana(soBia).bookedMin).toBe(120);
});

it("só a folga aprovada tira tempo: pedido e recusado não tiram, folga aprovada do dia inteiro zera", async () => {
  const [pedido] = await block({ title: "Folga", startTime: "09:00", endTime: "18:00", requestStatus: "pedido" });
  expect(ana(await loadOcupacao(GESTAO, RANGE, {})).availableMin).toBe(480);
  await db.update(agendaBlocks).set({ requestStatus: "recusado" }).where(eq(agendaBlocks.id, pedido.id));
  expect(ana(await loadOcupacao(GESTAO, RANGE, {})).availableMin).toBe(480);
  await db.update(agendaBlocks).set({ requestStatus: "aprovado" }).where(eq(agendaBlocks.id, pedido.id));
  const v = await loadOcupacao(GESTAO, RANGE, {});
  expect(ana(v)).toMatchObject({ availableMin: 0, bookedMin: 0, pct: null, days: 0 });
  await db.update(agendaBlocks).set({ requestStatus: "aprovado", deletedAt: new Date() }).where(eq(agendaBlocks.id, pedido.id));
  expect(ana(await loadOcupacao(GESTAO, RANGE, {})).availableMin).toBe(480); // bloqueio apagado não vale
});

it("ordena por ocupação do maior para o menor; quem não tem disponível (null) vai para o fim", async () => {
  const v = await loadOcupacao(GESTAO, RANGE, {});
  expect(v.professionals.map((p) => p.name)).toEqual(["Ana", "Bia"]);
  expect(v.professionals[1].pct).toBeNull();
});

it("desligar a Ocupação em Configurações recusa no servidor; sem canSeeSalon também", async () => {
  await setSetting("relatorios_config", { ocupacao: false });
  await expect(loadOcupacao(GESTAO, RANGE, {})).rejects.toThrow("Ocupação está desligada");
  await setSetting("relatorios_config", { ocupacao: true });
  await expect(loadOcupacao({ perms: ["relatorios.ver"] }, RANGE, {})).rejects.toThrow();
});
