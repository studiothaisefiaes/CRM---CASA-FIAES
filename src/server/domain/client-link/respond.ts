import { eq } from "drizzle-orm";
import { db } from "../../db";
import { alerts, clientLinks, type ClientLink } from "../../db/schema";
import { allow } from "../../auth/rate-limit";
import { UserFacingError } from "../errors";
import { emit, logEvent } from "../events";
import { findOpenDeal } from "../deals";
import { createTaskTx } from "../tasks";
import { cancelMany, changeStatus } from "../agenda/ports";
import { cancelouAlertKey, remarcarAlertKey } from "@/lib/alert-links";
import { dayOf } from "@/lib/agenda";
import { hourText, linkPageState, onlyFirstName, shortDay } from "@/lib/client-link";
import { liveLink, visitAppointments, visitPaid, WINDOW_MS, type VisitAppt } from "./links";
import { getClientLinkSettings } from "./settings";

export const CANCEL_REASONS = { nao_vou_conseguir: "Não vou conseguir ir", saude: "Problema de saúde", imprevisto: "Imprevisto", outro: "Outro" } as const;
export const ACTION_IP_LIMIT = 10;
export const ACTION_LINK_LIMIT = 5;
const TOO_MANY = "Muitas tentativas. Espere alguns minutos.";
type Ctx = { ip: string; now?: Date };

/**
 * O que toda ação do link confere, nesta ordem:
 * 1. limite por IP;
 * 2. link vivo;
 * 3. limite por link;
 * 4. visita cancelada;
 * 5. o horário que a página mostrou (aba antiga é recusada);
 * 6. já aconteceu ou é pedido do site.
 */
async function prepare(token: string, shownStart: string, now: Date, ip: string) {
  if (!allow(`link-acao-ip:${ip}`, ACTION_IP_LIMIT, WINDOW_MS, now.getTime())) throw new UserFacingError(TOO_MANY);
  const link = await liveLink(token, now);
  if (!link) throw new UserFacingError("Este link não vale mais. Fale com a Casa pelo WhatsApp.");
  if (!allow(`link-acao:${link.id}`, ACTION_LINK_LIMIT, WINDOW_MS, now.getTime())) throw new UserFacingError(TOO_MANY);
  const [appts, cfg] = await Promise.all([visitAppointments(link.visitId), getClientLinkSettings()]);
  const page = linkPageState(appts, link.issuedStartsAt, now, cfg.cancelarAteHoras);
  if (page.state === "cancelado") throw new UserFacingError("Este horário foi cancelado.");
  if (page.start.toISOString() !== shownStart) throw new UserFacingError("O horário mudou. Atualize a página.");
  if (page.state === "aconteceu") throw new UserFacingError("Esse horário já passou.");
  if (page.state === "solicitado") throw new UserFacingError("A Casa ainda vai confirmar esse pedido.");
  return { link, appts, page, cfg };
}

/** Grava o que a cliente fez no link, no histórico da conversa aberta dela, e avisa as telas. */
async function afterAction(link: ClientLink, appts: VisitAppt[], acao: "confirmou" | "pediu_remarcar" | "cancelou", extra: Record<string, unknown>, now: Date) {
  await db.update(clientLinks).set({ lastAction: acao, lastActionAt: now }).where(eq(clientLinks.id, link.id));
  const contactId = appts.find((a) => a.contactId)?.contactId;
  const deal = contactId ? await findOpenDeal(contactId) : null;
  if (deal) { await logEvent(db, deal.id, "link_cliente", { acao, ...extra }); await emit("lead_atualizado", { dealId: deal.id }); }
  if (appts[0]) await emit("agenda_alterada", { day: dayOf(appts[0].startsAt) });
}

/** "Confirmar presença": todos os horários agendados da visita viram confirmados pela porta do 6B (`via = 'link'`). Repetir não muda nada. */
export async function confirmByLink(token: string, shownStart: string, ctx: Ctx): Promise<{ message: string }> {
  const now = ctx.now ?? new Date();
  const { link, appts } = await prepare(token, shownStart, now, ctx.ip);
  let changed = 0;
  for (const a of appts.filter((x) => x.status === "agendado")) if ((await changeStatus({ appointmentId: a.id, status: "confirmado", actorId: null, via: "link", now })).changed) changed++;
  if (changed || link.lastAction === "pediu_remarcar") await afterAction(link, appts, "confirmou", {}, now); // também "mudei de ideia, vou manter"
  return { message: "Pronto! Seu horário está confirmado. Te esperamos!" };
}

/**
 * "Preciso remarcar": não cancela (decisão 15). Com conversa aberta, vira combinado para a dona (o `createTaskTx` acha quem é).
 * Sem conversa, avisa a gestão no sino, com a ficha. A sugestão de dia vai junto. Toque repetido em 10 min não duplica.
 */
export async function requestRescheduleByLink(token: string, shownStart: string, wish: string | null, ctx: Ctx): Promise<{ message: string }> {
  const now = ctx.now ?? new Date();
  const { link, appts, page } = await prepare(token, shownStart, now, ctx.ip);
  const message = "Pronto! A Casa vai te chamar no WhatsApp para combinar outro horário.";
  if (link.lastAction === "pediu_remarcar" && link.lastActionAt && now.getTime() - link.lastActionAt.getTime() < WINDOW_MS) return { message };
  const text = (wish ?? "").trim().replace(/\s+/g, " ").slice(0, 200) || null;
  const contactId = appts.find((a) => a.contactId)?.contactId ?? null;
  const deal = contactId ? await findOpenDeal(contactId) : null;
  if (deal) {
    await db.transaction((tx) => createTaskTx(tx, { dealId: deal.id, contactId: deal.contactId, kind: "proxima_acao", dueAt: now,
      title: `Remarcar (pediu pelo link)${text ? `: ${text.slice(0, 80)}` : ""}`, meta: { origem: "link_cliente" } }, null));
  }
  const who = onlyFirstName(appts[0]?.name) ?? "A cliente";
  const base = `${who} pediu para remarcar pelo link (${shortDay(page.start)} às ${hourText(page.start)})${text ? `: "${text}"` : ""}.`;
  const key = remarcarAlertKey(contactId, link.id, now);
  if (deal) {
    // Psico r68 #9: nunca silencioso. Urgente no sino (e push) da dona da conversa e da gestão; o toque abre a conversa.
    const message = `${base} Toque para abrir a conversa.`;
    const rows = [{ userId: null as string | null, audience: "gestao", dedupeKey: `${key}:gestao` }];
    if (deal.ownerId) rows.push({ userId: deal.ownerId, audience: "responsavel", dedupeKey: `${key}:dona` });
    await db.insert(alerts).values(rows.map((r) => ({ ...r, dealId: deal.id, type: "link_remarcar", severity: "urgente", message }))).onConflictDoNothing();
  } else {
    await db.insert(alerts).values({ userId: null, dealId: null, audience: "gestao", type: "link_remarcar", severity: "info", dedupeKey: key,
      message: `${base} Ela não tem conversa aberta: abra a ficha.` }).onConflictDoNothing();
  }
  await emit("alerta", { aviso: true });
  await afterAction(link, appts, "pediu_remarcar", { sugestao: text }, now);
  return { message };
}

/** "Cancelar": motivo obrigatório e só até `cancelarAteHoras` antes; cancela os horários ativos da visita pela porta do 6B (funil, aviso à profissional, lista de espera). */
export async function cancelByLink(token: string, shownStart: string, input: { motivo: string; texto?: string | null }, ctx: Ctx): Promise<{ message: string }> {
  const now = ctx.now ?? new Date();
  const { link, appts, page, cfg } = await prepare(token, shownStart, now, ctx.ip);
  // Pagou antes (7.9): cancelar visita paga é da gestão, cancelando a comanda. A cliente fala com a Casa.
  if (await visitPaid(appts.map((a) => a.id))) throw new UserFacingError("Esse horário já foi pago: para cancelar, fale com a Casa pelo WhatsApp.");
  if (!page.canCancel) throw new UserFacingError(`Faltam menos de ${cfg.cancelarAteHoras} horas: fale com a Casa pelo WhatsApp.`);
  if (!(input.motivo in CANCEL_REASONS)) throw new UserFacingError("Escolha o motivo.");
  const motivo = input.motivo as keyof typeof CANCEL_REASONS;
  const texto = (input.texto ?? "").trim().replace(/\s+/g, " ");
  if (motivo === "outro" && texto.length < 3) throw new UserFacingError("Escreva o motivo.");
  if (texto.length > 200) throw new UserFacingError("Use até 200 caracteres.");
  const note = motivo === "outro" ? texto : `${CANCEL_REASONS[motivo]}${texto ? `: ${texto}` : ""}`;
  const ids = appts.filter((a) => a.status === "agendado" || a.status === "confirmado").map((a) => a.id);
  await cancelMany({ appointmentIds: ids, reason: "cliente_desmarcou", note, actorId: null, via: "link", now });
  // P7 (17/10): sem isso ninguém via o cancelamento (só a grade mudava) e o horário vago não era reaproveitado. Aviso no sino da gestão,
  // com ou sem conversa aberta; o toque abre o horário cancelado na Agenda.
  if (ids.length) {
    const who = onlyFirstName(appts[0]?.name) ?? "A cliente";
    await db.insert(alerts).values({ userId: null, dealId: null, audience: "gestao", type: "link_cancelou", severity: "info", dedupeKey: cancelouAlertKey(ids[0], dayOf(page.start)),
      message: `${who} cancelou pelo link o horário de ${shortDay(page.start)} às ${hourText(page.start)}. Motivo: ${note}. O horário ficou livre.` }).onConflictDoNothing();
    await emit("alerta", {});
  }
  await afterAction(link, appts, "cancelou", { motivo: note }, now);
  return { message: "Pronto, seu horário foi cancelado. Quando quiser marcar de novo, é só chamar a Casa no WhatsApp." };
}
