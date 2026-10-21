import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, isNull } from "drizzle-orm";
import { db } from "../db";
import { agendaBlocks, channels, outbox, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { isOpen } from "../../lib/business-hours";
import { recordInbound as recordInboundReal } from "./deals";
import { saveFuncao } from "./funcoes";
import { getBusinessHours, getWeekHours } from "./hours";
import { getSpecialDays, saveSpecialDays, specialDayText } from "./special-days";
import { saveSpecialDaysAction } from "../../app/(app)/config/etapas/actions";

const box = vi.hoisted(() => ({ allowed: true, asked: [] as string[], uid: "" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { box.asked.push(p); if (!box.allowed) throw new Error("Você não tem permissão para isso."); return { id: box.uid }; },
}));

const NOW = new Date("2026-12-10T15:00:00Z"); // quinta 12:00 em Salvador
const XMAS = Date.parse("2026-12-25T18:00:00Z"); // sexta 15:00 local, aberta pela semana
let uid = "", chId = "";
const liveBlocks = () => db.select().from(agendaBlocks).where(and(isNull(agendaBlocks.deletedAt)));
const setMode = (m: string) => db.insert(settings).values({ key: "agenda_modo", value: m }).onConflictDoUpdate({ target: settings.key, set: { value: m } });
const closed = (day: string, text: string | null = null) => ({ day, window: null, text });

beforeEach(async () => {
  box.allowed = true; box.asked.length = 0;
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  box.uid = uid;
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990505" }).returning();
  await setMode("dupla");
});

describe("Dias especiais: bloqueios da Agenda", () => {
  it("dia fechado cria um bloqueio Feriado da Casa inteira na Agenda; tirar o dia apaga o bloqueio", async () => {
    await saveSpecialDays([closed("2026-12-25")], uid, NOW);
    expect(await liveBlocks()).toEqual([expect.objectContaining({ professionalId: null, reason: "feriado", title: "Casa fechada", startsOn: "2026-12-25", endsOn: "2026-12-25", startTime: "00:00", endTime: "24:00", externalKey: "dia_especial:2026-12-25" })]);
    await saveSpecialDays([], uid, NOW);
    expect(await liveBlocks()).toEqual([]);
  });
  it("salvar de novo não duplica; voltar o dia depois de apagado recupera o bloqueio", async () => {
    await saveSpecialDays([closed("2026-12-25")], uid, NOW);
    await saveSpecialDays([closed("2026-12-25"), closed("2026-12-31")], uid, NOW);
    expect((await liveBlocks()).map((b) => b.externalKey).sort()).toEqual(["dia_especial:2026-12-25", "dia_especial:2026-12-31"]);
    await saveSpecialDays([], uid, NOW);
    await saveSpecialDays([closed("2026-12-25")], uid, NOW);
    expect((await liveBlocks()).map((b) => b.externalKey)).toEqual(["dia_especial:2026-12-25"]);
    expect(await db.select().from(agendaBlocks)).toHaveLength(2);
  });
  it("horário reduzido não cria bloqueio, e fechar o dia e depois reduzir apaga o bloqueio", async () => {
    await saveSpecialDays([{ day: "2026-12-24", window: ["08:00", "13:00"], text: null }], uid, NOW);
    expect(await liveBlocks()).toEqual([]);
    await saveSpecialDays([closed("2026-12-24")], uid, NOW);
    expect(await liveBlocks()).toHaveLength(1);
    await saveSpecialDays([{ day: "2026-12-24", window: ["08:00", "13:00"], text: null }], uid, NOW);
    expect(await liveBlocks()).toEqual([]);
  });
  it("na Agenda só consulta os dias valem, mas o bloqueio não é criado e o retorno avisa", async () => {
    await setMode("consulta");
    expect(await saveSpecialDays([closed("2026-12-25")], uid, NOW)).toEqual({ agenda: "consulta" });
    expect(await liveBlocks()).toEqual([]);
    expect(await getSpecialDays()).toHaveLength(1);
  });
});

describe("Dias especiais: validação", () => {
  it("data no passado ou repetida é recusada", async () => {
    await expect(saveSpecialDays([closed("2026-12-25"), { day: "2026-12-25", window: ["08:00", "12:00"], text: null }], uid, NOW)).rejects.toThrow("O dia 25/12 aparece duas vezes.");
    await expect(saveSpecialDays([closed("2026-10-17")], uid, NOW)).rejects.toThrow("O dia 17/10 já passou.");
    await expect(saveSpecialDays([{ day: "2026-12-25", window: ["13:00", "08:00"], text: null }], uid, NOW)).rejects.toThrow("No dia 25/12, a Casa precisa abrir antes de fechar.");
    await expect(saveSpecialDays([closed("2026-02-30")], uid, NOW)).rejects.toThrow("Confira a data de cada dia especial.");
    expect(await getSpecialDays()).toEqual([]);
  });
  it("o limite de dias à frente é um número editável (padrão 60)", async () => {
    await expect(saveSpecialDays([closed("2027-02-10")], uid, NOW)).rejects.toThrow("O dia 10/02 está longe demais: use até 60 dias à frente");
    await expect(saveSpecialDays([closed("2027-02-08")], uid, NOW)).resolves.toBeDefined(); // 60 dias
    await saveFuncao("dias_especiais", { params: { dias_a_frente: 7 } }, uid);
    await expect(saveSpecialDays([closed("2026-12-25")], uid, NOW)).rejects.toThrow("O dia 25/12 está longe demais: use até 7 dias à frente");
    await saveFuncao("dias_especiais", { params: { dias_a_frente: 366 } }, uid);
    await expect(saveSpecialDays([closed("2027-12-10")], uid, NOW)).resolves.toBeDefined();
    await expect(saveFuncao("dias_especiais", { params: { dias_a_frente: 3 } }, uid)).rejects.toThrow("Até quantos dias à frente: use um número de 7 a 366.");
  });
});

describe("Dias especiais: valem para o horário de todos", () => {
  it("getBusinessHours devolve a semana com os especiais; getWeekHours só a semana", async () => {
    await saveSpecialDays([closed("2026-12-25"), { day: "2026-12-24", window: ["08:00", "13:00"], text: null }], uid, NOW);
    const h = await getBusinessHours();
    expect(h.especiais).toEqual({ "2026-12-24": ["08:00", "13:00"], "2026-12-25": null });
    expect(h["5"]).toEqual(["08:00", "20:00"]);
    expect(isOpen(XMAS, h)).toBe(false);
    expect((await getWeekHours()).especiais).toBeUndefined();
  });
  it("sem dias especiais getBusinessHours é igual ao de antes (sem a chave)", async () => {
    expect((await getBusinessHours()).especiais).toBeUndefined();
  });
  it("função desligada: os dias especiais deixam de valer, salvar recusa e os bloqueios já criados ficam", async () => {
    await saveSpecialDays([closed("2026-12-25")], uid, NOW);
    await saveFuncao("dias_especiais", { on: false }, uid);
    const h = await getBusinessHours();
    expect(h.especiais).toBeUndefined();
    expect(isOpen(XMAS, h)).toBe(true);
    await expect(saveSpecialDays([], uid, NOW)).rejects.toThrow("Dias especiais está desligada em Configurações › Recursos.");
    expect(await liveBlocks()).toHaveLength(1);
    expect(await specialDayText(XMAS)).toBeNull();
  });
});

describe("Dias especiais: Resposta fora do horário", () => {
  const recordInbound = (i: Parameters<typeof recordInboundReal>[0]) => recordInboundReal({ now: i.at, ...i });
  it("usa o texto do dia especial quando ele tem texto; sem texto, o de sempre; num dia comum não responde", async () => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: "Oi! A Casa abre às 8h." } });
    await saveSpecialDays([closed("2026-12-25", "Feliz Natal! Voltamos no sábado."), closed("2026-12-31")], uid, NOW);
    expect(await specialDayText(XMAS)).toBe("Feliz Natal! Voltamos no sábado.");
    expect(await specialDayText(Date.parse("2026-12-31T18:00:00Z"))).toBeNull();
    await recordInbound({ channelId: chId, externalId: "n1", phoneRaw: "71999990301", body: "oi", at: new Date(XMAS) });
    expect((await db.select().from(outbox)).map((o) => o.text)).toEqual(["Feliz Natal! Voltamos no sábado."]);
    await recordInbound({ channelId: chId, externalId: "n2", phoneRaw: "71999990302", body: "oi", at: new Date("2026-12-31T18:00:00Z") });
    expect((await db.select().from(outbox)).map((o) => o.text)).toEqual(["Feliz Natal! Voltamos no sábado.", "Oi! A Casa abre às 8h."]);
    await recordInbound({ channelId: chId, externalId: "n3", phoneRaw: "71999990303", body: "oi", at: new Date("2026-12-23T18:00:00Z") }); // dia comum, aberto
    expect(await db.select().from(outbox)).toHaveLength(2);
  });
});

describe("Dias especiais: permissão horario.dias_especiais", () => {
  it("a ação exige a permissão no servidor: sem ela recusa e nada é gravado; com ela salva", async () => {
    await saveFuncao("dias_especiais", { params: { dias_a_frente: 366 } }, uid);
    box.allowed = false;
    expect(await saveSpecialDaysAction([closed("2027-01-05")])).toEqual({ ok: false, error: "Você não tem permissão para isso." });
    expect(await getSpecialDays()).toEqual([]);
    box.allowed = true;
    expect(await saveSpecialDaysAction([closed("2027-01-05")])).toMatchObject({ ok: true });
    expect(box.asked).toEqual(["horario.dias_especiais", "horario.dias_especiais"]);
    expect(await getSpecialDays()).toHaveLength(1);
  });
});
