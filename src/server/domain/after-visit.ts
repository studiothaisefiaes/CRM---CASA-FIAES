import { and, asc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { appointments, auditLog, contacts, outbox, satisfactionAnswers, settings } from "../db/schema";
import { UserFacingError } from "./errors";
import { enqueueAutomated } from "./outbox";
import { conversationOf } from "./client-link/reminder";
import { ensureVisitFor } from "./agenda/visits";
import { assertViradaParaLigar, assertViradaPronta, desfazerVirada } from "./virada";
import { genericClientSql } from "@/lib/generic-client";
import { onlyFirstName } from "@/lib/client-link";
import {
  AFTER_VISIT_DEFAULTS, AFTER_VISIT_LIMITS, AFTER_VISIT_SOURCE, SATISFACTION_OPTIONS, SURVEY_ALREADY, afterVisitSendAt, afterVisitTimingError, renderAfterVisit, type AfterVisitConfig,
} from "@/lib/after-visit";

export { AFTER_VISIT_DEFAULTS, AFTER_VISIT_SOURCE, type AfterVisitConfig, type AfterVisitMode } from "@/lib/after-visit";

/**
 * Depois do atendimento (Fase B, item 11): quando a visita é concluída (todos os horários que contam Finalizados), UMA mensagem para a
 * cliente `delayMinutes` depois, na janela de Salvador. Nasce DESLIGADO; o liga é o `mode` (a tela só liga pela Virada, Task 10).
 * Pausa, consentimento, Fornecedor e Spam valem na hora de enviar (`processItem`), como para tudo que é automático.
 */
const KEY = "depois_atendimento";
const HOUR_MS = 3_600_000;
const NO_LINK = "Ponha o link da Avaliação no Google para ligar o agradecimento.";

const int = (k: keyof typeof AFTER_VISIT_LIMITS, msg: string) =>
  z.number({ message: msg }).int(msg).min(AFTER_VISIT_LIMITS[k].min, msg).max(AFTER_VISIT_LIMITS[k].max, msg);
const texto = (what: string) => z.string().trim().min(10, `Escreva o texto ${what} (pelo menos 10 caracteres).`).max(1000, `Use até 1.000 caracteres no texto ${what}.`);
const fields = {
  mode: z.enum(["desligado", "agradecimento", "pesquisa"]),
  delayMinutes: int("delayMinutes", "O tempo depois do atendimento vai de 30 a 1.440 minutos."),
  janelaInicio: int("janelaInicio", "A janela começa entre 0h e 23h."),
  janelaFim: int("janelaFim", "A janela termina entre 1h e 24h."),
  horasMax: int("horasMax", "O limite vai de 1 a 72 horas."),
  textoAgradecimento: texto("do agradecimento"),
  tituloPesquisa: z.string().trim().min(10, "Escreva a pergunta da pesquisa (pelo menos 10 caracteres).").max(200, "Use até 200 caracteres na pergunta da pesquisa."),
  textoNotaAlta: texto("da nota alta"),
  linkGoogle: z.string().trim().max(300, "Use até 300 caracteres no link.").nullish().transform((s) => s || null)
    .refine((s) => !s || /^https:\/\/\S+$/.test(s), "O link da Avaliação no Google começa com https://"),
  notaAltaMin: z.union([z.literal(4), z.literal(5)]),
  textoNotaBaixa: z.string().trim().min(10, "Escreva o aviso da nota baixa (pelo menos 10 caracteres).").max(300, "Use até 300 caracteres no aviso da nota baixa."),
  etiquetaNotaBaixa: z.string().trim().min(1, "Escreva o nome da etiqueta da nota baixa.").max(30, "Use até 30 caracteres no nome da etiqueta."),
};
/** Validação cruzada: janela que começa antes de terminar e nenhuma combinação que cancelaria toda mensagem (`afterVisitTimingError`). */
export const afterVisitSchema = z.object(fields).superRefine((v, ctx) => {
  const message = afterVisitTimingError(v);
  if (message) ctx.addIssue({ code: "custom", message, path: [v.janelaInicio >= v.janelaFim ? "janelaFim" : "horasMax"] });
});

type Q = Tx | typeof db;

/** A configuração gravada; campo ausente ou inválido fica com o padrão (nunca derruba quem lê). */
export async function getAfterVisit(q: Q = db): Promise<AfterVisitConfig> {
  const [row] = await q.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY));
  const v = (row?.value && typeof row.value === "object" ? row.value : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...AFTER_VISIT_DEFAULTS };
  for (const [k, schema] of Object.entries(fields)) {
    const r = schema.safeParse(v[k]);
    if (r.success && r.data !== undefined) out[k] = r.data;
  }
  if ((out.janelaInicio as number) >= (out.janelaFim as number)) Object.assign(out, { janelaInicio: AFTER_VISIT_DEFAULTS.janelaInicio, janelaFim: AFTER_VISIT_DEFAULTS.janelaFim });
  return out as AfterVisitConfig;
}

/**
 * Salva com auditoria (ligou, desligou ou editou). O agradecimento só liga com o link da Avaliação no Google.
 * Virada (Task 10): ligar exige o checklist completo, um teste de verdade do mesmo modo dentro do prazo e `confirmouEnvio` (o aviso de
 * envio real da tela), também ao trocar agradecimento ↔ pesquisa com ele ligado; salvar ligado no mesmo modo exige o checklist completo.
 * Desligar nunca pede nada e zera o checklist.
 */
export async function saveAfterVisit(input: unknown, userId: string, opts?: { confirmouEnvio?: boolean }): Promise<void> {
  const v = afterVisitSchema.parse(input);
  if (v.mode === "agradecimento" && !v.linkGoogle) throw new UserFacingError(NO_LINK);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`);
    const before = await getAfterVisit(tx);
    const on = (m: string) => m !== "desligado";
    if (v.mode !== "desligado") {
      // Trocar agradecimento ↔ pesquisa com ele ligado é ligar o modo novo (outra mensagem para a cliente): teste desse modo e confirmação.
      if (before.mode !== v.mode) {
        await assertViradaParaLigar(tx, "depois", now, v.mode);
        if (opts?.confirmouEnvio !== true) throw new UserFacingError("Confirme o envio real para ligar.");
      } else await assertViradaPronta(tx, "depois");
    }
    await tx.insert(settings).values({ key: KEY, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: now } });
    await tx.insert(auditLog).values({ userId, action: on(v.mode) !== on(before.mode) ? (on(v.mode) ? "ligou" : "desligou") : "editou", entity: "settings", entityId: KEY, data: v });
    if (!on(v.mode) && on(before.mode)) await desfazerVirada(tx, "depois", userId, now);
  });
}

/** Ligado e com o que precisa (o agradecimento sem link não sai). */
const isActive = (cfg: AfterVisitConfig) => cfg.mode === "pesquisa" || (cfg.mode === "agradecimento" && !!cfg.linkGoogle);
/** A mensagem do Depois do atendimento está valendo (a API pede o escopo "enviar" para Finalizar quando está). */
export const afterVisitOn = isActive;

/**
 * A visita está concluída? Todos os horários que contam (sem os cancelados, a lista de espera e o gêmeo do Avec) estão Finalizados
 * (`compareceu`), e há pelo menos um. A conclusão é a do último: a hora do Finalizado (`finished_at`) ou, na baixa do Avec, `updated_at`.
 */
async function visitState(visitId: string): Promise<{ concludedAt: number; lastStart: number; contactId: string | null; name: string | null } | null> {
  const rows = await db.select({
    status: appointments.status, startsAt: appointments.startsAt, contactId: appointments.contactId,
    done: sql<string>`coalesce(${appointments.finishedAt}, ${appointments.updatedAt})`, name: sql<string | null>`coalesce(${contacts.name}, ${appointments.clientName})`,
  }).from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(and(eq(appointments.visitId, visitId), isNull(appointments.avecTwinOf), ne(appointments.status, "cancelado"), sql`${appointments.status} not like 'espera%'`))
    .orderBy(asc(appointments.startsAt));
  if (!rows.length || rows.some((r) => r.status !== "compareceu")) return null;
  return {
    concludedAt: Math.max(...rows.map((r) => new Date(r.done).getTime())), lastStart: Math.max(...rows.map((r) => r.startsAt.getTime())),
    contactId: rows[0].contactId, name: rows[0].name,
  };
}

const textFor = (cfg: AfterVisitConfig, name: string | null) =>
  renderAfterVisit(cfg.textoAgradecimento, { primeiro_nome: onlyFirstName(name) ?? "", link_google: cfg.linkGoogle ?? "" });
/** Título da enquete da Pesquisa de satisfação (o WhatsApp aceita até 255 caracteres). */
export const surveyTitle = (cfg: AfterVisitConfig, name: string | null) => {
  const t = renderAfterVisit(cfg.tituloPesquisa, { primeiro_nome: onlyFirstName(name) ?? "", link_google: cfg.linkGoogle ?? "" });
  return t.length > 255 ? `${t.slice(0, 254).trimEnd()}…` : t;
};
/** O que sai: o agradecimento (texto) ou a Pesquisa de satisfação (enquete de 1 a 5). Uma mensagem só, nunca as duas. */
export type AfterVisitMessage = { kind: "text"; text: string } | { kind: "poll"; text: string; options: string[] };
export const afterVisitMessageFor = (cfg: AfterVisitConfig, name: string | null): AfterVisitMessage =>
  cfg.mode === "pesquisa" ? { kind: "poll", text: surveyTitle(cfg, name), options: [...SATISFACTION_OPTIONS] } : { kind: "text", text: textFor(cfg, name) };

/**
 * Uma pesquisa só por visita (Task 9, fix 1): a visita já tem a mensagem do Depois do atendimento (`depois_atendimento:<visita>`), uma
 * pesquisa por regra (`options.visitId`) ou a linha da pesquisa? Ao enfileirar conta o que não foi cancelado; no envio (`atSend`), só o que
 * saiu ou pode ter saído (assim, duas na fila ao mesmo tempo: sai a primeira e a outra é cancelada). `exceptItemId`: o próprio item.
 */
export async function visitSurveyTaken(q: Q, visitId: string, o: { exceptItemId?: string; atSend?: boolean } = {}): Promise<boolean> {
  const [row] = await q.select({ id: satisfactionAnswers.id }).from(satisfactionAnswers).where(eq(satisfactionAnswers.visitId, visitId)).limit(1);
  if (row) return true;
  const [item] = await q.select({ id: outbox.id }).from(outbox).where(and(
    sql`(${outbox.options}->>'source' = ${`${AFTER_VISIT_SOURCE}${visitId}`} or ${outbox.options}->>'visitId' = ${visitId})`,
    o.atSend ? sql`${outbox.status} in ('sent', 'sending', 'failed')` : ne(outbox.status, "cancelled"),
    o.exceptItemId ? ne(outbox.id, o.exceptItemId) : undefined)).limit(1);
  return !!item;
}

/** A última visita Finalizada da cliente até `at` (a referência da pesquisa pela regra), ou null. */
export async function lastConcludedVisit(contactId: string, at: Date, q: Q = db): Promise<string | null> {
  const [last] = await q.select({ visitId: appointments.visitId }).from(appointments)
    .where(and(eq(appointments.contactId, contactId), eq(appointments.status, "compareceu"), sql`${appointments.visitId} is not null`, isNull(appointments.avecTwinOf),
      sql`${appointments.startsAt} <= ${at.toISOString()}::timestamptz`))
    .orderBy(sql`${appointments.startsAt} desc`).limit(1);
  return last?.visitId ?? null;
}

const hasItem = async (q: Q, source: string) => (await q.select({ id: outbox.id }).from(outbox).where(sql`${outbox.options}->>'source' = ${source}`).limit(1)).length > 0;

export type AfterVisitResult = "enfileirado" | "ja_tem" | "desligado" | "nao_concluida" | "sem_conversa" | "fora_do_prazo";

/**
 * Enfileira a mensagem da visita concluída (uma por visita, para sempre: o item que já existe, em qualquer situação, não é refeito).
 * Sai em `conclusão + delayMinutes`, na janela (fora dela, no início seguinte). Não enfileira o que já passou do limite (`horasMax`)
 * nem visita de dias atrás finalizada só agora (o início dela tem de estar a menos de `horasMax` + 24 h: a baixa do Avec do dia seguinte
 * entra; a visita da semana passada marcada hoje no "Sem desfecho", não). No modo `pesquisa` (Task 9) o item é a enquete de 1 a 5.
 * Chamada depois do commit pela porta única de status (Finalizado) e pelo fechar comanda, e pelo job `depois-atendimento` (Avec).
 */
export async function afterVisitDone(visitId: string, now = new Date()): Promise<AfterVisitResult> {
  const cfg = await getAfterVisit();
  if (!isActive(cfg)) return "desligado";
  const source = `${AFTER_VISIT_SOURCE}${visitId}`;
  if (await hasItem(db, source)) return "ja_tem";
  const v = await visitState(visitId);
  if (!v) return "nao_concluida";
  const limit = cfg.horasMax * HOUR_MS;
  const sendAt = afterVisitSendAt(Math.max(v.concludedAt + cfg.delayMinutes * 60_000, now.getTime()), cfg);
  if (now.getTime() - v.lastStart > limit + 24 * HOUR_MS || sendAt.getTime() - v.concludedAt > limit) return "fora_do_prazo";
  const dealId = await conversationOf(v.contactId);
  if (!dealId) return "sem_conversa";
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${source}))`); // Finalizado e comanda ao mesmo tempo: um só
    if (await hasItem(tx, source)) return "ja_tem";
    if (await visitSurveyTaken(tx, visitId)) return "ja_tem"; // a regra já mandou a pesquisa desta visita: uma mensagem só
    await enqueueAutomated({ dealId, ...afterVisitMessageFor(cfg, v.name), source, notBefore: sendAt }, tx);
    return "enfileirado";
  });
}

/** Ponto de chamada dos ganchos (o teste troca `done` para provar que o erro não derruba o Finalizado). */
export const afterVisitHook = { done: afterVisitDone };

/** Depois do commit (Finalizado na Agenda, comanda fechada): a visita de cada horário. Engole o erro: nunca derruba quem chamou. */
export async function afterVisitAfterCommit(appointmentIds: string[], now: Date): Promise<void> {
  const seen = new Set<string>();
  for (const id of appointmentIds) {
    try {
      const visitId = await ensureVisitFor(id);
      if (seen.has(visitId)) continue;
      seen.add(visitId);
      await afterVisitHook.done(visitId, now);
    } catch (e) { console.error("[depois do atendimento] não enfileirou", id, e instanceof Error ? e.message : e); }
  }
}

/**
 * Job `depois-atendimento` (worker, a cada 15 min): as visitas concluídas nas últimas `horasMax` horas que ainda não têm item. Pega a baixa
 * do Avec importada depois (o Finalizado do CRM já enfileirou na hora). Sem a CLIENTE PADRÃO e sem "Não é cliente". Só roda ligado.
 */
export async function runAfterVisit(now = new Date()): Promise<{ enqueued: number }> {
  const cfg = await getAfterVisit();
  if (!isActive(cfg)) return { enqueued: 0 };
  const limit = cfg.horasMax * HOUR_MS;
  const done = sql`coalesce(${appointments.finishedAt}, ${appointments.updatedAt})`;
  const rows = await db.select({ id: appointments.id, visitId: appointments.visitId }).from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(and(eq(appointments.status, "compareceu"), isNull(appointments.avecTwinOf), sql`coalesce(${contacts.ignored}, false) = false`, sql`not ${genericClientSql(appointments)}`,
      sql`${done} >= ${new Date(now.getTime() - limit).toISOString()}::timestamptz`, sql`${done} <= ${now.toISOString()}::timestamptz`,
      gte(appointments.startsAt, new Date(now.getTime() - limit - 24 * HOUR_MS)), lte(appointments.startsAt, now)))
    .orderBy(asc(appointments.startsAt));
  const seen = new Set<string>();
  let enqueued = 0;
  for (const r of rows) {
    const visitId = r.visitId ?? (await ensureVisitFor(r.id));
    if (seen.has(visitId)) continue;
    seen.add(visitId);
    if ((await afterVisitDone(visitId, now)) === "enfileirado") enqueued++;
  }
  return { enqueued };
}

/**
 * Reconferência na hora de enviar (`processItem`): ainda ligado, visita ainda concluída, dentro do limite desde a conclusão; e a mensagem
 * é refeita com a configuração de agora (como o lembrete): se o modo mudou depois de enfileirar, sai a do modo de agora (o agradecimento
 * ou a enquete, nunca os dois). Devolve o motivo de cancelar ou a mensagem.
 */
export async function afterVisitAtSend(source: string, now: Date, itemId?: string): Promise<{ cancel: string } | AfterVisitMessage> {
  const cfg = await getAfterVisit();
  if (cfg.mode === "desligado") return { cancel: "O Depois do atendimento foi desligado." };
  if (cfg.mode === "agradecimento" && !cfg.linkGoogle) return { cancel: "Falta o link da Avaliação no Google." };
  const v = await visitState(source.slice(AFTER_VISIT_SOURCE.length));
  if (!v) return { cancel: "A visita não está mais concluída." };
  if (now.getTime() - v.concludedAt > cfg.horasMax * HOUR_MS) return { cancel: `Passou de ${cfg.horasMax} h desde o atendimento.` };
  if (await visitSurveyTaken(db, source.slice(AFTER_VISIT_SOURCE.length), { exceptItemId: itemId, atSend: true })) return { cancel: SURVEY_ALREADY };
  return afterVisitMessageFor(cfg, v.name);
}
