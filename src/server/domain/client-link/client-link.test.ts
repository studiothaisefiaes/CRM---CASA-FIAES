import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog, clientLinks, contacts, deals, lists, professionals, professionalServices, settings, stages, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { hashToken, newToken } from "../../auth/tokens";
import { resetLimit } from "../../auth/rate-limit";
import { createClientLink, icsForToken, openClientLink } from "./links";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const NOW = bahia("2026-10-14", "12:00"); // quarta
const CASA = { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "18:00"] };
const IPS: string[] = [];
const ipOf = (n: string) => { IPS.push(n); return n; };
let recepcao = "", maiara = "", bia = "", paula = "", corte = "", escova = "";
let k = 0;

const ap = async (o: Partial<typeof appointments.$inferInsert> = {}) =>
  (await db.insert(appointments).values({ contactId: paula, clientName: "PAULA SOUZA", professionalId: maiara, serviceId: corte, serviceLabel: "Corte feminino",
    startsAt: bahia("2026-10-16", "10:00"), durationMin: 60, status: "agendado", origin: "crm", externalKey: `t:${++k}`, ...o }).returning())[0];
const tokenOf = (url: string) => url.split("/c/")[1];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetDb();
  await db.insert(settings).values([{ key: "business_hours", value: CASA }, { key: "agenda_modo", value: "dupla" },
    { key: "casa_info", value: { endereco: "Rua das Flores, 10 - Pituba", whatsapp: "+5571988887777" } }]);
  recepcao = (await db.insert(users).values({ name: "Cati", email: "c@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  [corte, escova] = (await db.insert(lists).values([{ kind: "service", label: "Corte feminino", durationMin: 60 }, { kind: "service", label: "Escova", durationMin: 40 }]).returning()).map((r) => r.id);
  maiara = (await db.insert(professionals).values({ name: "MAIARA" }).returning())[0].id;
  bia = (await db.insert(professionals).values({ name: "BIA" }).returning())[0].id;
  await db.insert(professionalServices).values([{ professionalId: maiara, serviceId: corte }, { professionalId: bia, serviceId: escova }]);
  paula = (await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571999990001" }).returning())[0].id;
});
afterEach(() => { vi.useRealTimers(); for (const ip of IPS) resetLimit(`link-ruim:${ip}`); });

describe("gerar o link (seção 9.4.1)", () => {
  it("guarda só o hash (o token não fica em lugar nenhum do banco); texto modelo; validade = fim + 24 h", async () => {
    const a = await ap();
    const r = await createClientLink({ appointmentId: a.id, via: "agenda", actorId: recepcao, now: NOW });
    const token = tokenOf(r.url);
    expect(token).toMatch(/^[2-9A-HJ-NP-Za-km-z]{8}$/); // curto: 8 símbolos, sem 0/O/1/l/I
    const [l] = await db.select().from(clientLinks);
    expect(l).toMatchObject({ tokenHash: hashToken(token), visitId: r.visitId, createdVia: "agenda", createdBy: recepcao, openCount: 0 });
    expect(l.issuedStartsAt.toISOString()).toBe(bahia("2026-10-16", "10:00").toISOString());
    expect(l.expiresAt.toISOString()).toBe(bahia("2026-10-17", "11:00").toISOString());
    const dump = JSON.stringify((await db.execute(sql`select * from client_links`)).rows) + JSON.stringify(await db.select().from(auditLog));
    expect(dump).not.toContain(token);
    expect(r.text).toBe(["Olá, Paula! 💛", "", "Seu horário na Casa Fiaes:", "", "📅 *sexta-feira, 16/10*", "⏰ às *10h*", "✨ Corte feminino com Maiara", "",
      `Para confirmar ou remarcar, é só tocar aqui: ${r.url}`].join("\n"));
  });

  it("visita com dois serviços: um link só, com os dois no texto", async () => {
    const a = await ap();
    await ap({ serviceId: escova, serviceLabel: "Escova", professionalId: bia, startsAt: bahia("2026-10-16", "11:00"), durationMin: 40 });
    const r = await createClientLink({ appointmentId: a.id, via: "agenda", actorId: recepcao, now: NOW });
    expect(r.text).toContain("\n✨ 10h · Corte feminino com Maiara e 11h · Escova com Bia\n");
    expect((await db.select().from(clientLinks))[0].expiresAt.toISOString()).toBe(bahia("2026-10-17", "11:40").toISOString());
  });

  it("pela conversa: o horário futuro mais próximo dela; sem horário, explica; horário cancelado ou passado não gera", async () => {
    const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
    const [d] = await db.insert(deals).values({ contactId: paula, stageId: st.id }).returning();
    await expect(createClientLink({ dealId: d.id, via: "conversa", actorId: recepcao, now: NOW })).rejects.toThrow("Ela não tem horário marcado na agenda. Marque na Agenda para gerar o link.");
    await ap({ startsAt: bahia("2026-10-20", "10:00") });
    const perto = await ap({ startsAt: bahia("2026-10-16", "15:00") });
    const r = await createClientLink({ dealId: d.id, via: "conversa", actorId: recepcao, now: NOW });
    expect((await db.select().from(appointments).where(eq(appointments.id, perto.id)))[0].visitId).toBe(r.visitId);
    const cancelado = await ap({ status: "cancelado", startsAt: bahia("2026-10-21", "10:00") });
    await expect(createClientLink({ appointmentId: cancelado.id, via: "agenda", actorId: recepcao, now: NOW })).rejects.toThrow("Só dá para gerar o link de horário agendado ou confirmado.");
  });
});

describe("abrir o link (seções 9.4.2 e 9.4.9)", () => {
  it("primeiro nome, serviços, dia e hora, endereço e Como chegar; conta as aberturas; nada de sobrenome, telefone ou id", async () => {
    const a = await ap();
    const token = tokenOf((await createClientLink({ appointmentId: a.id, via: "agenda", actorId: recepcao, now: NOW })).url);
    const o = await openClientLink(token, { ip: ipOf("10.1.0.1"), now: NOW });
    if (o.kind !== "ok") throw new Error(o.kind);
    expect(o.view).toMatchObject({
      firstName: "Paula", state: "agendado", services: "Corte feminino com Maiara", when: "sexta, 16 de outubro · 10:00 às 11:00", changedNotice: null,
      canAct: true, canCancel: true, remarcarPedido: false, shownStart: bahia("2026-10-16", "10:00").toISOString(), address: "Rua das Flores, 10 - Pituba",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Rua%20das%20Flores%2C%2010%20-%20Pituba", cancelarAteHoras: 24,
    });
    expect(o.view.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5571988887777\?text=/);
    expect(JSON.stringify(o)).not.toMatch(/Souza|99999|[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect((await db.select().from(clientLinks))[0]).toMatchObject({ openCount: 1 });
  });

  it("sem endereço da Casa: sem Como chegar, o resto funciona", async () => {
    await db.update(settings).set({ value: { endereco: null, whatsapp: null } }).where(eq(settings.key, "casa_info"));
    const a = await ap();
    const token = tokenOf((await createClientLink({ appointmentId: a.id, via: "agenda", actorId: recepcao, now: NOW })).url);
    const o = await openClientLink(token, { ip: ipOf("10.1.0.2"), now: NOW });
    expect(o).toMatchObject({ kind: "ok", view: { address: null, mapsUrl: null, whatsappUrl: null, canAct: true } });
  });

  it("vencido, revogado e token errado caem na mesma página genérica", async () => {
    const a = await ap();
    const token = tokenOf((await createClientLink({ appointmentId: a.id, via: "agenda", actorId: recepcao, now: NOW })).url);
    expect(await openClientLink(token, { ip: ipOf("10.1.0.3"), now: bahia("2026-10-17", "11:00") })).toEqual({ kind: "invalido" });
    expect(await openClientLink("x".repeat(43), { ip: ipOf("10.1.0.3"), now: NOW })).toEqual({ kind: "invalido" });
    expect(await openClientLink("curto", { ip: ipOf("10.1.0.3"), now: NOW })).toEqual({ kind: "invalido" });
    await db.update(clientLinks).set({ revokedAt: NOW });
    expect(await openClientLink(token, { ip: ipOf("10.1.0.3"), now: NOW })).toEqual({ kind: "invalido" });
  });

  it("link antigo (token longo de 43) continua valendo; códigos novos não se repetem", async () => {
    const a = await ap();
    const r = await createClientLink({ appointmentId: a.id, via: "agenda", actorId: recepcao, now: NOW });
    const antigo = newToken();
    await db.insert(clientLinks).values({ tokenHash: hashToken(antigo), visitId: r.visitId, issuedStartsAt: bahia("2026-10-16", "10:00"), createdVia: "agenda", expiresAt: r.expiresAt });
    expect(antigo).toHaveLength(43);
    expect((await openClientLink(antigo, { ip: ipOf("10.1.0.4"), now: NOW })).kind).toBe("ok");
    const tokens = [tokenOf(r.url)];
    for (let i = 0; i < 20; i++) tokens.push(tokenOf((await createClientLink({ appointmentId: a.id, via: "agenda", actorId: recepcao, now: NOW })).url));
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const t of tokens) expect((await openClientLink(t, { ip: ipOf("10.1.0.4"), now: NOW })).kind).toBe("ok");
    // Formato parecido mas com símbolo proibido (0, O, 1, l, I): nem consulta.
    expect((await openClientLink("K7mPq2X0", { ip: ipOf("10.1.0.4"), now: NOW })).kind).toBe("invalido");
  });

  it("30 aberturas com link errado por IP em 10 min: 'Muitas tentativas' até para link bom; outro IP segue", async () => {
    const a = await ap();
    const token = tokenOf((await createClientLink({ appointmentId: a.id, via: "agenda", actorId: recepcao, now: NOW })).url);
    for (let i = 0; i < 30; i++) expect((await openClientLink(`errado${i}`.padEnd(43, "x"), { ip: ipOf("10.1.0.9"), now: NOW })).kind).toBe("invalido");
    expect(await openClientLink(token, { ip: "10.1.0.9", now: NOW })).toEqual({ kind: "limite" });
    expect((await openClientLink(token, { ip: ipOf("10.1.0.10"), now: NOW })).kind).toBe("ok");
    expect((await openClientLink(token, { ip: "10.1.0.9", now: new Date(NOW.getTime() + 10 * 60_000 + 1) })).kind).toBe("ok");
  });

  it(".ics: UTC, sem o nome da cliente, com o endereço e o link; visita cancelada não tem .ics", async () => {
    const a = await ap();
    const r = await createClientLink({ appointmentId: a.id, via: "agenda", actorId: recepcao, now: NOW });
    const ics = await icsForToken(tokenOf(r.url), { ip: ipOf("10.1.0.11"), now: NOW });
    expect(ics).toContain("DTSTART:20261016T130000Z");
    expect(ics).toContain("DTEND:20261016T140000Z");
    expect(ics).toContain(`UID:${r.visitId}@casafiaes`);
    expect(ics).toContain("SUMMARY:Casa Fiaes · Corte feminino com Maiara");
    expect(ics).toContain("LOCATION:Rua das Flores\\, 10 - Pituba");
    expect(ics).not.toMatch(/Paula|Souza/);
    await db.update(appointments).set({ status: "cancelado" }).where(eq(appointments.id, a.id));
    expect(await icsForToken(tokenOf(r.url), { ip: ipOf("10.1.0.11"), now: NOW })).toBeNull();
  });
});
