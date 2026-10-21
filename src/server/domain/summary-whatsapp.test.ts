import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, auditLog, channels, contacts, deals, outbox, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { setSetting } from "../../../test/agenda-fixtures";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { drainOutbox } from "./outbox";
import { ensureTeamConversation, getSummaryWhatsapp, runSummaryWhatsapp, saveSummaryWhatsapp, SUMMARY_SOURCE, type SummaryWhatsapp } from "./summary-whatsapp";

const at = (iso: string) => new Date(iso);
// Terça 20/10/2026, 19h em Salvador = 22h UTC.
const TER_19H = at("2026-10-20T22:00:00Z");
const SAB_19H = at("2026-10-24T22:00:00Z");
const DOM_19H = at("2026-10-25T22:00:00Z");
const PHONE_G = "+5571988880001", PHONE_M = "+5571988880002", PHONE_C = "+5571988880003";

const sent: { to: string; text: string }[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, to: string, text: string) => { sent.push({ to, text }); return { externalId: `OUT${sent.length}` }; },
  sendPoll: async () => ({ externalId: "POLL" }),
};

let s: Awaited<ReturnType<typeof setupCaixa>>;
let marta: { id: string };
const outboxRows = () => db.select().from(outbox);
const base = (): SummaryWhatsapp => ({ enabled: true, destino: "gestao", hora: 19, maxPessoas: 3, soDiasAbertos: true, numeros: [{ userId: s.gestora.id, phone: PHONE_G }], titulo: "*Resumo do dia* ({data})" });
const ligar = (patch: Partial<SummaryWhatsapp> = {}) => saveSummaryWhatsapp({ ...base(), ...patch }, s.gestora.id, { confirmouEnvio: true });

beforeEach(async () => {
  sent.length = 0;
  process.env.APP_URL = "https://crm.exemplo";
  await resetDb();
  s = await setupCaixa();
  const [gestaoProfile] = await db.select({ profileId: users.profileId }).from(users).where(eq(users.id, s.gestora.id));
  [marta] = await db.insert(users).values({ name: "Marta Gestão", email: "marta@c.com", role: "gestor", passwordHash: "x", profileId: gestaoProfile.profileId }).returning({ id: users.id });
  setWhatsappProvider(fake);
  await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" });
  await setSetting("business_hours", { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "17:00"] });
});
afterEach(() => { setWhatsappProvider(null); });

describe("Resumo do dia no WhatsApp: configuração", () => {
  it("nasce desligado, às 19h, para a Gestão, até 3 pessoas, só em dia aberto", async () => {
    expect(await getSummaryWhatsapp()).toEqual({ enabled: false, destino: "gestao", hora: 19, maxPessoas: 3, soDiasAbertos: true, numeros: [], titulo: "*Resumo do dia* ({data})" });
    expect(await runSummaryWhatsapp(TER_19H)).toEqual({ enqueued: 0, skipped: "desligado" });
  });
  it("ligar sem a confirmação de envio real é recusado no servidor; com ela liga e audita", async () => {
    await expect(saveSummaryWhatsapp(base(), s.gestora.id)).rejects.toThrow("Confirme o envio real para ligar.");
    expect((await getSummaryWhatsapp()).enabled).toBe(false);
    await ligar();
    expect((await getSummaryWhatsapp()).enabled).toBe(true);
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, "resumo_whatsapp")))[0].action).toBe("ligou");
  });
  it("editar o que já está ligado não pede a confirmação de novo; desligar é na hora", async () => {
    await ligar();
    await saveSummaryWhatsapp({ ...base(), hora: 20 }, s.gestora.id);
    await saveSummaryWhatsapp({ ...base(), enabled: false }, s.gestora.id);
    expect((await getSummaryWhatsapp()).enabled).toBe(false);
  });
  it("salvar recusa quem não tem 'Ver números de toda a equipe'", async () => {
    await expect(ligar({ destino: "escolhidas", numeros: [{ userId: s.cati.id, phone: PHONE_C }] })).rejects.toThrow("Cati Souza não tem permissão para ver os números de toda a equipe.");
    expect((await getSummaryWhatsapp()).enabled).toBe(false);
  });
  it("recusa número inválido, hora e quantidade fora dos limites, e ligar sem ninguém com número", async () => {
    await expect(ligar({ numeros: [{ userId: s.gestora.id, phone: "123" }] })).rejects.toThrow("WhatsApp inválido");
    await expect(ligar({ hora: 24 })).rejects.toThrow();
    await expect(ligar({ maxPessoas: 11 })).rejects.toThrow();
    await expect(ligar({ numeros: [] })).rejects.toThrow("Ponha o WhatsApp de pelo menos uma pessoa da Gestão.");
  });
});

describe("Resumo do dia no WhatsApp: envio", () => {
  it("às 19h de um dia aberto, cada pessoa recebe o próprio resumo na conversa de Equipe do número dela", async () => {
    await ligar();
    const r = await runSummaryWhatsapp(TER_19H);
    expect(r).toEqual({ enqueued: 1, skipped: null });
    const [row] = await outboxRows();
    expect(row.text).toContain("Resumo do dia");
    expect(row.text).toContain("https://crm.exemplo/relatorios?periodo=hoje"); // links absolutos com APP_URL
    expect(row.text).not.toMatch(/\s\/(atendimento|relatorios)/);
    expect((row.options as { source: string }).source).toBe(`${SUMMARY_SOURCE}2026-10-20:${s.gestora.id}`);
    const [d] = await db.select().from(deals).where(eq(deals.id, row.dealId));
    const [c] = await db.select().from(contacts).where(eq(contacts.id, d.contactId));
    expect(c.phoneE164).toBe(PHONE_G);
  });
  it("o número vira contato do tipo Equipe (fora da Fila de clientes e das métricas)", async () => {
    await ligar();
    await runSummaryWhatsapp(TER_19H);
    const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, PHONE_G));
    expect(c.kind).toBe("equipe");
    expect(c.isTeam).toBe(true);
  });
  it("sábado às 19h (a Casa fechou às 17h): sai mesmo assim; a fila não segura o resumo", async () => {
    await ligar();
    expect((await runSummaryWhatsapp(SAB_19H)).enqueued).toBe(1);
    const r = await drainOutbox(SAB_19H);
    expect(r.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Resumo do dia");
  });
  it("domingo, segunda ou Dia especial fechado: não manda", async () => {
    await ligar();
    expect(await runSummaryWhatsapp(DOM_19H)).toEqual({ enqueued: 0, skipped: "casa_nao_abriu" });
    expect((await runSummaryWhatsapp(at("2026-10-19T22:00:00Z"))).skipped).toBe("casa_nao_abriu"); // segunda
    await setSetting("dias_especiais", [{ day: "2026-10-20", window: null, text: null }]);
    expect(await runSummaryWhatsapp(TER_19H)).toEqual({ enqueued: 0, skipped: "casa_nao_abriu" });
    expect(await outboxRows()).toHaveLength(0);
  });
  it("com 'só em dias abertos' desligado, manda todo dia, domingo inclusive", async () => {
    await ligar({ soDiasAbertos: false });
    expect((await runSummaryWhatsapp(DOM_19H)).enqueued).toBe(1);
  });
  it("rodar duas vezes no mesmo dia (e a cada hora) não duplica", async () => {
    await ligar();
    await runSummaryWhatsapp(TER_19H);
    expect((await runSummaryWhatsapp(TER_19H)).enqueued).toBe(0);
    expect((await runSummaryWhatsapp(at("2026-10-20T22:30:00Z"))).enqueued).toBe(0);
    expect(await outboxRows()).toHaveLength(1);
  });
  it("só enfileira na hora configurada (hora local de Salvador)", async () => {
    await ligar({ hora: 20 });
    expect(await runSummaryWhatsapp(TER_19H)).toEqual({ enqueued: 0, skipped: "fora_da_hora" });
    expect((await runSummaryWhatsapp(at("2026-10-20T23:00:00Z"))).enqueued).toBe(1); // 20h em Salvador
  });
  it("destino Gestão: quem é da Gestão e tem número recebe; sem número é pulada; maxPessoas limita", async () => {
    await ligar({ numeros: [{ userId: s.gestora.id, phone: PHONE_G }, { userId: marta.id, phone: PHONE_M }] });
    expect((await runSummaryWhatsapp(TER_19H)).enqueued).toBe(2);
    await db.delete(outbox);
    await ligar({ maxPessoas: 1, numeros: [{ userId: s.gestora.id, phone: PHONE_G }, { userId: marta.id, phone: PHONE_M }] });
    expect((await runSummaryWhatsapp(TER_19H)).enqueued).toBe(1);
    await db.delete(outbox);
    await ligar({ numeros: [{ userId: marta.id, phone: PHONE_M }] }); // a Gestora não tem número: pulada
    await runSummaryWhatsapp(TER_19H);
    expect((await outboxRows()).map((r) => (r.options as { source: string }).source)).toEqual([`${SUMMARY_SOURCE}2026-10-20:${marta.id}`]);
  });
  it("destino 'escolhidas': só as de numeros, até maxPessoas; a Gestão fora da lista não recebe", async () => {
    await ligar({ destino: "escolhidas", numeros: [{ userId: marta.id, phone: PHONE_M }] });
    await runSummaryWhatsapp(TER_19H);
    expect((await outboxRows()).map((r) => (r.options as { source: string }).source)).toEqual([`${SUMMARY_SOURCE}2026-10-20:${marta.id}`]);
  });
  it("desligar antes de sair cancela o que estava na fila", async () => {
    await ligar();
    await runSummaryWhatsapp(TER_19H);
    await saveSummaryWhatsapp({ ...base(), enabled: false }, s.gestora.id);
    const r = await drainOutbox(TER_19H);
    expect(r.cancelled).toBe(1);
    expect(sent).toHaveLength(0);
  });
});

describe("Resumo do dia no WhatsApp: correções da rodada 1", () => {
  it("pessoa desativada que já estava na lista: desligar e salvar ligado funcionam, e a entrada velha é descartada", async () => {
    await ligar({ numeros: [{ userId: s.gestora.id, phone: PHONE_G }, { userId: marta.id, phone: PHONE_M }] });
    await db.update(users).set({ active: false }).where(eq(users.id, marta.id));
    const both = [{ userId: s.gestora.id, phone: PHONE_G }, { userId: marta.id, phone: PHONE_M }];
    expect((await saveSummaryWhatsapp({ ...base(), numeros: both }, s.gestora.id)).descartadas).toBe(1); // salvar ligado ignora a velha
    expect((await getSummaryWhatsapp()).numeros.map((n) => n.userId)).toEqual([s.gestora.id]);
    await expect(ligar({ numeros: both })).rejects.toThrow("Essa pessoa não está ativa no sistema."); // já saiu: voltar a pôr é pessoa nova, conferida a rigor
  });
  it("desligar nunca é bloqueado por quem saiu da lista", async () => {
    await ligar({ numeros: [{ userId: s.gestora.id, phone: PHONE_G }, { userId: marta.id, phone: PHONE_M }] });
    await db.update(users).set({ active: false }).where(eq(users.id, marta.id));
    const r = await saveSummaryWhatsapp({ ...base(), enabled: false, numeros: [{ userId: s.gestora.id, phone: PHONE_G }, { userId: marta.id, phone: PHONE_M }] }, s.gestora.id);
    expect(r.descartadas).toBe(1);
    expect((await getSummaryWhatsapp()).enabled).toBe(false);
  });
  it("mudar a linha de abertura muda o texto enfileirado; {data} vira o dia", async () => {
    await ligar({ titulo: "Boa noite! Resumo de {data}:" });
    await runSummaryWhatsapp(TER_19H);
    const [row] = await outboxRows();
    expect(row.text.split("\n")[0]).toMatch(/^Boa noite! Resumo de .*20\/10.*:$/);
    await expect(ligar({ titulo: "ab" })).rejects.toThrow("Escreva a linha de abertura");
  });
  it("falha por pessoa (número marcado como spam) vira aviso para a gestão, um por dia e pessoa", async () => {
    await ligar();
    await db.insert(contacts).values({ name: "Spam", phoneE164: PHONE_G, kind: "spam", ignored: true });
    expect(await runSummaryWhatsapp(TER_19H)).toEqual({ enqueued: 0, skipped: null });
    await runSummaryWhatsapp(TER_19H);
    const rows = await db.select().from(alerts).where(eq(alerts.audience, "gestao"));
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toContain("O resumo do dia não foi para");
    expect(rows[0].message).toContain("spam");
  });
});

describe("ensureTeamConversation", () => {
  it("acha ou cria o contato como Equipe e a conversa dele, sem mandar nada, e é idempotente", async () => {
    const a = await ensureTeamConversation("(71) 98888-0009");
    const b = await ensureTeamConversation("+5571988880009");
    expect(b).toEqual(a);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, a.contactId));
    expect(c.kind).toBe("equipe");
    expect(c.phoneE164).toBe("+5571988880009");
    expect((await db.select().from(deals).where(eq(deals.contactId, a.contactId)))).toHaveLength(1);
    expect(await outboxRows()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
  it("um cliente que já existe com esse número passa a Equipe e usa a conversa aberta que ele já tinha", async () => {
    const [c] = await db.insert(contacts).values({ name: "Gestora", phoneE164: PHONE_G }).returning();
    const first = await ensureTeamConversation(PHONE_G);
    expect(first.contactId).toBe(c.id);
    expect((await db.select().from(contacts).where(eq(contacts.id, c.id)))[0].kind).toBe("equipe");
  });
  it("recusa número inválido", async () => {
    await expect(ensureTeamConversation("abc")).rejects.toThrow("WhatsApp inválido");
  });
});
