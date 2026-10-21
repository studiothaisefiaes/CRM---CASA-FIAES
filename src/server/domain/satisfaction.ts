import { and, asc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, appointments, contacts, deals, lists, outbox, professionals, satisfactionAnswers } from "../db/schema";
import { can } from "@/lib/permissions";
import { onlyFirstName } from "@/lib/client-link";
import { clientLabel } from "@/lib/alert-copy";
import {
  AFTER_VISIT_SOURCE, SATISFACTION_HIGH_SOURCE, SATISFACTION_OPTIONS, isSatisfactionPoll, renderAfterVisit, renderNotaBaixa, scoreOf,
} from "@/lib/after-visit";
import { getAfterVisit, lastConcludedVisit } from "./after-visit";
import { enqueueAutomated } from "./outbox";
import { addTag, removeTagTx, tagByName } from "./tags";
import { emit } from "./events";

export { SATISFACTION_OPTIONS, scoreOf };

/**
 * Pesquisa de satisfação (Fase B, Task 9, item 12). No modo `pesquisa` do Depois do atendimento (ou pela regra "Mandar a Pesquisa de
 * satisfação") a cliente recebe uma enquete de 1 a 5. Quando ela sai, a linha em `satisfaction_answers` guarda quem fez e o que fez.
 * O voto (vale o último): nota alta (a partir de `notaAltaMin`) recebe UMA vez a mensagem com o link do Google; nota baixa NÃO manda nada
 * para a cliente: avisa a gestão (`nota:<enquete>`) e põe a etiqueta. Mudar para nota alta resolve o aviso.
 */

const DAY_MS = 86_400_000;

/** As profissionais e os serviços que contam na visita (sem os cancelados, a lista de espera e o gêmeo do Avec), sem repetir. */
async function visitPeople(visitId: string): Promise<{ professionalIds: string[]; serviceIds: string[] }> {
  const rows = await db.select({ pro: appointments.professionalId, svc: appointments.serviceId }).from(appointments)
    .where(and(eq(appointments.visitId, visitId), isNull(appointments.avecTwinOf), ne(appointments.status, "cancelado"), sql`${appointments.status} not like 'espera%'`))
    .orderBy(asc(appointments.startsAt));
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return { professionalIds: uniq(rows.map((r) => r.pro)), serviceIds: uniq(rows.map((r) => r.svc)) };
}

/**
 * A enquete saiu (fila, `processItem`): grava a pergunta. A visita vem do item do Depois do atendimento; pela regra, é a última visita
 * Finalizada da cliente (sem nenhuma, a linha fica sem visita e sem quem fez). Idempotente pela mensagem da enquete.
 */
export async function recordSatisfactionAsked(input: { messageId: string; dealId: string; source?: string; visitId?: string; at: Date }): Promise<void> {
  const [deal] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, input.dealId));
  if (!deal) return;
  const visitId = input.source?.startsWith(AFTER_VISIT_SOURCE) ? input.source.slice(AFTER_VISIT_SOURCE.length)
    : input.visitId ?? await lastConcludedVisit(deal.contactId, input.at);
  const people = visitId ? await visitPeople(visitId) : { professionalIds: [], serviceIds: [] };
  await db.insert(satisfactionAnswers).values({ visitId, dealId: input.dealId, contactId: deal.contactId, pollMessageId: input.messageId, askedAt: input.at, ...people })
    .onConflictDoNothing();
}

/** Nomes na ordem dos ids (serviços pela Lista, profissionais pelo cadastro). */
async function namesOf(table: "lists" | "professionals", ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = table === "lists"
    ? await db.select({ id: lists.id, name: lists.label }).from(lists).where(inArray(lists.id, ids))
    : await db.select({ id: professionals.id, name: professionals.name }).from(professionals).where(inArray(professionals.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return ids.map((id) => byId.get(id)).filter((n): n is string => !!n);
}

export type SatisfactionVoteResult = "nota_alta" | "nota_baixa" | "retirado" | "nada";

/**
 * Fix 1 da Task 9: a enquete saiu mas a linha não foi gravada (erro depois do envio). Se a mensagem votada é a enquete de uma pesquisa
 * (o item da fila guardou o `messageId` e tem as opções da pesquisa), cria a linha agora, com a visita e a hora do envio. Devolve se é pesquisa.
 */
export async function ensureSurveyRow(messageId: string, now: Date): Promise<boolean> {
  const [item] = await db.select({ dealId: outbox.dealId, options: outbox.options, sentAt: outbox.sentAt }).from(outbox)
    .where(and(eq(outbox.kind, "poll"), sql`${outbox.options}->>'messageId' = ${messageId}`)).limit(1);
  const o = item?.options && !Array.isArray(item.options) ? item.options : null;
  if (!item || !o || !isSatisfactionPoll(o.values)) return false;
  await recordSatisfactionAsked({ messageId, dealId: item.dealId, source: o.source, visitId: o.visitId, at: item.sentAt ?? now });
  return true;
}

/**
 * O voto na enquete da pesquisa (`pollMessageId` = messages.id da enquete). Idempotente: a mesma nota de novo (webhook repetido) não faz nada.
 * - Nota alta: resolve o aviso de nota baixa desta enquete; com o modo `pesquisa` ligado e o link do Google, enfileira a mensagem da nota alta
 *   (`pesquisa_nota_alta:<enquete>`, uma vez só: 2→5→2→5 não manda duas; cancelada na fila porque a nota baixou, pode sair de novo).
 * - Nota baixa: aviso para a gestão (o mesmo, reaberto, se ela já tinha mudado) e a etiqueta; nada para a cliente.
 * - Voto retirado: a nota sai e o aviso se resolve.
 */
export async function applySatisfactionVote(pollMessageId: string, option: string | null, at: Date): Promise<SatisfactionVoteResult> {
  const score = option == null ? null : scoreOf(option);
  if (option != null && score == null) return "nada";
  const cfg = await getAfterVisit();
  const after: (() => Promise<unknown>)[] = [];
  const result = await db.transaction(async (tx): Promise<SatisfactionVoteResult> => {
    // Trava a linha: dois votos ao mesmo tempo (ou o webhook repetido) não criam dois avisos nem duas mensagens.
    const [row] = await tx.select({ a: satisfactionAnswers, name: contacts.name, phone: contacts.phoneE164 }).from(satisfactionAnswers)
      .innerJoin(contacts, eq(contacts.id, satisfactionAnswers.contactId)).where(eq(satisfactionAnswers.pollMessageId, pollMessageId)).for("update", { of: satisfactionAnswers });
    if (!row) return "nada";
    const a = row.a;
    if (a.score === score) return "nada";
    await tx.update(satisfactionAnswers).set({ score, answeredAt: score == null ? null : at }).where(eq(satisfactionAnswers.id, a.id));
    const dedupeKey = `nota:${pollMessageId}`;
    const isLow = (n: number | null) => n != null && n < cfg.notaAltaMin;

    if (!isLow(score)) {
      const resolvedAt = new Date();
      const solved = await tx.update(alerts).set({ resolvedAt, readAt: sql`coalesce(${alerts.readAt}, ${resolvedAt.toISOString()}::timestamptz)` })
        .where(and(eq(alerts.dedupeKey, dedupeKey), isNull(alerts.resolvedAt))).returning({ id: alerts.id });
      if (solved.length) after.push(() => emit("alerta", { dealId: a.dealId }));
      // A etiqueta sai junto, a não ser que outra pesquisa da cliente continue com nota baixa.
      const [otherLow] = await tx.select({ id: satisfactionAnswers.id }).from(satisfactionAnswers)
        .where(and(eq(satisfactionAnswers.contactId, a.contactId), ne(satisfactionAnswers.id, a.id), lt(satisfactionAnswers.score, cfg.notaAltaMin))).limit(1);
      const tag = otherLow ? null : await tagByName(tx, cfg.etiquetaNotaBaixa);
      if (tag) await removeTagTx(tx, a.contactId, tag.id, null);
      if (score == null) return "retirado";
      if (cfg.mode === "pesquisa" && cfg.linkGoogle) {
        const source = `${SATISFACTION_HIGH_SOURCE}${pollMessageId}`;
        const [already] = await tx.select({ id: outbox.id }).from(outbox).where(and(sql`${outbox.options}->>'source' = ${source}`, ne(outbox.status, "cancelled"))).limit(1);
        if (!already) {
          const text = renderAfterVisit(cfg.textoNotaAlta, { primeiro_nome: onlyFirstName(row.name) ?? "", link_google: cfg.linkGoogle });
          await enqueueAutomated({ dealId: a.dealId, kind: "text", text, source }, tx);
        }
      }
      return "nota_alta";
    }

    const [servicos, profissionais] = await Promise.all([namesOf("lists", a.serviceIds), namesOf("professionals", a.professionalIds)]);
    const message = renderNotaBaixa(cfg.textoNotaBaixa, { nome: clientLabel(row.name, row.phone), nota: score!, servicos, profissionais });
    await tx.insert(alerts).values({ dealId: a.dealId, userId: null, audience: "gestao", type: "nota_baixa", severity: "urgente", message, dedupeKey, createdAt: at })
      .onConflictDoUpdate({ target: alerts.dedupeKey, set: { message, resolvedAt: null, readAt: null, pushedAt: null, createdAt: at } });
    // A etiqueta depois do commit, pelo caminho de sempre (dispara as regras "Uma etiqueta ser colocada").
    after.push(() => addTag(a.contactId, cfg.etiquetaNotaBaixa, null), () => emit("alerta", { dealId: a.dealId }));
    return "nota_baixa";
  });
  for (const fn of after) {
    try { await fn(); } catch (e) { console.error("[pesquisa] depois do voto", pollMessageId, e instanceof Error ? e.message : e); }
  }
  return result;
}

/** Reconferência na hora de enviar a mensagem da nota alta: ainda ligada, com o link, e a nota ainda alta. Devolve o motivo de cancelar. */
export async function highScoreCancelReason(source: string): Promise<string | null> {
  const cfg = await getAfterVisit();
  if (cfg.mode !== "pesquisa") return "A Pesquisa de satisfação foi desligada.";
  if (!cfg.linkGoogle) return "Falta o link da Avaliação no Google.";
  const [a] = await db.select({ score: satisfactionAnswers.score }).from(satisfactionAnswers)
    .where(eq(satisfactionAnswers.pollMessageId, source.slice(SATISFACTION_HIGH_SOURCE.length)));
  if (!a || a.score == null || a.score < cfg.notaAltaMin) return "A nota da Pesquisa de satisfação mudou.";
  return null;
}

export type SatisfactionNumbers = {
  asked: number; answered: number; average: number | null;
  byProfessional: { id: string; name: string; answered: number; average: number }[];
};

/** Relatórios › Salão: enviadas, respondidas e média no período (dias de Salvador, `from` a `to` inclusive), e por profissional. */
export async function satisfactionNumbers(f: { from: string; to: string }): Promise<SatisfactionNumbers> {
  const start = new Date(`${f.from}T00:00:00-03:00`);
  const end = new Date(new Date(`${f.to}T00:00:00-03:00`).getTime() + DAY_MS);
  const inRange = sql`sa.asked_at >= ${start.toISOString()}::timestamptz and sa.asked_at < ${end.toISOString()}::timestamptz`;
  const [tot] = (await db.execute(sql`select count(*)::int as asked, count(sa.score)::int as answered, avg(sa.score)::float8 as average
    from satisfaction_answers sa where ${inRange}`)).rows as { asked: number; answered: number; average: number | null }[];
  const pros = (await db.execute(sql`select p.id, p.name, count(*)::int as answered, avg(sa.score)::float8 as average
    from satisfaction_answers sa cross join lateral unnest(sa.professional_ids) as pid join professionals p on p.id = pid
    where ${inRange} and sa.score is not null group by p.id, p.name order by count(*) desc, lower(p.name)`)).rows as SatisfactionNumbers["byProfessional"];
  return { asked: tot.asked, answered: tot.answered, average: tot.average == null ? null : Number(tot.average), byProfessional: pros.map((p) => ({ ...p, average: Number(p.average) })) };
}

/** O bloco de Relatórios › Salão só para quem vê os números de toda a equipe (`relatorios.equipe`); sem isso, null. */
export async function loadSatisfaction(user: { perms: readonly string[] }, range: { from: string; to: string }): Promise<SatisfactionNumbers | null> {
  if (!can(user.perms, "relatorios.equipe")) return null;
  return satisfactionNumbers(range);
}
