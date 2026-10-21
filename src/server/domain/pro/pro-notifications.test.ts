import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { contacts, lists, professionals, professionalServices, profiles, proNotifications, pushSubscriptions, settings, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import type { WorkHours } from "@/lib/work-hours";
import type { PushSender } from "../../push";
import { applyAvecFiles } from "../avec/apply";
import { buildXlsx, readXlsx } from "../avec/xlsx";
import { bookVisitPort, cancelMany, changeStatus, reschedulePort } from "../agenda/ports";
import { resolvePro } from "../../queries/pro";
import { listMyNotifications, markNotificationsRead, queueProNotificationsTx, sendPendingProNotifications } from "./notifications";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const CASA = { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "18:00"] };
let recepcao = "", paula = "", corte = "";
let maiara = { pro: "", user: "" }, bia = { pro: "", user: "" };

async function profissional(name: string, email: string) {
  const [prof] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, "profissional"));
  const [u] = await db.insert(users).values({ name, email, role: "atendente", passwordHash: "x", profileId: prof.id }).returning();
  const [p] = await db.insert(professionals).values({ name: name.toUpperCase(), userId: u.id }).returning();
  await db.insert(professionalServices).values({ professionalId: p.id, serviceId: corte });
  return { pro: p.id, user: u.id };
}
const book = (startsAt: Date, professionalId = maiara.pro) =>
  bookVisitPort({ contactId: paula, items: [{ serviceId: corte, professionalId, startsAt, durationMin: 60 }], actorId: recepcao });
const seen = async () => (await db.select().from(proNotifications)).map((n) => [n.professionalId === maiara.pro ? "maiara" : "bia", n.kind, n.title]).sort();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(bahia("2026-10-15", "10:00")); // quinta, Casa aberta
  await resetDb();
  await db.insert(settings).values([{ key: "business_hours", value: CASA }, { key: "agenda_modo", value: "dupla" }]);
  recepcao = (await db.insert(users).values({ name: "Cati", email: "c@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  corte = (await db.insert(lists).values({ kind: "service", label: "Corte feminino", durationMin: 60, priceCents: 9000 }).returning())[0].id;
  maiara = await profissional("Maiara", "m@c.com");
  bia = await profissional("Bia", "b@c.com");
  paula = (await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571999990001" }).returning())[0].id;
});
afterEach(() => { vi.useRealTimers(); });

describe("avisos criados na mudança da agenda (gancho nas portas do 6B)", () => {
  it("marcar avisa; remarcar para outra avisa as duas; cancelar avisa quem está com o horário", async () => {
    const { appointmentIds: [id] } = await book(bahia("2026-10-16", "10:00"));
    expect(await seen()).toEqual([["maiara", "novo", "Horário novo"]]);
    await reschedulePort({ appointmentId: id, startsAt: bahia("2026-10-17", "14:00"), professionalId: bia.pro, actorId: recepcao });
    expect(await seen()).toEqual([["bia", "remarcado", "Horário novo"], ["maiara", "novo", "Horário novo"], ["maiara", "remarcado", "Saiu da sua agenda"]]);
    const [saiu] = await db.select().from(proNotifications).where(eq(proNotifications.title, "Saiu da sua agenda"));
    expect(saiu.body).toBe("Paula saiu da sua agenda (passou para a Bia)");
    vi.setSystemTime(bahia("2026-10-15", "10:01"));
    await cancelMany({ appointmentIds: [id], reason: "cliente_desmarcou", note: null, actorId: recepcao, via: "recepcao" });
    expect((await seen()).filter((s) => s[1] === "cancelado")).toEqual([["bia", "cancelado", "Horário cancelado"]]);
  });

  it("Chegou sai na hora mesmo fora do expediente; o resto espera; confirmar só avisa com 'Avisar quando a cliente confirmar'", async () => {
    vi.setSystemTime(bahia("2026-10-15", "07:30"));
    const { appointmentIds: [id] } = await book(bahia("2026-10-15", "09:00"));
    const [novo] = await db.select().from(proNotifications).where(eq(proNotifications.kind, "novo"));
    expect(novo.holdUntil?.toISOString()).toBe(bahia("2026-10-15", "09:00").toISOString());
    await changeStatus({ appointmentId: id, status: "confirmado", actorId: recepcao, via: "recepcao" });
    expect(await db.select().from(proNotifications).where(eq(proNotifications.kind, "confirmou"))).toHaveLength(0);
    await changeStatus({ appointmentId: id, status: "chegou", actorId: recepcao, via: "recepcao" });
    const [chegou] = await db.select().from(proNotifications).where(eq(proNotifications.kind, "chegou"));
    expect(chegou).toMatchObject({ holdUntil: null, title: "Sua cliente chegou", url: `/pro/horario/${id}` });
    await db.insert(settings).values({ key: "app_profissional", value: { mostraValorServico: false, avisaConfirmacao: true } });
    const { appointmentIds: [id2] } = await book(bahia("2026-10-16", "11:00"));
    await changeStatus({ appointmentId: id2, status: "confirmado", actorId: null, via: "link" });
    expect((await seen()).filter((s) => s[1] === "confirmou")).toEqual([["maiara", "confirmou", "Cliente confirmou"]]);
  });

  it("quem fez a mudança não recebe aviso dela mesma", async () => {
    const { appointmentIds: [id] } = await book(bahia("2026-10-15", "11:00"));
    await db.delete(proNotifications);
    await changeStatus({ appointmentId: id, status: "chegou", actorId: maiara.user, via: "profissional" });
    expect(await db.select().from(proNotifications)).toHaveLength(0);
  });

  it("a importação do Avec não avisa ninguém; script e migração também não", async () => {
    const H = ["Data Cadastro Reserva", "Data Reserva", "Hora", "Cliente", "Celular", "Data Cadastro Cliente", "E-mail", "Profissional", "Serviço", "Origem", "Status", "Observação", "Data Comanda", "Número", "Quem Cadastrou"];
    const rows = await readXlsx(await buildXlsx([H, ["15/10/2026 09:00", "16/10/2026", "10:00", "Rita Teste", 71988880009, "", "", "MAIARA", "Corte feminino", "Interno", "Agendado", "", "", "", "Recepção"]]));
    await applyAvecFiles([{ fileName: "reservas.xlsx", rows }]);
    expect(await db.select().from(proNotifications)).toHaveLength(0);
    const { appointmentIds: [id] } = await book(bahia("2026-10-16", "15:00"));
    await db.delete(proNotifications);
    const appt = { id, professionalId: maiara.pro, startsAt: bahia("2026-10-16", "15:00"), status: "agendado", clientName: "Paula", serviceLabel: "Corte" };
    for (const via of ["avec", "script", "migracao"]) expect(await db.transaction((tx) => queueProNotificationsTx(tx, { kind: "novo", appointment: appt }, { actorId: null, via }))).toBe(0);
  });

  it("silêncio: sábado 19h espera terça 9h; com horário próprio na segunda, sai na hora", async () => {
    vi.setSystemTime(bahia("2026-10-17", "19:00"));
    await book(bahia("2026-10-20", "10:00"));
    expect((await db.select().from(proNotifications))[0].holdUntil?.toISOString()).toBe(bahia("2026-10-20", "09:00").toISOString());
    const own = { "0": null, "1": [["10:00", "14:00"]], "2": [["09:00", "18:00"]], "3": [["09:00", "18:00"]], "4": [["09:00", "18:00"]], "5": [["09:00", "18:00"]], "6": [["09:00", "18:00"]] } as WorkHours;
    await db.update(professionals).set({ workHours: own }).where(eq(professionals.id, maiara.pro));
    await db.delete(proNotifications);
    vi.setSystemTime(bahia("2026-10-19", "11:00"));
    await book(bahia("2026-10-21", "10:00"));
    expect((await db.select().from(proNotifications))[0].holdUntil).toBeNull();
  });

  it("a mesma mudança no mesmo minuto não avisa duas vezes", async () => {
    const { appointmentIds: [id] } = await book(bahia("2026-10-16", "10:00"));
    const appt = { id, professionalId: maiara.pro, startsAt: bahia("2026-10-16", "10:00"), status: "agendado", clientName: "Paula", serviceLabel: "Corte" };
    expect(await db.transaction((tx) => queueProNotificationsTx(tx, { kind: "novo", appointment: appt }, { actorId: recepcao, via: "recepcao" }))).toBe(0);
    expect(await db.select().from(proNotifications)).toHaveLength(1);
  });
});

describe("envio (job push-agenda) e a tela Avisos", () => {
  it("manda para os aparelhos dela, respeita o silêncio, tira o endereço 404/410 e não reenvia", async () => {
    vi.setSystemTime(bahia("2026-10-15", "07:30"));
    await book(bahia("2026-10-16", "10:00"));
    await db.insert(pushSubscriptions).values([
      { userId: maiara.user, endpoint: "https://fcm.googleapis.com/fcm/send/a1", p256dh: "k", auth: "a" },
      { userId: maiara.user, endpoint: "https://fcm.googleapis.com/fcm/send/a2", p256dh: "k", auth: "a" },
    ]);
    const calls: string[] = [];
    const sender: PushSender = async (s, payload) => { calls.push(`${s.endpoint.slice(-2)}|${JSON.parse(payload).title}`); return s.endpoint.endsWith("a2") ? 410 : 201; };
    expect(await sendPendingProNotifications(sender, bahia("2026-10-15", "08:00"))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await sendPendingProNotifications(sender, bahia("2026-10-15", "09:00"))).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(calls.sort()).toEqual(["a1|Horário novo", "a2|Horário novo"]);
    expect((await db.select().from(pushSubscriptions)).map((s) => s.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/a1"]);
    expect(await sendPendingProNotifications(sender, bahia("2026-10-15", "09:01"))).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it("aviso que passou mais de 2 h da hora de sair é marcado sem push (push ligado depois)", async () => {
    await book(bahia("2026-10-16", "10:00"));
    expect(await sendPendingProNotifications(async () => 201, bahia("2026-10-15", "13:00"))).toEqual({ sent: 0, failed: 0, skipped: 1 });
  });

  it("Avisos: os das últimas 48 h, e abrir marca como lidos", async () => {
    await book(bahia("2026-10-16", "10:00"));
    const me = (await resolvePro(maiara.user))!;
    expect((await listMyNotifications(me, bahia("2026-10-15", "12:00"))).map((n) => [n.title, n.read])).toEqual([["Horário novo", false]]);
    expect(await listMyNotifications(me, bahia("2026-10-17", "10:01"))).toEqual([]);
    expect(await markNotificationsRead(me, bahia("2026-10-15", "12:00"))).toBe(1);
    expect((await listMyNotifications(me, bahia("2026-10-15", "12:00")))[0].read).toBe(true);
  });
});
