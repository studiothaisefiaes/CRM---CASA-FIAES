import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db";
import { appointments, auditLog, clientLinks, comandaItems, comandas, contacts, deals, lists, professionals, type ClientLink } from "../../db/schema";
import { hashToken, newShortToken, SHORT_ALPHABET, SHORT_LEN } from "../../auth/tokens";
import { allow, blocked } from "../../auth/rate-limit";
import { env } from "../../env";
import { clientLinkBase } from "@/lib/client-host";
import { UserFacingError } from "../errors";
import { visitIdFor } from "../agenda/ports";
import {
  changedNotice, dayParts, hourText, LINK_ACTIVE, linkExpiry, linkPageState, mapsLink, onlyFirstName, renderLinkText, servicesText, shortDay, waLink, whenLine,
  type LinkAppt, type LinkPage,
} from "@/lib/client-link";
import { buildIcs } from "@/lib/ics";
import { getCasaInfo, getClientLinkSettings } from "./settings";

export const BAD_OPEN_LIMIT = 30;
export const WINDOW_MS = 10 * 60_000;
/** Os dois formatos que valem: o curto de agora (8 símbolos sem 0/O/1/l/I) e o longo dos links antigos (43, base64url). */
const TOKEN_RE = new RegExp(`^(?:[${SHORT_ALPHABET}]{${SHORT_LEN}}|[A-Za-z0-9_-]{43})$`);
/** Tentativas de sortear um código que ainda não existe (com 10^14 códigos, a 2ª já é praticamente impossível). */
const TOKEN_TRIES = 5;

/** O endereço que vai para a cliente: CLIENT_LINK_URL (domínio dela) ou, sem ele, o APP_URL. */
export const clientLinkUrl = (token: string) => `${clientLinkBase(env())}/c/${token}`;

export type VisitAppt = LinkAppt & { id: string; contactId: string | null; name: string | null };
export type CreatedLink = { url: string; text: string; visitId: string; start: Date; expiresAt: Date };
export type LinkView = {
  firstName: string | null; state: LinkPage["state"]; services: string; when: string;
  /** O destaque do dia e da hora (relógio de Salvador) e cada serviço com a profissional. */
  day: { weekday: string; day: string; month: string }; startHour: string; endHour: string | null; items: { service: string; pro: string | null }[]; changedNotice: string | null; canAct: boolean; canCancel: boolean;
  /** Ela já tocou em "Preciso remarcar": a página não pede mais "Confirmar presença" (psico r68 #30). */ remarcarPedido: boolean;
  /** O início que a página mostrou: volta com cada ação, que é recusada se o horário mudou. */
  shownStart: string;
  address: string | null; mapsUrl: string | null; whatsappUrl: string | null; cancelarAteHoras: number;
};
export type LinkOpen = { kind: "limite" } | { kind: "invalido" } | { kind: "ok"; view: LinkView };

/** A principal de quem é assistente (17/10): o que a cliente vê usa o nome dela. */
const principal = alias(professionals, "principal");

/**
 * Os horários da visita (sem lista de espera e sem gêmeo), com a duração do horário (senão a do serviço) e o apelido da profissional.
 * É o que a CLIENTE vê (link, lembrete, remarcado): `pro` é quem atende para ela, a principal quando a profissional é assistente
 * (17/10: Sidney, assistente de Thaise, aparece como Thaise).
 */
export async function visitAppointments(visitId: string): Promise<VisitAppt[]> {
  const rows = await db.select({
    id: appointments.id, startsAt: appointments.startsAt, durationMin: sql<number | null>`coalesce(${appointments.durationMin}, ${lists.durationMin})`,
    status: appointments.status, service: appointments.serviceLabel, pro: sql<string | null>`coalesce(${principal.name}, ${professionals.name})`, contactId: appointments.contactId,
    name: sql<string | null>`coalesce(${contacts.name}, ${appointments.clientName})`,
  }).from(appointments).leftJoin(professionals, eq(professionals.id, appointments.professionalId)).leftJoin(principal, eq(principal.id, professionals.assistantOf))
    .leftJoin(lists, eq(lists.id, appointments.serviceId)).leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(and(eq(appointments.visitId, visitId), isNull(appointments.avecTwinOf), sql`${appointments.status} not like 'espera%'`))
    // Mesma hora: na ordem em que entraram (sem o desempate, a ordem dependia do plano do Postgres e o texto do lembrete trocava).
    .orderBy(asc(appointments.startsAt), asc(appointments.createdAt), asc(appointments.id));
  return rows;
}

/** Algum horário da visita já está numa comanda fechada (pagou antes, 7.9)? Visita paga só a gestão cancela, cancelando a comanda. */
export async function visitPaid(appointmentIds: string[]): Promise<boolean> {
  if (!appointmentIds.length) return false;
  const [r] = await db.select({ id: comandaItems.id }).from(comandaItems).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId))
    .where(and(inArray(comandaItems.appointmentId, appointmentIds), isNull(comandaItems.cancelledAt), eq(comandas.status, "fechada"))).limit(1);
  return !!r;
}

/** O horário futuro mais próximo (agendado ou confirmado) da cliente da conversa. */
async function nextAppointmentOfDeal(dealId: string, now: Date): Promise<string | null> {
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  if (!d) return null;
  const [a] = await db.select({ id: appointments.id }).from(appointments)
    .where(and(eq(appointments.contactId, d.contactId), inArray(appointments.status, ["agendado", "confirmado"]), isNull(appointments.avecTwinOf), gt(appointments.startsAt, now)))
    .orderBy(asc(appointments.startsAt)).limit(1);
  return a?.id ?? null;
}

/**
 * Gera o link da visita (gerar não é enviar: quem envia é a atendente). No banco vai só o hash do token. A validade é o menor entre
 * (fim do último serviço + 24 h) e (agora + 60 dias). Vários links da mesma visita podem valer ao mesmo tempo. O token nunca vai para log.
 */
export async function createClientLink(input: { appointmentId?: string; dealId?: string; via: "conversa" | "agenda" | "lembrete_d1"; actorId: string | null; template?: string; now?: Date }): Promise<CreatedLink> {
  const now = input.now ?? new Date();
  const appointmentId = input.appointmentId ?? (input.dealId ? await nextAppointmentOfDeal(input.dealId, now) : null);
  if (!appointmentId) throw new UserFacingError("Ela não tem horário marcado na agenda. Marque na Agenda para gerar o link.");
  const [a] = await db.select({ status: appointments.status, startsAt: appointments.startsAt, twin: appointments.avecTwinOf }).from(appointments).where(eq(appointments.id, appointmentId));
  if (!a || a.twin) throw new UserFacingError("Horário não encontrado.");
  if (a.status !== "agendado" && a.status !== "confirmado") throw new UserFacingError("Só dá para gerar o link de horário agendado ou confirmado.");
  if (a.startsAt.getTime() <= now.getTime()) throw new UserFacingError("Esse horário já passou.");
  const visitId = await visitIdFor(appointmentId);
  const appts = (await visitAppointments(visitId)).filter((x) => (LINK_ACTIVE as readonly string[]).includes(x.status));
  const page = linkPageState(appts, appts[0]?.startsAt ?? a.startsAt, now, 0);
  const lastEnd = new Date(Math.max(...appts.map((x) => x.startsAt.getTime() + (x.durationMin ?? 0) * 60_000)));
  const expiresAt = linkExpiry(lastEnd, now);
  // Código já usado (raríssimo): o índice único recusa sem abortar a transação e sorteia outro.
  const token = await db.transaction(async (tx) => {
    for (let i = 0; i < TOKEN_TRIES; i++) {
      const t = newShortToken();
      const [row] = await tx.insert(clientLinks).values({ tokenHash: hashToken(t), visitId, issuedStartsAt: page.start, createdBy: input.actorId, createdVia: input.via, createdAt: now, expiresAt })
        .onConflictDoNothing({ target: clientLinks.tokenHash }).returning({ id: clientLinks.id });
      if (!row) continue;
      await tx.insert(auditLog).values({ userId: input.actorId, action: "gerou_link_cliente", entity: "visit", entityId: visitId, data: { via: input.via, hash: hashToken(t).slice(0, 8) } });
      return t;
    }
    throw new Error("não consegui sortear um código de link livre");
  });
  const url = clientLinkUrl(token);
  const tpl = input.template ?? (await getClientLinkSettings()).texto;
  const text = renderLinkText(tpl, { primeiro_nome: onlyFirstName(appts[0]?.name) ?? "", data: shortDay(page.start), hora: hourText(page.start), servicos: servicesText(page.items), link: url });
  return { url, text, visitId, start: page.start, expiresAt };
}

/** O link vivo pelo token (no banco, só o hash). Formato errado nem consulta. Vencido ou revogado: null. */
export async function liveLink(token: string, now: Date): Promise<ClientLink | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [l] = await db.select().from(clientLinks).where(eq(clientLinks.tokenHash, hashToken(token)));
  return l && !l.revokedAt && l.expiresAt.getTime() > now.getTime() ? l : null;
}

async function buildView(link: ClientLink, now: Date): Promise<LinkView> {
  const [appts, casa, cfg] = await Promise.all([visitAppointments(link.visitId), getCasaInfo(), getClientLinkSettings()]);
  const page = linkPageState(appts, link.issuedStartsAt, now, cfg.cancelarAteHoras);
  const paid = page.canCancel && (await visitPaid(appts.map((a) => a.id)));
  const first = onlyFirstName(appts[0]?.name);
  return {
    firstName: first, state: page.state, services: servicesText(page.items), when: whenLine(page.start, page.end),
    day: dayParts(page.start), startHour: hourText(page.start), endHour: page.end ? hourText(page.end) : null, items: page.items.map((i) => ({ service: i.service, pro: i.pro })),
    changedNotice: page.changed && page.state !== "cancelado" ? changedNotice(page.start) : null,
    canAct: page.canAct, canCancel: page.canCancel && !paid, remarcarPedido: link.lastAction === "pediu_remarcar", shownStart: page.start.toISOString(),
    address: casa.endereco, mapsUrl: casa.endereco ? mapsLink(casa.endereco) : null,
    whatsappUrl: waLink(casa.whatsapp, `Oi! Sou ${first ?? "cliente da Casa"} e preciso falar sobre meu horário de ${shortDay(page.start)} às ${hourText(page.start)}.`),
    cancelarAteHoras: cfg.cancelarAteHoras,
  };
}

/**
 * Abre o link (página pública, sem login). Link errado, vencido ou revogado: a mesma página genérica, sem dizer qual dos dois.
 * Com 30 aberturas com link errado por IP em 10 min, tudo daquele IP vira "Muitas tentativas". Conta as aberturas.
 * Nunca devolve id interno nem dado além do primeiro nome.
 */
export async function openClientLink(token: string, ctx: { ip: string; now?: Date; count?: boolean }): Promise<LinkOpen> {
  const now = ctx.now ?? new Date();
  const badKey = `link-ruim:${ctx.ip}`;
  if (blocked(badKey, BAD_OPEN_LIMIT, WINDOW_MS, now.getTime())) return { kind: "limite" };
  const link = await liveLink(token, now);
  if (!link) { allow(badKey, BAD_OPEN_LIMIT, WINDOW_MS, now.getTime()); return { kind: "invalido" }; }
  if (ctx.count !== false) {
    await db.update(clientLinks).set({ openCount: sql`${clientLinks.openCount} + 1`, firstOpenedAt: sql`coalesce(${clientLinks.firstOpenedAt}, ${now.toISOString()}::timestamptz)`, lastOpenedAt: now })
      .where(eq(clientLinks.id, link.id));
  }
  return { kind: "ok", view: await buildView(link, now) };
}

/** O .ics da visita (seção 9.4.8): UID da visita, horários em UTC, sem o nome da cliente. Visita cancelada ou link inválido: null. */
export async function icsForToken(token: string, ctx: { ip: string; now?: Date }): Promise<string | null> {
  const now = ctx.now ?? new Date();
  const badKey = `link-ruim:${ctx.ip}`;
  if (blocked(badKey, BAD_OPEN_LIMIT, WINDOW_MS, now.getTime())) return null;
  const link = await liveLink(token, now);
  if (!link) { allow(badKey, BAD_OPEN_LIMIT, WINDOW_MS, now.getTime()); return null; }
  const [appts, casa] = await Promise.all([visitAppointments(link.visitId), getCasaInfo()]);
  const page = linkPageState(appts, link.issuedStartsAt, now, 0);
  if (page.state === "cancelado") return null;
  return buildIcs({ uid: `${link.visitId}@casafiaes`, start: page.start, end: page.end, summary: `Casa Fiaes · ${servicesText(page.items)}`, location: casa.endereco,
    description: `Para confirmar, remarcar ou cancelar: ${clientLinkUrl(token)}`, now });
}
