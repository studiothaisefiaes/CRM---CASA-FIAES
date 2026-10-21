import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { alerts, appointments, auditLog, clientLinks, contacts, dealEvents, deals, lists, professionals, professionalServices, settings, stages, tasks, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { resetLimit } from "../../auth/rate-limit";
import { alertHref } from "@/lib/alert-links";
import { reschedulePort } from "../agenda/ports";
import { createClientLink, openClientLink } from "./links";
import { cancelByLink, confirmByLink, requestRescheduleByLink } from "./respond";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const NOW = bahia("2026-10-14", "12:00");
const CASA = { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "18:00"] };
const IPS: string[] = [];
const ipOf = (n: string) => { IPS.push(n); return { ip: n, now: NOW }; };
let recepcao = "", ana = "", maiara = "", bia = "", paula = "", corte = "", escova = "";
let k = 0;

const ap = async (o: Partial<typeof appointments.$inferInsert> = {}) =>
  (await db.insert(appointments).values({ contactId: paula, clientName: "Paula Souza", professionalId: maiara, serviceId: corte, serviceLabel: "Corte feminino",
    startsAt: bahia("2026-10-16", "10:00"), durationMin: 60, status: "agendado", origin: "crm", externalKey: `t:${++k}`, ...o }).returning())[0];
const openDeal = async (contactId = paula) => {
  const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
  return (await db.insert(deals).values({ contactId, stageId: st.id, ownerId: ana }).returning())[0].id;
};
const link = async (appointmentId: string) => {
  const r = await createClientLink({ appointmentId, via: "conversa", actorId: recepcao, now: NOW });
  return { token: r.url.split("/c/")[1], shown: r.start.toISOString() };
};
const view = async (token: string, ip = "10.2.9.9") => {
  const o = await openClientLink(token, { ip, now: NOW, count: false });
  if (o.kind !== "ok") throw new Error(o.kind);
  return o.view;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetDb();
  await db.insert(settings).values([{ key: "business_hours", value: CASA }, { key: "agenda_modo", value: "dupla" }, { key: "casa_info", value: { endereco: null, whatsapp: "+5571988887777" } }]);
  recepcao = (await db.insert(users).values({ name: "Cati", email: "c@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  ana = (await db.insert(users).values({ name: "Ana Atendente", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  [corte, escova] = (await db.insert(lists).values([{ kind: "service", label: "Corte feminino", durationMin: 60 }, { kind: "service", label: "Escova", durationMin: 40 }]).returning()).map((r) => r.id);
  maiara = (await db.insert(professionals).values({ name: "MAIARA" }).returning())[0].id;
  bia = (await db.insert(professionals).values({ name: "BIA" }).returning())[0].id;
  await db.insert(professionalServices).values([{ professionalId: maiara, serviceId: corte }, { professionalId: bia, serviceId: escova }]);
  paula = (await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571999990001" }).returning())[0].id;
});
afterEach(() => { vi.useRealTimers(); for (const ip of IPS) { resetLimit(`link-ruim:${ip}`); resetLimit(`link-acao-ip:${ip}`); } });

describe("confirmar pelo link (seção 9.4.4)", () => {
  it("todos os serviços da visita viram Confirmado pelo link; repetir não muda nada; a conversa registra uma vez", async () => {
    const deal = await openDeal();
    const a1 = await ap();
    const a2 = await ap({ serviceId: escova, serviceLabel: "Escova", professionalId: bia, startsAt: bahia("2026-10-16", "11:00"), durationMin: 40 });
    const { token, shown } = await link(a1.id);
    expect(await confirmByLink(token, shown, ipOf("10.2.0.1"))).toEqual({ message: "Pronto! Seu horário está confirmado. Te esperamos!" });
    expect(await db.select({ s: appointments.status, via: appointments.confirmedVia }).from(appointments).where(inArray(appointments.id, [a1.id, a2.id])).orderBy(asc(appointments.startsAt)))
      .toEqual([{ s: "confirmado", via: "link" }, { s: "confirmado", via: "link" }]);
    await confirmByLink(token, shown, ipOf("10.2.0.1"));
    expect(await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, deal), eq(dealEvents.type, "link_cliente")))).toHaveLength(1);
    expect((await db.select().from(clientLinks))[0].lastAction).toBe("confirmou");
    expect((await view(token)).state).toBe("confirmado");
  });

  it("duas confirmações ao mesmo tempo: uma muda, a outra não faz nada", async () => {
    await openDeal();
    const a = await ap();
    const { token, shown } = await link(a.id);
    await Promise.all([confirmByLink(token, shown, ipOf("10.2.1.1")), confirmByLink(token, shown, ipOf("10.2.1.2"))]);
    const log = await db.select().from(auditLog).where(and(eq(auditLog.entity, "appointment"), eq(auditLog.entityId, a.id)));
    expect(log.filter((l) => (l.data as { para?: string }).para === "confirmado")).toHaveLength(1);
    expect(await db.select().from(dealEvents).where(eq(dealEvents.type, "link_cliente"))).toHaveLength(1);
  });

  it("remarcado depois do link: a página mostra o horário novo e a aba antiga (com o horário de antes) é recusada", async () => {
    await openDeal();
    const a = await ap();
    const { token, shown } = await link(a.id);
    await reschedulePort({ appointmentId: a.id, startsAt: bahia("2026-10-16", "14:00"), professionalId: maiara, actorId: recepcao });
    const v = await view(token);
    expect(v.changedNotice).toBe("Seu horário mudou: agora é sexta, 16/10, às 14:00");
    await expect(confirmByLink(token, shown, ipOf("10.2.2.1"))).rejects.toThrow("O horário mudou. Atualize a página.");
    await confirmByLink(token, v.shownStart, ipOf("10.2.2.1"));
    expect((await db.select().from(appointments).where(eq(appointments.id, a.id)))[0].status).toBe("confirmado");
  });
});

describe("cancelar pelo link (seção 9.4.6)", () => {
  it("dentro do prazo, com motivo, pela porta do 6B; depois, Confirmar numa aba antiga diz que foi cancelado", async () => {
    await openDeal();
    const a = await ap();
    const { token, shown } = await link(a.id);
    expect(await cancelByLink(token, shown, { motivo: "imprevisto", texto: "" }, ipOf("10.2.3.1")))
      .toEqual({ message: "Pronto, seu horário foi cancelado. Quando quiser marcar de novo, é só chamar a Casa no WhatsApp." });
    expect((await db.select().from(appointments).where(eq(appointments.id, a.id)))[0]).toMatchObject({ status: "cancelado", cancelReason: "cliente_desmarcou", cancelledVia: "link", cancelNote: "Imprevisto" });
    await expect(confirmByLink(token, shown, ipOf("10.2.3.1"))).rejects.toThrow("Este horário foi cancelado.");
    expect(await view(token)).toMatchObject({ state: "cancelado", canAct: false, canCancel: false });
  });

  it("avisa no sino (P7), com ou sem conversa aberta: quem, quando, o motivo e que o horário ficou livre; o toque abre o horário na Agenda", async () => {
    const a = await ap();
    const { token, shown } = await link(a.id);
    await cancelByLink(token, shown, { motivo: "imprevisto", texto: "" }, ipOf("10.2.3.7"));
    const [al] = await db.select().from(alerts).where(eq(alerts.type, "link_cancelou"));
    expect(al).toMatchObject({ audience: "gestao", userId: null, dealId: null, severity: "info",
      message: "Paula cancelou pelo link o horário de sexta, 16/10 às 10:00. Motivo: Imprevisto. O horário ficou livre." });
    expect(alertHref({ type: al.type, dealId: al.dealId, dedupeKey: al.dedupeKey })).toBe(`/agenda?d=2026-10-16&destaque=${a.id}`);

    await openDeal();
    const b = await ap({ startsAt: bahia("2026-10-17", "15:00") });
    const l2 = await link(b.id);
    await cancelByLink(l2.token, l2.shown, { motivo: "outro", texto: "Viajei" }, ipOf("10.2.3.8"));
    expect((await db.select().from(alerts).where(eq(alerts.type, "link_cancelou"))).map((x) => x.message)).toContain("Paula cancelou pelo link o horário de sábado, 17/10 às 15:00. Motivo: Viajei. O horário ficou livre.");
  });

  it("menos de 24 h antes: recusado, e a página troca o botão por 'Falar com a Casa'", async () => {
    await openDeal();
    const a = await ap();
    const { token, shown } = await link(a.id);
    vi.setSystemTime(bahia("2026-10-15", "11:00"));
    const late = { ip: "10.2.4.1", now: bahia("2026-10-15", "11:00") };
    IPS.push(late.ip);
    await expect(cancelByLink(token, shown, { motivo: "saude" }, late)).rejects.toThrow("Faltam menos de 24 horas: fale com a Casa pelo WhatsApp.");
    const o = await openClientLink(token, { ip: late.ip, now: late.now, count: false });
    expect(o).toMatchObject({ kind: "ok", view: { canAct: true, canCancel: false } });
    if (o.kind === "ok") expect(o.view.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5571988887777/);
  });

  it("visita já paga no caixa do CRM (pagou antes): sem o botão Cancelar e, se tentar, manda falar com a Casa (nada de texto da equipe)", async () => {
    await openDeal();
    const a = await ap();
    const { token, shown } = await link(a.id);
    await db.execute(sql`insert into comandas (id, day, number, status, client_name, opened_by, closed_at) values (gen_random_uuid(), '2026-10-14', 1, 'fechada', 'Paula Souza', ${recepcao}, now())`);
    await db.execute(sql`insert into comanda_items (comanda_id, kind, label, professional_id, qty, unit_cents, total_cents, appointment_id)
      select id, 'servico', 'Corte feminino', ${maiara}, 1, 9000, 9000, ${a.id} from comandas`);
    expect(await view(token)).toMatchObject({ canAct: true, canCancel: false });
    await expect(cancelByLink(token, shown, { motivo: "saude" }, ipOf("10.2.4.9"))).rejects.toThrow("Esse horário já foi pago: para cancelar, fale com a Casa pelo WhatsApp.");
    expect((await db.select().from(appointments).where(eq(appointments.id, a.id)))[0].status).toBe("agendado");
  });

  it("'Outro' sem texto e motivo desconhecido são recusados", async () => {
    await openDeal();
    const a = await ap();
    const { token, shown } = await link(a.id);
    await expect(cancelByLink(token, shown, { motivo: "outro", texto: " " }, ipOf("10.2.5.1"))).rejects.toThrow("Escreva o motivo.");
    await expect(cancelByLink(token, shown, { motivo: "x" }, ipOf("10.2.5.1"))).rejects.toThrow("Escolha o motivo.");
    expect((await db.select().from(appointments).where(eq(appointments.id, a.id)))[0].status).toBe("agendado");
  });
});

describe("preciso remarcar (seção 9.4.5)", () => {
  it("com conversa: combinado para a dona, sem cancelar nada; toque repetido não duplica", async () => {
    const deal = await openDeal();
    const a = await ap();
    const { token, shown } = await link(a.id);
    expect(await requestRescheduleByLink(token, shown, "Prefiro sábado de manhã", ipOf("10.2.6.1")))
      .toEqual({ message: "Pronto! A Casa vai te chamar no WhatsApp para combinar outro horário." });
    const [t] = await db.select().from(tasks).where(eq(tasks.dealId, deal));
    expect(t).toMatchObject({ kind: "proxima_acao", title: "Remarcar (pediu pelo link): Prefiro sábado de manhã", assigneeId: ana });
    expect((await db.select().from(appointments).where(eq(appointments.id, a.id)))[0].status).toBe("agendado");
    await requestRescheduleByLink(token, shown, "de novo", ipOf("10.2.6.1"));
    expect(await db.select().from(tasks)).toHaveLength(1);
  });

  it("psico r68 #9: com conversa, vira aviso urgente no sino da dona e da gestão (horário e melhor horário), que abre a conversa", async () => {
    const deal = await openDeal();
    const a = await ap();
    const { token, shown } = await link(a.id);
    await requestRescheduleByLink(token, shown, "Prefiro sábado de manhã", ipOf("10.2.6.2"));
    const al = await db.select().from(alerts).where(eq(alerts.type, "link_remarcar"));
    expect(al).toHaveLength(2);
    const dona = al.find((x) => x.userId === ana)!, gestao = al.find((x) => x.userId === null)!;
    expect(dona).toMatchObject({ audience: "responsavel", dealId: deal, severity: "urgente" });
    expect(gestao).toMatchObject({ audience: "gestao", dealId: deal, severity: "urgente" });
    expect(dona.message).toContain('às ');
    expect(dona.message).toContain('"Prefiro sábado de manhã"');
    expect(alertHref({ type: dona.type, dealId: dona.dealId, dedupeKey: dona.dedupeKey })).toBe(`/atendimento?lead=${deal}`);
    // #30: depois do pedido a página não oferece "Confirmar presença"; "Mudei de ideia" (confirmar) volta ao normal.
    expect((await view(token))).toMatchObject({ remarcarPedido: true });
    await confirmByLink(token, shown, ipOf("10.2.6.3"));
    expect((await view(token))).toMatchObject({ remarcarPedido: false });
  });

  it("sem conversa aberta: aviso para a gestão no sino, que abre a ficha", async () => {
    const [rita] = await db.insert(contacts).values({ name: "Rita Lima", phoneE164: "+5571999990002" }).returning();
    const a = await ap({ contactId: rita.id, clientName: "Rita Lima", startsAt: bahia("2026-10-16", "15:00") });
    const { token, shown } = await link(a.id);
    await requestRescheduleByLink(token, shown, null, ipOf("10.2.7.1"));
    const [al] = await db.select().from(alerts).where(eq(alerts.type, "link_remarcar"));
    expect(al).toMatchObject({ audience: "gestao", userId: null, dealId: null, message: "Rita pediu para remarcar pelo link (sexta, 16/10 às 15:00). Ela não tem conversa aberta: abra a ficha." });
    expect(alertHref({ type: al.type, dealId: al.dealId, dedupeKey: al.dedupeKey })).toBe(`/contatos/${rita.id}`);
  });
});

describe("proteções (seção 9.4.9)", () => {
  it("5 ações por link e 10 por IP a cada 10 minutos", async () => {
    await openDeal();
    const a = await ap();
    const { token, shown } = await link(a.id);
    for (let i = 0; i < 5; i++) await confirmByLink(token, shown, ipOf(`10.2.8.${i}`));
    await expect(confirmByLink(token, shown, ipOf("10.2.8.9"))).rejects.toThrow("Muitas tentativas. Espere alguns minutos.");
    for (let i = 0; i < 10; i++) await expect(confirmByLink("x".repeat(43), shown, ipOf("10.2.8.20"))).rejects.toThrow("Este link não vale mais");
    await expect(confirmByLink("x".repeat(43), shown, ipOf("10.2.8.20"))).rejects.toThrow("Muitas tentativas. Espere alguns minutos.");
  });
});
