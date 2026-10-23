import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { appointmentAssistants, auditLog, comandaItemAssistants, comandaItems, professionals } from "../../db/schema";
import { firstName } from "@/lib/authorship";
import { recursoOffMessage } from "@/lib/caixa-recursos";
import { isUuid } from "@/lib/uuid";
import type { Actor } from "../agenda/actor";
import { UserFacingError } from "../errors";
import { afterCaixaChange, lockComandaTx } from "./comandas";
import { assertCaixaOn } from "./mode";
import { getCaixaRecursos } from "./recursos";

/** Teto do schema (posição 1 a 20, o mesmo da agenda): "quantas eu quiser" (22/10). O limite de verdade é `assistentesMax` em Configurações › Caixa. */
export const MAX_ASSISTANTS = 20;
const WITH_ASSISTANT = ["servico", "pacote_sessao"];

/** Assistentes sugeridas para uma profissional: as ativas cujo `assistant_of` é ela, por nome, até `max`. */
export async function suggestedAssistantsTx(q: Tx | Db, professionalId: string | null, max: number = MAX_ASSISTANTS): Promise<string[]> {
  if (!professionalId || !isUuid(professionalId)) return [];
  const rows = await q.select({ id: professionals.id }).from(professionals)
    .where(and(eq(professionals.assistantOf, professionalId), eq(professionals.active, true))).orderBy(asc(professionals.name), asc(professionals.id)).limit(Math.min(max, MAX_ASSISTANTS));
  return rows.map((r) => r.id).filter((id) => id !== professionalId);
}

/** Nomes das assistentes do item, na ordem das posições. */
export async function assistantNamesTx(q: Tx | Db, itemId: string): Promise<string[]> {
  const rows = await q.select({ name: professionals.name }).from(comandaItemAssistants).innerJoin(professionals, eq(professionals.id, comandaItemAssistants.professionalId))
    .where(eq(comandaItemAssistants.comandaItemId, itemId)).orderBy(asc(comandaItemAssistants.position));
  return rows.map((r) => r.name);
}

/** Apaga as assistentes do item e põe as sugeridas pela profissional (nada se o recurso estiver desligado; respeita o limite). Sem auditoria: quem audita é quem chama. */
export async function fillSuggestedAssistantsTx(tx: Tx, itemId: string, professionalId: string | null, actorId: string): Promise<void> {
  await tx.delete(comandaItemAssistants).where(eq(comandaItemAssistants.comandaItemId, itemId));
  const r = await getCaixaRecursos(tx);
  if (!r.assistentes) return;
  const ids = await suggestedAssistantsTx(tx, professionalId, r.assistentesMax);
  if (ids.length) await tx.insert(comandaItemAssistants).values(ids.map((id, k) => ({ comandaItemId: itemId, professionalId: id, position: k + 1, createdBy: actorId })));
}

/**
 * 0089: o serviço que veio de um horário com auxiliares nasce com elas como assistentes (na ordem do horário, sem a própria profissional
 * do item, só as ativas), até o limite do Caixa; sem auxiliares no horário, as sugeridas pela profissional (como antes). Devolve o aviso
 * quando alguma ficou de fora (limite ou recurso desligado). Sem auditoria: ninguém trocou nada.
 */
export async function fillFromAppointmentTx(tx: Tx, itemId: string, appointmentId: string | null, professionalId: string | null, actorId: string): Promise<string | null> {
  const aux = appointmentId ? await tx.select({ id: appointmentAssistants.professionalId, name: professionals.name, active: professionals.active }).from(appointmentAssistants)
    .innerJoin(professionals, eq(professionals.id, appointmentAssistants.professionalId))
    .where(eq(appointmentAssistants.appointmentId, appointmentId)).orderBy(asc(appointmentAssistants.position)) : [];
  if (!aux.length) { await fillSuggestedAssistantsTx(tx, itemId, professionalId, actorId); return null; }
  await tx.delete(comandaItemAssistants).where(eq(comandaItemAssistants.comandaItemId, itemId));
  const r = await getCaixaRecursos(tx);
  const usable = aux.filter((a) => a.active && a.id !== professionalId);
  const ids = r.assistentes ? usable.slice(0, Math.min(r.assistentesMax, MAX_ASSISTANTS)) : [];
  if (ids.length) await tx.insert(comandaItemAssistants).values(ids.map((a, k) => ({ comandaItemId: itemId, professionalId: a.id, position: k + 1, createdBy: actorId })));
  const left = aux.filter((a) => !ids.includes(a));
  if (!left.length) return null;
  const names = left.map((a) => firstName(a.name) ?? a.name).join(", ");
  return r.assistentes
    ? `A comanda aceita até ${r.assistentesMax} ${r.assistentesMax === 1 ? "assistente" : "assistentes"} por serviço: ${names} ficou de fora (só na agenda).`
    : `Assistente na comanda está desligado em Configurações › Caixa: ${names} ficou só na agenda.`;
}

/** Copia as assistentes de itens antigos para os novos (reabrir para corrigir). `pairs`: [item antigo, item novo]. */
export async function copyAssistantsTx(tx: Tx, pairs: [string, string][], actorId: string): Promise<void> {
  if (!pairs.length) return;
  const rows = await tx.select().from(comandaItemAssistants).where(inArray(comandaItemAssistants.comandaItemId, pairs.map((p) => p[0])));
  const to = new Map(pairs);
  const values = rows.map((a) => ({ comandaItemId: to.get(a.comandaItemId)!, professionalId: a.professionalId, position: a.position, createdBy: actorId }));
  if (values.length) await tx.insert(comandaItemAssistants).values(values);
}

const limitMessage = (max: number) => `No máximo ${max} ${max === 1 ? "assistente" : "assistentes"} por serviço.`;

/** Põe e tira as assistentes de um serviço da comanda aberta (a ordem vira a posição 1, 2). Audita só se mudou. */
export async function setItemAssistants(itemId: string, input: { professionalIds: string[] }, actor: Actor, now = new Date()): Promise<void> {
  const day = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const rec = await getCaixaRecursos(tx);
    if (!rec.assistentes) throw new UserFacingError(recursoOffMessage("assistentes"));
    const [it] = isUuid(itemId) ? await tx.select().from(comandaItems).where(eq(comandaItems.id, itemId)) : [];
    if (!it || it.cancelledAt) throw new UserFacingError("Item não encontrado.");
    const c = await lockComandaTx(tx, it.comandaId);
    if (c.status === "fechada") throw new UserFacingError("Essa comanda já foi fechada.");
    if (c.status === "cancelada") throw new UserFacingError("Essa comanda foi cancelada.");
    if (!WITH_ASSISTANT.includes(it.kind)) throw new UserFacingError("Só serviço tem assistente.");
    if (!it.professionalId) throw new UserFacingError("Escolha a profissional do serviço antes da assistente.");
    const ids = input.professionalIds;
    if (ids.length > rec.assistentesMax) throw new UserFacingError(limitMessage(rec.assistentesMax));
    if (new Set(ids).size !== ids.length) throw new UserFacingError("A mesma assistente não pode entrar duas vezes.");
    if (ids.includes(it.professionalId)) throw new UserFacingError("A assistente não pode ser a própria profissional do serviço.");
    const pros = ids.length ? await tx.select({ id: professionals.id, active: professionals.active }).from(professionals).where(inArray(professionals.id, ids.filter(isUuid))) : [];
    const already = new Set((await tx.select({ id: comandaItemAssistants.professionalId }).from(comandaItemAssistants).where(eq(comandaItemAssistants.comandaItemId, it.id))).map((r) => r.id));
    for (const id of ids) {
      const p = pros.find((x) => x.id === id);
      if (!p) throw new UserFacingError("Profissional não encontrada.");
      if (!p.active && !already.has(id)) throw new UserFacingError("Essa profissional está inativa.");
    }
    const before = await assistantNamesTx(tx, it.id);
    await tx.delete(comandaItemAssistants).where(eq(comandaItemAssistants.comandaItemId, it.id));
    if (ids.length) await tx.insert(comandaItemAssistants).values(ids.map((id, k) => ({ comandaItemId: it.id, professionalId: id, position: k + 1, createdBy: actor.id })));
    const after = await assistantNamesTx(tx, it.id);
    if (before.join("\n") !== after.join("\n")) {
      await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "assistente_alterado", entity: "comanda", entityId: c.id, data: { numero: c.number, itemId: it.id, item: it.label, de: before, para: after } });
    }
    return c.day;
  });
  await afterCaixaChange([day]);
}

