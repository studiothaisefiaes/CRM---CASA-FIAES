import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { alerts, appointments, contacts, lists, professionals, professionalServices, profiles, settings, users, visits } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { resetLimit } from "../../auth/rate-limit";
import { createOnlineRequest, decideOnlineRequest, expireOnlineRequests, issueFormToken, listOnlineRequests, ONLINE_SLOTS_IP_LIMIT, onlineOptions, onlineSlots, type OnlineRequestInput } from "./online";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const NOW = bahia("2026-10-14", "12:00"); // quarta
const CASA = { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "18:00"] };
let gestora = "", maiara = "", bia = "", corte = "";
let k = 0;
const IPS: string[] = [];
const ctx = (ip: string, now = NOW) => { IPS.push(ip); return { ip, now }; };
const pedido = (o: Partial<OnlineRequestInput> = {}): OnlineRequestInput => ({
  serviceId: corte, professionalId: maiara, day: "2026-10-16", time: "10:00", name: "Paula Nova", phone: "71 99999-0001", note: "", honeypot: "",
  formToken: issueFormToken(new Date(NOW.getTime() - 5_000)), ...o,
});
const ligar = (o: Record<string, unknown> = {}) => db.insert(settings).values({ key: "agendamento_online", value: { enabled: true, antecedenciaMin: 60, diasAFrente: 40, servicos: [corte], profissionais: [maiara, bia], ...o } })
  .onConflictDoUpdate({ target: settings.key, set: { value: { enabled: true, antecedenciaMin: 60, diasAFrente: 40, servicos: [corte], profissionais: [maiara, bia], ...o } } });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetDb();
  await db.insert(settings).values([{ key: "business_hours", value: CASA }, { key: "agenda_modo", value: "dupla" }]);
  const [gp] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, "gestao"));
  gestora = (await db.insert(users).values({ name: "Thaíse", email: "g@c.com", role: "gestor", passwordHash: "x", profileId: gp.id }).returning())[0].id;
  corte = (await db.insert(lists).values({ kind: "service", label: "Corte feminino", durationMin: 60, priceCents: 9000 }).returning())[0].id;
  maiara = (await db.insert(professionals).values({ name: "MAIARA", agendaPosition: 1 }).returning())[0].id;
  bia = (await db.insert(professionals).values({ name: "BIA", agendaPosition: 2 }).returning())[0].id;
  await db.insert(professionalServices).values([{ professionalId: maiara, serviceId: corte }, { professionalId: bia, serviceId: corte }]);
});
afterEach(() => { vi.useRealTimers(); for (const ip of IPS) { resetLimit(`agendar:${ip}`); resetLimit(`agendar-horarios:${ip}`); } });

describe("agendamento online (seção 9.4.12, DESLIGADO)", () => {
  it("desligado (o padrão) ou agenda em modo consulta: sem opções (a página dá 404) e o pedido é recusado", async () => {
    expect(await onlineOptions(NOW)).toBeNull();
    await expect(createOnlineRequest(pedido(), ctx("10.3.0.1"))).rejects.toThrow("O agendamento online está desligado.");
    await ligar();
    expect(await onlineOptions(NOW)).not.toBeNull();
    await db.update(settings).set({ value: "consulta" }).where(eq(settings.key, "agenda_modo"));
    expect(await onlineOptions(NOW)).toBeNull();
  });

  it("horários: só os livres, com a antecedência; 'Qualquer uma' junta as profissionais", async () => {
    await ligar();
    await db.insert(appointments).values({ professionalId: maiara, serviceId: corte, serviceLabel: "Corte feminino", clientName: "Outra", startsAt: bahia("2026-10-16", "10:00"), durationMin: 60, status: "agendado", origin: "crm", externalKey: `t:${++k}` });
    const soMaiara = await onlineSlots({ serviceId: corte, professionalId: maiara, day: "2026-10-16" }, NOW);
    expect(soMaiara).not.toContain("10:00");
    expect(soMaiara).not.toContain("09:30");
    expect(soMaiara).toContain("11:00");
    expect(await onlineSlots({ serviceId: corte, professionalId: null, day: "2026-10-16" }, NOW)).toContain("10:00");
    const hoje = await onlineSlots({ serviceId: corte, professionalId: maiara, day: "2026-10-14" }, NOW);
    expect(hoje[0]).toBe("13:00"); // 12:00 + 60 min de antecedência
    expect(await onlineSlots({ serviceId: corte, professionalId: maiara, day: "2026-12-01" }, NOW)).toEqual([]); // passa de 40 dias
  });

  it("horários pela página pública: limite por IP (o motor roda por profissional a cada consulta)", async () => {
    await ligar();
    const q = { serviceId: corte, professionalId: null, day: "2026-10-16" };
    const { ip } = ctx("10.3.9.9");
    for (let i = 0; i < ONLINE_SLOTS_IP_LIMIT; i++) await onlineSlots(q, NOW, ip);
    await expect(onlineSlots(q, NOW, ip)).rejects.toThrow("Muitas tentativas. Espere alguns minutos.");
    expect(await onlineSlots(q, NOW, ctx("10.3.9.10").ip)).toContain("10:00"); // outro IP segue
  });

  it("pedido: visita do site com o horário 'solicitado' que segura a vaga, aviso para quem marca na Agenda; contato existente não muda de nome", async () => {
    await ligar();
    await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571999990001" });
    expect(await createOnlineRequest(pedido({ name: "Outro Nome" }), ctx("10.3.1.1"))).toEqual({ message: "Pedido enviado! A Casa vai confirmar pelo WhatsApp." });
    const [a] = await db.select().from(appointments);
    expect(a).toMatchObject({ status: "solicitado", professionalId: maiara, serviceLabel: "Corte feminino", durationMin: 60, origin: "crm" });
    expect(a.externalKey).toBe(`crm:${a.id}`);
    expect((await db.select().from(visits).where(eq(visits.id, a.visitId!)))[0].origin).toBe("online");
    expect((await db.select().from(contacts))[0].name).toBe("Paula Souza");
    expect(await onlineSlots({ serviceId: corte, professionalId: maiara, day: "2026-10-16" }, NOW)).not.toContain("10:00");
    const [al] = await db.select().from(alerts).where(and(eq(alerts.type, "pedido_online"), eq(alerts.userId, gestora)));
    expect(al.message).toBe("Outro pediu Corte feminino em sexta, 16/10 às 10:00 pelo site. Confirme ou recuse na Agenda.");
    expect(await listOnlineRequests()).toEqual([expect.objectContaining({ visitId: a.visitId, service: "Corte feminino", professional: "Maiara" })]);
  });

  it("'Qualquer uma' fica com quem tem menos horários no dia", async () => {
    await ligar();
    await db.insert(appointments).values({ professionalId: maiara, serviceId: corte, serviceLabel: "Corte feminino", clientName: "Outra", startsAt: bahia("2026-10-16", "15:00"), durationMin: 60, status: "agendado", origin: "crm", externalKey: `t:${++k}` });
    await createOnlineRequest(pedido({ professionalId: null }), ctx("10.3.2.1"));
    expect((await db.select().from(appointments).where(eq(appointments.status, "solicitado")))[0].professionalId).toBe(bia);
  });

  it("anti-abuso: campo isca não grava, menos de 3 s recusa, 2 pedidos abertos por celular e 5 por IP por hora", async () => {
    await ligar();
    expect(await createOnlineRequest(pedido({ honeypot: "http://spam" }), ctx("10.3.3.1"))).toEqual({ message: "Pedido enviado! A Casa vai confirmar pelo WhatsApp." });
    expect(await db.select().from(appointments)).toHaveLength(0);
    await expect(createOnlineRequest(pedido({ formToken: issueFormToken(new Date(NOW.getTime() - 1_000)) }), ctx("10.3.3.2"))).rejects.toThrow("Confira os dados e toque em Pedir horário de novo.");
    await expect(createOnlineRequest(pedido({ formToken: "123.forjado" }), ctx("10.3.3.2"))).rejects.toThrow("A página ficou aberta muito tempo. Atualize e tente de novo.");
    await createOnlineRequest(pedido({ time: "10:00" }), ctx("10.3.3.3"));
    await createOnlineRequest(pedido({ time: "14:00" }), ctx("10.3.3.4"));
    await expect(createOnlineRequest(pedido({ time: "16:00" }), ctx("10.3.3.5"))).rejects.toThrow("Você já tem 2 pedidos esperando a Casa responder.");
    for (let i = 0; i < 5; i++) await createOnlineRequest(pedido({ phone: `71 98888-000${i}`, time: `1${i}:00`, professionalId: bia }), ctx("10.3.3.9"));
    await expect(createOnlineRequest(pedido({ phone: "71 98888-0009", time: "17:00", professionalId: bia }), ctx("10.3.3.9"))).rejects.toThrow("Muitos pedidos.");
  });

  it("a recepção confirma (vira agendado) ou recusa (cancelado 'recusado'); sem resposta até o início, cancela sozinho", async () => {
    await ligar();
    await createOnlineRequest(pedido({ time: "10:00" }), ctx("10.3.4.1"));
    await createOnlineRequest(pedido({ phone: "71 99999-0002", time: "11:00" }), ctx("10.3.4.2"));
    await createOnlineRequest(pedido({ phone: "71 99999-0003", time: "12:00" }), ctx("10.3.4.3"));
    const reqs = await listOnlineRequests();
    await decideOnlineRequest(reqs[0].visitId, "confirmar", gestora);
    // QA r58, I-6: recusar pede o motivo (guardado na nota do cancelamento).
    await expect(decideOnlineRequest(reqs[1].visitId, "recusar", gestora)).rejects.toThrow("Escreva o motivo da recusa.");
    await expect(decideOnlineRequest(reqs[1].visitId, "recusar", gestora, undefined, "   ")).rejects.toThrow("Escreva o motivo da recusa.");
    await decideOnlineRequest(reqs[1].visitId, "recusar", gestora, undefined, " Profissional de folga nesse dia ");
    await expect(decideOnlineRequest(reqs[1].visitId, "confirmar", gestora)).rejects.toThrow("Esse pedido já foi respondido.");
    const st = async (visitId: string) => (await db.select({ s: appointments.status, r: appointments.cancelReason, n: appointments.cancelNote }).from(appointments).where(eq(appointments.visitId, visitId)))[0];
    expect(await st(reqs[0].visitId)).toMatchObject({ s: "agendado" });
    expect(await st(reqs[1].visitId)).toMatchObject({ s: "cancelado", r: "recusado", n: "Profissional de folga nesse dia" });
    vi.setSystemTime(bahia("2026-10-16", "12:00"));
    expect(await expireOnlineRequests(bahia("2026-10-16", "12:00"))).toEqual({ cancelled: 1 });
    expect(await st(reqs[2].visitId)).toMatchObject({ s: "cancelado", r: "recusado" });
  });
});
