import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { appointments, contacts, deals, lists, messages, professionals, professionalServices, settings, stages, users } from "@/server/db/schema";
import type { Actor } from "@/server/domain/agenda/actor";
import { permsFor } from "./perms";

type WorkHoursValue = (typeof professionals.$inferInsert)["workHours"];
/** 9h às 18h todos os dias: os testes não dependem do dia da semana nem do horário da Casa. */
export const ALL_DAYS = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [["09:00", "18:00"]]])) as WorkHoursValue;
/** O horário da Casa desde o Lote 0: ter–sáb, 9h–18h. */
export const CASA_TER_SAB = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
/** Instante de "dia de outubro de 2026, h:m em Salvador" (UTC−3). */
export const bahia = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 3, m));
/** Quinta, 15/10/2026, 09:00 em Salvador. */
export const NOW = bahia(15, 9);

export async function setSetting(key: string, value: unknown) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
export const setAgendaMode = (mode: "consulta" | "dupla" | "so_crm") => setSetting("agenda_modo", mode);

/** Modo dupla, a gestora e a Cati (Atendente: marca e encaixa, 6A), Corte (60 min, R$ 120), Hidratação (45 min, R$ 90), Mechas (sem duração), Ana e Bia (9h–18h). */
export async function setupAgenda() {
  await setAgendaMode("dupla");
  const [gestora, cati] = await db.insert(users).values([
    { name: "Thaíse Fiaes", email: "gestao@c.com", role: "gestor", passwordHash: "x" },
    { name: "Cati Souza", email: "cati@c.com", role: "atendente", passwordHash: "x", signature: "CATI" },
  ]).returning();
  const service = async (label: string, durationMin: number | null, priceCents: number | null) => {
    const [s] = await db.update(lists).set({ durationMin, priceCents, category: "Cabelo" }).where(and(eq(lists.kind, "service"), eq(lists.label, label))).returning();
    return s ?? (await db.insert(lists).values({ kind: "service", label, durationMin, priceCents, category: "Cabelo", position: 90 }).returning())[0];
  };
  const corte = await service("Corte", 60, 12000);
  const hidratacao = await service("Hidratação", 45, 9000);
  const mechas = await service("Mechas", null, null);
  const [ana, bia] = await db.insert(professionals).values([
    { name: "Ana", fullName: "Ana Lima", workHours: ALL_DAYS, agendaPosition: 1 },
    { name: "Bia", fullName: "Bia Santos", workHours: ALL_DAYS, agendaPosition: 2 },
  ]).returning();
  await db.insert(professionalServices).values([ana, bia].flatMap((p) => [corte, hidratacao, mechas].map((s) => ({ professionalId: p.id, serviceId: s.id }))));
  const equipe = permsFor("atendente"); // inclui agenda.marcar e agenda.encaixar (6A)
  const recepcao: Actor = { id: cati.id, perms: equipe };
  const semEncaixe: Actor = { id: cati.id, perms: equipe.filter((p) => p !== "agenda.encaixar") };
  const gestao: Actor = { id: gestora.id, perms: permsFor("gestor") };
  return { gestora, cati, corte, hidratacao, mechas, ana, bia, recepcao, semEncaixe, gestao };
}

let seq = 0;
/** Cliente com telefone único (+55 71 98800-0NNN). `conversaHaDias` cria uma mensagem; `stage` abre uma conversa nessa etapa. */
export async function cliente(name = "Paula Souza", o: { conversaHaDias?: number; stage?: string } = {}) {
  seq++;
  const phone = `+55719880${String(seq).padStart(5, "0")}`;
  const [c] = await db.insert(contacts).values({ name, phoneE164: phone }).returning();
  let dealId: string | null = null;
  if (o.stage) {
    const [st] = await db.select().from(stages).where(eq(stages.key, o.stage));
    const before = new Date(NOW.getTime() - 86_400_000);
    dealId = (await db.insert(deals).values({ contactId: c.id, stageId: st.id, stageEnteredAt: before, createdAt: before }).returning())[0].id;
  }
  if (o.conversaHaDias != null) {
    await db.insert(messages).values({ contactId: c.id, dealId, direction: "in", body: "oi", status: "received", createdAt: new Date(NOW.getTime() - o.conversaHaDias * 86_400_000) });
  }
  return { contactId: c.id, dealId, name, phone, digits: phone.slice(3) };
}

let k = 0;
/** Insere um horário direto no banco (Avec por padrão), como a importação faria. */
export const ap = (over: Partial<typeof appointments.$inferInsert> & { startsAt: Date }) =>
  db.insert(appointments).values({ serviceLabel: "Corte", status: "agendado", origin: "avec", externalKey: `t:${++k}`, durationMin: 60, ...over }).returning().then((r) => r[0]);
