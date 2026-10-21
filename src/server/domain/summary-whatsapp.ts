import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { alerts, auditLog, outbox, profiles, settings, users } from "../db/schema";
import { isPerm, can, type Perm } from "@/lib/permissions";
import { localHour } from "@/lib/daily-summary";
import { windowOfInstant } from "@/lib/business-hours";
import { summaryLinkHref } from "@/lib/report-links";
import { renderSummaryTitulo, SUMMARY_WHATSAPP_DEFAULTS, SUMMARY_WHATSAPP_LIMITS, SUMMARY_SOURCE, bahiaDay, type SummaryWhatsapp } from "@/lib/summary-whatsapp";
import { env } from "../env";
import { dailySummaryText } from "../reports/summary-text";
import { UserFacingError } from "./errors";
import { enqueueAutomated } from "./outbox";
import { getBusinessHours } from "./hours";
import { normalizePhone } from "./phone";
import { resolveContact } from "./deals";
import { setContactKind } from "./contact-kind";
import { startConversation } from "./start-conversation";

export { SUMMARY_SOURCE, type SummaryWhatsapp } from "@/lib/summary-whatsapp";

/**
 * Resumo do dia no WhatsApp da gestão (Fase B, item 16): o texto do resumo do Hoje sai por WhatsApp, na hora escolhida, para as pessoas escolhidas,
 * pela fila, na conversa de Equipe do número de cada uma. Nasce DESLIGADO; ligar pede a confirmação de envio real (no servidor também).
 * Não vai para cliente: a conversa de Equipe fica fora do funil e das métricas.
 */
const KEY = "resumo_whatsapp";
const L = SUMMARY_WHATSAPP_LIMITS;

const int = (min: number, max: number, msg: string) => z.number({ message: msg }).int(msg).min(min, msg).max(max, msg);
export const summaryWhatsappSchema = z.object({
  enabled: z.boolean(),
  destino: z.enum(["gestao", "escolhidas"]),
  hora: int(L.hora.min, L.hora.max, "A hora vai de 0h a 23h."),
  maxPessoas: int(L.maxPessoas.min, L.maxPessoas.max, "O limite de pessoas vai de 1 a 10."),
  soDiasAbertos: z.boolean(),
  titulo: z.string().trim().min(3, "Escreva a linha de abertura (pelo menos 3 caracteres).").max(120, "Use até 120 caracteres na linha de abertura."),
  numeros: z.array(z.object({ userId: z.string().min(1), phone: z.string().trim().max(40) })).max(50, "Muitas pessoas na lista."),
});

/** A configuração gravada; campo ausente ou inválido fica com o padrão (nunca derruba quem lê). */
export async function getSummaryWhatsapp(): Promise<SummaryWhatsapp> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY));
  const v = (row?.value && typeof row.value === "object" ? row.value : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...SUMMARY_WHATSAPP_DEFAULTS };
  for (const [k, schema] of Object.entries(summaryWhatsappSchema.shape)) {
    const r = schema.safeParse(v[k]);
    if (r.success) out[k] = r.data;
  }
  return out as SummaryWhatsapp;
}

type Person = { id: string; name: string; email: string; profileKey: string | null; perms: Perm[] };
async function peopleOf(ids: string[]): Promise<Map<string, Person>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, profileKey: profiles.key, permissions: profiles.permissions })
    .from(users).leftJoin(profiles, eq(profiles.id, users.profileId)).where(and(inArray(users.id, ids), eq(users.active, true)));
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, email: r.email, profileKey: r.profileKey, perms: (r.permissions ?? []).filter(isPerm) }]));
}

/**
 * Salva com auditoria (ligou, desligou ou editou). Ligar exige `confirmouEnvio` (o aviso de envio real da tela) e pelo menos uma pessoa com número;
 * toda pessoa da lista precisa ter "Ver números de toda a equipe", porque o resumo mostra a Casa inteira.
 */
export async function saveSummaryWhatsapp(input: unknown, userId: string, opts?: { confirmouEnvio?: boolean }): Promise<{ descartadas: number }> {
  const parsed = summaryWhatsappSchema.safeParse(input);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const raw = parsed.data;
  const seen = new Set<string>();
  const numeros = raw.numeros.map((n) => {
    const phone = normalizePhone(n.phone);
    if (!phone) throw new UserFacingError(`WhatsApp inválido: ${n.phone || "(vazio)"}. Use o DDD e o número.`);
    if (seen.has(n.userId)) throw new UserFacingError("A mesma pessoa aparece duas vezes na lista.");
    seen.add(n.userId);
    return { userId: n.userId, phone };
  });
  const people = await peopleOf(numeros.map((n) => n.userId));
  // Quem já estava salvo e saiu (desativada) ou perdeu "Ver números de toda a equipe" é descartado, nunca trava o salvamento (desligar tem de funcionar sempre).
  // Pessoa nova na lista é conferida a rigor.
  const before = new Set((await getSummaryWhatsapp()).numeros.map((n) => n.userId));
  const kept: SummaryWhatsapp["numeros"] = [];
  let descartadas = 0;
  for (const n of numeros) {
    const p = people.get(n.userId);
    const ok = !!p && can(p.perms, "relatorios.equipe");
    if (ok) { kept.push(n); continue; }
    if (before.has(n.userId)) { descartadas++; continue; }
    throw new UserFacingError(p ? `${p.name} não tem permissão para ver os números de toda a equipe.` : "Essa pessoa não está ativa no sistema.");
  }
  const v: SummaryWhatsapp = { ...raw, numeros: kept };
  if (v.enabled) {
    const alvo = v.destino === "gestao" ? kept.filter((n) => people.get(n.userId)?.profileKey === "gestao") : kept;
    if (!alvo.length) throw new UserFacingError(v.destino === "gestao" ? "Ponha o WhatsApp de pelo menos uma pessoa da Gestão." : "Escolha pelo menos uma pessoa e ponha o WhatsApp dela.");
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`);
    const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY));
    const wasOn = (row?.value as { enabled?: boolean } | undefined)?.enabled === true;
    if (v.enabled && !wasOn && opts?.confirmouEnvio !== true) throw new UserFacingError("Confirme o envio real para ligar.");
    await tx.insert(settings).values({ key: KEY, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId, action: v.enabled !== wasOn ? (v.enabled ? "ligou" : "desligou") : "editou", entity: "settings", entityId: KEY, data: { ...v, descartadas } });
  });
  return { descartadas };
}

/**
 * Acha ou cria o contato pelo número, marca como Equipe e acha ou cria a conversa dele, SEM mandar nada.
 * Usada pelo resumo do dia e pelo teste de envio da Virada. Contato em Spam não vira Equipe sozinho: a pessoa tira de Spam antes.
 */
export async function ensureTeamConversation(phone: string): Promise<{ contactId: string; dealId: string }> {
  const e164 = normalizePhone(phone);
  if (!e164) throw new UserFacingError(`WhatsApp inválido: ${phone || "(vazio)"}. Use o DDD e o número.`);
  const c = await db.transaction((tx) => resolveContact(tx, e164, null));
  if (!c) throw new UserFacingError("Não deu para achar o contato desse número.");
  if (c.kind === "spam") throw new UserFacingError("Esse número está marcado como spam. Marque como Equipe na ficha antes de usar.");
  if (c.kind !== "equipe") await setContactKind(c.id, "equipe", null);
  const { dealId } = await startConversation(c.id, null);
  return { contactId: c.id, dealId };
}

/** Quem recebe agora: a Gestão com número (destino "gestao") ou as escolhidas, sempre com "Ver números de toda a equipe", até `maxPessoas`. */
async function recipients(cfg: SummaryWhatsapp): Promise<{ person: Person; phone: string }[]> {
  const people = await peopleOf(cfg.numeros.map((n) => n.userId));
  const out: { person: Person; phone: string }[] = [];
  for (const n of cfg.numeros) {
    const person = people.get(n.userId);
    if (!person || !can(person.perms, "relatorios.equipe")) continue;
    if (cfg.destino === "gestao" && person.profileKey !== "gestao") continue;
    out.push({ person, phone: n.phone });
  }
  return out.slice(0, cfg.maxPessoas);
}

/** O resumo da pessoa para o WhatsApp: o texto do Hoje com o título "Resumo do dia" e os atalhos como endereços completos (APP_URL). */
async function summaryMessage(p: Person, titulo: string, now: Date): Promise<string> {
  const s = await dailySummaryText({ id: p.id, name: p.name, email: p.email, perms: p.perms }, now);
  const [heading, ...lines] = s.text.split("\n");
  const day = /\((.*)\)/.exec(heading)?.[1];
  const base = env().APP_URL.replace(/\/+$/, "");
  const links = s.links.flatMap((l) => { const href = summaryLinkHref(l.href); return href ? [`${l.label}: ${base}${href}`] : []; });
  return [renderSummaryTitulo(titulo, day ?? ""), ...lines, ...(links.length ? ["", ...links] : [])].join("\n");
}

export type SummaryWhatsappResult = { enqueued: number; skipped: "desligado" | "fora_da_hora" | "casa_nao_abriu" | null };

/**
 * Roda de hora em hora: só enfileira quando a hora de Salvador é a escolhida e, com "só em dias abertos", a Casa abre naquele dia (Dias especiais
 * valem). Uma mensagem por dia e por pessoa (`resumo_dia:<AAAA-MM-DD>:<userId>`): rodar de novo não duplica.
 */
export async function runSummaryWhatsapp(now: Date = new Date()): Promise<SummaryWhatsappResult> {
  const cfg = await getSummaryWhatsapp();
  if (!cfg.enabled) return { enqueued: 0, skipped: "desligado" };
  if (localHour(now) !== cfg.hora) return { enqueued: 0, skipped: "fora_da_hora" };
  if (cfg.soDiasAbertos && !windowOfInstant(now.getTime(), await getBusinessHours())) return { enqueued: 0, skipped: "casa_nao_abriu" };
  const day = bahiaDay(now);
  let enqueued = 0;
  for (const { person, phone } of await recipients(cfg)) {
    const source = `${SUMMARY_SOURCE}${day}:${person.id}`;
    const has = async (q: typeof db) => (await q.select({ id: outbox.id }).from(outbox).where(sql`${outbox.options}->>'source' = ${source}`).limit(1)).length > 0;
    if (await has(db)) continue;
    try {
      const text = await summaryMessage(person, cfg.titulo, now);
      const { dealId } = await ensureTeamConversation(phone);
      const queued = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${source}))`);
        if (await has(tx as unknown as typeof db)) return false;
        await enqueueAutomated({ dealId, kind: "text", text, source, at: now }, tx);
        return true;
      });
      if (queued) enqueued++;
    } catch (e) {
      console.error("[resumo no WhatsApp] não enfileirou", person.id, e instanceof Error ? e.message : e);
      // Falha por pessoa: a gestão fica sabendo (um aviso por dia e por pessoa).
      const why = e instanceof UserFacingError ? e.message : "erro inesperado; veja o registro do servidor";
      await db.insert(alerts).values({ audience: "gestao", type: "envio_automatico_falhou", severity: "info",
        message: `O resumo do dia não foi para ${person.name}: ${why}`, dedupeKey: `resumo_falhou:${day}:${person.id}` }).onConflictDoNothing()
        .catch((err) => console.error("[resumo no WhatsApp] não criou o aviso", err instanceof Error ? err.message : err));
    }
  }
  return { enqueued, skipped: null };
}

/** Na hora de sair: o resumo só vai se a função continua ligada (a gestão pode desligar com ele na fila). */
export async function summaryCancelReason(): Promise<string | null> {
  return (await getSummaryWhatsapp()).enabled ? null : "O resumo do dia no WhatsApp foi desligado.";
}
