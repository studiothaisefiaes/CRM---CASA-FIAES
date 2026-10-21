import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { automations, deals, messages, type Automation } from "../db/schema";
import { emit } from "../domain/events";
import { funcaoLigada, funcaoParam } from "../domain/funcoes";
import { activeAutomationFilter } from "./retired";
import { candidateForDeal, conditionsHold, fireRule, getBusinessHours, type Candidate } from "./engine";
import { actionSchema, conditionSchema, triggerSchema, type Trigger } from "./types";

/**
 * Regras por acontecimento (Fase B, Task 6): em vez do motor de cada minuto, agem na hora em que algo acontece.
 * Quem chama (sempre depois do commit, num try/catch que nunca derruba a ingestão): `recordInbound` (mensagem da cliente),
 * `addTag` (etiqueta colocada) e o webhook (ligação perdida).
 */
export type RuleEvent =
  | { type: "mensagem"; dealId: string; messageId: string; kind: string; body: string | null; created: boolean; at: Date }
  | { type: "ligacao_perdida"; dealId: string; messageId: string; at: Date }
  | { type: "etiqueta"; contactId: string; tag: string; at: Date; byRule: boolean };

const FUNCAO = "regras_acontecimento";

/** Que gatilhos cada acontecimento pode disparar. */
const TRIGGERS_OF: Record<RuleEvent["type"], Trigger["type"][]> = {
  mensagem: ["cliente_escreveu", "contato_novo", "midia_recebida"],
  ligacao_perdida: ["ligacao_perdida"],
  etiqueta: ["etiqueta_colocada"],
};

/** Mensagens com texto da cliente (a legenda da foto e do vídeo vale). Ligação, figurinha, reação e documento (nome do arquivo) não. */
const TEXT_KINDS = new Set(["text", "image", "video"]);

/** Sem acento, sem maiúscula, espaços juntos (mesmo `fold` de signals.ts). */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A palavra (ou expressão) aparece inteira no texto: "valor" casa "o valor?" mas não "valorizar". */
export function hasWord(body: string, word: string): boolean {
  const w = fold(word);
  if (!w) return false;
  return new RegExp(`(?<![a-z0-9])${escapeRe(w)}(?![a-z0-9])`).test(fold(body));
}

/**
 * A 1ª mensagem de um contato que nunca escreveu para a Casa: nenhuma outra mensagem de entrada dele. As de saída não contam
 * (o menu ou as boas-vindas que o worker já mandou não tiram o "contato novo").
 */
async function isFirstContact(dealId: string, messageId: string): Promise<boolean> {
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  if (!d) return false;
  const [other] = await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.contactId, d.contactId), eq(messages.direction, "in"), ne(messages.id, messageId))).limit(1);
  return !other;
}

/** O lead da cliente onde a etiqueta age: o aberto; sem aberto, o mais recente (o arquivado fica de fora no candidato). */
async function dealOfContact(contactId: string): Promise<string | null> {
  const r = await db.execute(sql`select id from deals where contact_id = ${contactId} and archived_at is null
    order by closed_at nulls first, created_at desc limit 1`);
  return (r.rows[0] as { id: string } | undefined)?.id ?? null;
}

/**
 * Roda as regras ligadas cujo gatilho é deste acontecimento. Uma vez por mensagem (`automation_runs` com `evento:<messageId>`) e por etiqueta
 * colocada (`etiqueta:<tag>:<at>`). Não age: com a função Regras por acontecimento desligada; na etiqueta posta por regra (sem laço A→B→A);
 * no que aconteceu antes de a regra ser ligada (ou editada); na mensagem com mais de `horas_max_mensagem` (webhook reprocessado); na mensagem
 * importada do histórico; em Spam, Fornecedor, Equipe, arquivado e canal em modo quieto (igual ao motor de tempo).
 * Envio de mensagem só entra na fila: a pausa e o consentimento são conferidos lá.
 */
export async function runEventRules(ev: RuleEvent, now = new Date()): Promise<{ fired: number; errors: string[] }> {
  const out = { fired: 0, errors: [] as string[] };
  if (ev.type === "etiqueta" && ev.byRule) return out;
  const list = await db.select().from(automations).where(and(eq(automations.enabled, true), activeAutomationFilter(),
    inArray(sql<string>`${automations.trigger}->>'type'`, TRIGGERS_OF[ev.type])))
    .orderBy(asc(automations.name), asc(automations.id)); // ordem fixa: em ordem alfabética do nome
  if (!list.length) return out;
  if (!(await funcaoLigada(FUNCAO))) return out;
  const maxHours = await funcaoParam(FUNCAO, "horas_max_mensagem");
  if (now.getTime() - ev.at.getTime() > maxHours * 3_600_000) return out;

  let dealId: string | null;
  let windowKey: string;
  if (ev.type === "etiqueta") {
    dealId = await dealOfContact(ev.contactId);
    windowKey = `etiqueta:${fold(ev.tag)}:${ev.at.toISOString()}`;
  } else {
    // Só mensagem da cliente que entrou agora por este lead (a importada do histórico nunca).
    const [m] = await db.select({ dealId: messages.dealId, direction: messages.direction, importedAt: messages.importedAt }).from(messages).where(eq(messages.id, ev.messageId));
    if (!m || m.dealId !== ev.dealId || m.direction !== "in" || m.importedAt) return out;
    dealId = ev.dealId;
    windowKey = `evento:${ev.messageId}`;
  }
  if (!dealId) return out;
  if (!(await candidateForDeal(dealId, now))) return out;
  const hours = await getBusinessHours();
  // Antes de qualquer regra agir (uma mensagem enfileirada por outra regra já seria "outra mensagem").
  const first = ev.type === "mensagem" && ev.created && list.some((a) => (a.trigger as { type?: string }).type === "contato_novo")
    ? await isFirstContact(ev.dealId, ev.messageId) : false;

  for (const auto of list as Automation[]) {
    const trigger = triggerSchema.safeParse(auto.trigger);
    const conds = conditionSchema.array().safeParse(auto.conditions);
    const acts = actionSchema.array().safeParse(auto.actions);
    if (!trigger.success || !conds.success || !acts.success) { out.errors.push(`${auto.name}: configuração inválida`); continue; }
    // Ligar (ou editar) a regra não age no que já tinha acontecido.
    if (ev.at.getTime() < auto.updatedAt.getTime()) continue;
    const t = trigger.data;
    let match = false;
    if (ev.type === "mensagem") {
      if (t.type === "cliente_escreveu") match = TEXT_KINDS.has(ev.kind) && !!ev.body && t.words.some((w) => hasWord(ev.body!, w));
      else if (t.type === "midia_recebida") match = (t.kinds as string[]).includes(ev.kind);
      else if (t.type === "contato_novo") match = first;
    } else if (ev.type === "ligacao_perdida") match = t.type === "ligacao_perdida";
    else match = t.type === "etiqueta_colocada" && fold(t.tag) === fold(ev.tag);
    if (!match) continue;
    try {
      // O lead de agora, a cada regra: a regra anterior pode tê-lo movido de etapa (a seguinte não perde o acontecimento por isso,
      // e a condição de etapa vale para a etapa atual). Arquivado ou marcado como Spam/Fornecedor/Equipe no meio: para.
      const cur = await candidateForDeal(dealId, now);
      if (!cur) break;
      const c: Candidate = { ...cur, windowKey };
      if (!(await conditionsHold(conds.data, c, ev.at, hours))) continue;
      const fired = await fireRule(auto, t, acts.data, c, now);
      if (!fired) continue;
      out.fired++;
      // Erro numa ação: uma linha com o nome da regra; as outras ações já rodaram.
      for (const err of fired.errors) out.errors.push(`${auto.name} / ${dealId}: ${err}`);
    } catch (e) {
      out.errors.push(`${auto.name} / ${dealId}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (out.fired) await emit("regras", { deals: [dealId] });
  return out;
}
