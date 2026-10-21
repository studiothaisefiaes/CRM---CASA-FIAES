import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, campaignRecipients, campaigns, channels, contacts, deals, messages, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { cancelCampaign, confirmCampaign, createCampaign, drainCampaigns, pauseCampaign, previewAudience, saveMassSettings } from "./campaigns";

const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN };
const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);
let gestao = "";
let actor: { id: string; perms: string[] } = { id: "", perms: [] };
const sent: { phone: string; text: string }[] = [];
let failSend = false;
const sender = async (i: { instance: string; phone: string; text: string }) => {
  if (failSend) throw new Error("Evolution recusou");
  sent.push({ phone: i.phone, text: i.text });
  return { externalId: `MASS${sent.length}` };
};
/** Contato que já escreveu para a Casa e não tem conversa aberta: pode receber. */
async function wrote(name: string, phone: string) {
  const [c] = await db.insert(contacts).values({ name, phoneE164: phone }).returning();
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "text", body: "oi", status: "received", createdAt: new Date("2026-09-01T13:00:00Z") });
  return c.id;
}
async function ready(ids: string[], interval = 180) {
  const { id } = await createCampaign({ name: "Retorno", body: "{saudacao}, {primeiro_nome}! Sentimos sua falta.", audience: { contactIds: ids }, intervalSeconds: interval }, actor, T0);
  await confirmCampaign(id, { typedTotal: ids.length, acceptRisk: true }, actor, T0);
  return id;
}
const recips = async (id: string) => db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));

beforeEach(async () => {
  sent.length = 0; failSend = false;
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: gestao }] = await db.insert(users).values({ name: "Thaíse Teste", email: "gestao@teste.local", role: "gestor", passwordHash: "x" }).returning();
  actor = { id: gestao, perms: ["mensagem.massa"] };
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" });
});

describe("mensagem em massa", () => {
  it("nasce desligada: sem a chave ninguém monta; sem a permissão também", async () => {
    const a = await wrote("Ana Teste", "+5571999990071");
    await expect(createCampaign({ name: "Retorno", body: "Oi!", audience: { contactIds: [a] } }, actor, T0)).rejects.toThrow(/desligada em Configurações/);
    await saveMassSettings({ enabled: true }, gestao);
    await expect(createCampaign({ name: "Retorno", body: "Oi!", audience: { contactIds: [a] } }, { id: gestao, perms: [] }, T0)).rejects.toThrow(/não tem permissão/);
    expect(await db.select().from(campaigns)).toHaveLength(0);
  });

  it("prévia: quem recebe e quem fica de fora, com o motivo", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const ok = await wrote("Ana Teste", "+5571999990071");
    const ign = await wrote("Bia Teste", "+5571999990072");
    await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, ign));
    const [hid] = await db.insert(contacts).values({ name: "Oculta Teste", phoneE164: "lid:123456" }).returning();
    await recordInbound({ channelId: null, externalId: "O1", phoneRaw: "71999990074", pushName: "Carla Teste", body: "oi" });
    const open = (await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999990074")))[0].id;
    const recent = await wrote("Dani Teste", "+5571999990075");
    const [old] = await db.insert(campaigns).values({ name: "Anterior", body: "x", status: "concluida", total: 1, createdBy: gestao }).returning();
    await db.insert(campaignRecipients).values({ campaignId: old.id, contactId: recent, status: "enviada", sentAt: plus(-3 * 24 * 60) });
    const [never] = await db.insert(contacts).values({ name: "Eva Teste", phoneE164: "+5571999990076" }).returning();
    const p = await previewAudience({ contactIds: [ok, ign, hid.id, open, recent, never.id] }, T0);
    expect(p.eligible).toBe(1);
    expect(Object.fromEntries(p.excluded.map((e) => [e.reason, e.n]))).toEqual({ nao_e_cliente: 1, numero_oculto: 1, conversa_aberta: 1, recebeu_recente: 1, nunca_escreveu: 1 });
  });

  it("confirmação dupla: aceitar o risco e digitar o total certo", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const a = await wrote("Ana Teste", "+5571999990071");
    const b = await wrote("Bia Teste", "+5571999990072");
    const { id, total } = await createCampaign({ name: "Retorno", body: "Oi, {primeiro_nome}!", audience: { contactIds: [a, b] } }, actor, T0);
    expect(total).toBe(2);
    expect((await db.select().from(campaigns))[0].status).toBe("rascunho");
    await expect(confirmCampaign(id, { typedTotal: 2, acceptRisk: false }, actor, T0)).rejects.toThrow(/risco de bloqueio/);
    await expect(confirmCampaign(id, { typedTotal: 3, acceptRisk: true }, actor, T0)).rejects.toThrow("Digite 2");
    expect((await confirmCampaign(id, { typedTotal: 2, acceptRisk: true }, actor, T0)).startAt).toEqual(T0);
    expect((await db.select().from(campaigns))[0]).toMatchObject({ status: "agendada", confirmedBy: gestao });
  });

  it("recusa: intervalo menor que 2 min, variável de horário e mais de 300 contatos", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const a = await wrote("Ana Teste", "+5571999990071");
    await expect(createCampaign({ name: "x", body: "Oi", audience: { contactIds: [a] }, intervalSeconds: 60 }, actor, T0)).rejects.toThrow(/mínimo entre uma mensagem e outra é de 2 minutos/);
    await expect(createCampaign({ name: "x", body: "Seu horário: {data_horario}", audience: { contactIds: [a] } }, actor, T0)).rejects.toThrow(/só vale \{primeiro_nome\}/);
    const many = await db.insert(contacts).values(Array.from({ length: 301 }, (_, i) => ({ name: `Teste ${i}`, phoneE164: `+5571990${String(100000 + i)}` }))).returning({ id: contacts.id });
    await db.insert(messages).values(many.map((c) => ({ contactId: c.id, direction: "in" as const, kind: "text", body: "oi", status: "received" })));
    await expect(createCampaign({ name: "x", body: "Oi", audience: { contactIds: many.map((c) => c.id) } }, actor, T0)).rejects.toThrow(/No máximo 300/);
  });

  it("manda uma por rodada, só com a Casa aberta e respeitando o intervalo; grava na conversa e abre em Aguardando cliente", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    await ready([await wrote("Ana Teste", "+5571999990071"), await wrote("Bia Teste", "+5571999990072")]);
    expect((await drainCampaigns(new Date("2026-10-19T13:00:00Z"), sender)).waiting).toBe("casa_fechada"); // segunda
    expect((await drainCampaigns(T0, sender)).sent).toBe(1);
    expect((await drainCampaigns(plus(1), sender)).waiting).toBe("intervalo");
    expect((await drainCampaigns(plus(3), sender)).sent).toBe(1);
    expect(sent.map((s) => s.text).sort()).toEqual(["Bom dia, Ana! Sentimos sua falta.", "Bom dia, Bia! Sentimos sua falta."]);
    const out = (await db.select().from(messages)).filter((m) => m.direction === "out");
    expect(out).toHaveLength(2);
    // Sem autora (mensagem automática da Casa); a conversa abre em Aguardando cliente com o convite (campaigns-retorno.test).
    expect(out.every((m) => m.dealId !== null && m.sentByUserId === null && m.status === "sent")).toBe(true);
    expect(await db.select().from(deals)).toHaveLength(2);
  });

  it("chave desligada no meio: a rodada seguinte não manda nada", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    await ready([await wrote("Ana Teste", "+5571999990071"), await wrote("Bia Teste", "+5571999990072")]);
    expect((await drainCampaigns(T0, sender)).sent).toBe(1);
    await saveMassSettings({ enabled: false }, gestao);
    expect(await drainCampaigns(plus(5), sender)).toMatchObject({ sent: 0, waiting: "desligada" });
    expect(sent).toHaveLength(1);
  });

  it("quem começou a conversar depois de montar a lista é pulada", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const id = await ready([await wrote("Ana Teste", "+5571999990071")]);
    await recordInbound({ channelId: null, externalId: "N9", phoneRaw: "71999990071", body: "Oi, quero marcar", at: plus(1) });
    expect((await drainCampaigns(plus(2), sender)).skipped).toBe(1);
    expect(sent).toHaveLength(0);
    expect((await recips(id))[0]).toMatchObject({ status: "pulada", sentAt: null });
    expect((await recips(id))[0].error).toContain("conversa aberta");
  });

  it("WhatsApp recusou: fica “falhou” e não tenta de novo", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const id = await ready([await wrote("Ana Teste", "+5571999990071")]);
    failSend = true;
    expect((await drainCampaigns(T0, sender)).failed).toBe(1);
    failSend = false;
    await drainCampaigns(plus(5), sender);
    expect(sent).toHaveLength(0);
    expect((await recips(id))[0].status).toBe("falhou");
  });

  it("no máximo 150 por dia", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    await ready([await wrote("Ana Teste", "+5571999990071")]);
    const others = await db.insert(contacts).values(Array.from({ length: 150 }, (_, i) => ({ name: `Antes ${i}`, phoneE164: `+5571980${String(100000 + i)}` }))).returning({ id: contacts.id });
    const [prev] = await db.insert(campaigns).values({ name: "Manhã", body: "x", status: "concluida", total: 150, createdBy: gestao }).returning();
    await db.insert(campaignRecipients).values(others.map((c) => ({ campaignId: prev.id, contactId: c.id, status: "enviada", sentAt: plus(-120) })));
    expect((await drainCampaigns(T0, sender)).waiting).toBe("limite_do_dia");
  });

  it("termina sozinha e avisa quem confirmou", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const id = await ready([await wrote("Ana Teste", "+5571999990071")]);
    await drainCampaigns(T0, sender);
    await drainCampaigns(plus(3), sender);
    expect((await db.select().from(campaigns).where(eq(campaigns.id, id)))[0].status).toBe("concluida");
    const [a] = await db.select().from(alerts).where(eq(alerts.type, "massa_concluida"));
    expect(a).toMatchObject({ userId: gestao, message: "Mensagem em massa “Retorno” terminou: 1 enviada." });
  });

  it("pausar segura; cancelar tira quem ainda não recebeu", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const id = await ready([await wrote("Ana Teste", "+5571999990071"), await wrote("Bia Teste", "+5571999990072")]);
    await drainCampaigns(T0, sender);
    await pauseCampaign(id, actor);
    expect((await drainCampaigns(plus(5), sender)).sent).toBe(0);
    await cancelCampaign(id, actor);
    const rows = await recips(id);
    expect(rows.map((r) => r.status).sort()).toEqual(["enviada", "pulada"]);
    expect(sent).toHaveLength(1);
  });
});
