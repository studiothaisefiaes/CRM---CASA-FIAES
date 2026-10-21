import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { deals, messages, satisfactionAnswers, tasks } from "../db/schema";
import { CONFIRMACAO_OPCOES, REMARCAR_TAREFA } from "../rules/types";
import { completeTaskTx, createTaskTx } from "./tasks";
import { logEvent, emit } from "./events";
import { setAttendance } from "./updates";

export type PollVoteResult = {
  applied: "confirmado" | "remarcar" | "pesquisa" | "nada"; ignored?: "enquete_desconhecida" | "sem_lead" | "opcao_desconhecida" | "voto_retirado";
  /** Enquete da Pesquisa de satisfação (Task 9): o que o voto fez. */
  pesquisa?: import("./satisfaction").SatisfactionVoteResult;
};

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Voto na enquete de confirmação (opções "Confirmo" / "Preciso remarcar"). Idempotente: o mesmo voto entregue de novo não faz nada.
 * - "Confirmo": comparecimento = confirmado (e fecha a tarefa de remarcar, se houver).
 * - "Preciso remarcar": cria 1 tarefa "Remarcar horário" para quem atende o lead (sem duplicar) e tira o "confirmado".
 * A enquete é achada pelo id da mensagem enviada (`messages.external_id`); voto em enquete que não é nossa é ignorado.
 * Enquete da Pesquisa de satisfação (tem linha em `satisfaction_answers`): vai para `applySatisfactionVote`, inclusive o voto retirado.
 */
export async function applyPollVote(input: { channelId: string | null; pollExternalId: string; option: string | null; at?: Date }): Promise<PollVoteResult> {
  const [poll] = await db.select({ id: messages.id, dealId: messages.dealId, survey: satisfactionAnswers.id }).from(messages)
    .leftJoin(satisfactionAnswers, eq(satisfactionAnswers.pollMessageId, messages.id))
    .where(and(eq(messages.externalId, input.pollExternalId), eq(messages.kind, "poll"), eq(messages.direction, "out"),
      input.channelId ? eq(messages.channelId, input.channelId) : undefined)).limit(1);
  if (poll) {
    // Pesquisa de satisfação; sem a linha (falhou ao gravar no envio), ela nasce agora se a enquete é de uma pesquisa.
    const { applySatisfactionVote, ensureSurveyRow } = await import("./satisfaction");
    if (poll.survey || await ensureSurveyRow(poll.id, input.at ?? new Date()))
      return { applied: "pesquisa", pesquisa: await applySatisfactionVote(poll.id, input.option, input.at ?? new Date()) };
  }
  if (!poll?.dealId) return { applied: "nada", ignored: poll ? "sem_lead" : "enquete_desconhecida" };
  if (!input.option) return { applied: "nada", ignored: "voto_retirado" };
  const dealId = poll.dealId;
  const opt = norm(input.option);

  if (opt === norm(CONFIRMACAO_OPCOES.confirmo)) {
    const [d] = await db.select({ attendance: deals.attendance }).from(deals).where(eq(deals.id, dealId));
    if (d?.attendance !== "confirmado") await setAttendance(dealId, "confirmado", null);
    const closed = await db.transaction(async (tx) => {
      const open = await tx.select({ id: tasks.id }).from(tasks)
        .where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), eq(tasks.title, REMARCAR_TAREFA), isNull(tasks.doneAt)));
      for (const t of open) await completeTaskTx(tx, t.id, null, "cancelada");
      return open.length;
    });
    if (closed) await emit("lead_atualizado", { dealId });
    return { applied: "confirmado" };
  }

  if (opt === norm(CONFIRMACAO_OPCOES.remarcar)) {
    const changed = await db.transaction(async (tx) => {
      // Trava o lead: dois votos ao mesmo tempo não criam duas tarefas.
      const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update");
      if (!deal) return false;
      let changed = false;
      if (deal.attendance === "confirmado") {
        await tx.update(deals).set({ attendance: null, attendanceAt: null }).where(eq(deals.id, dealId));
        await logEvent(tx, dealId, "comparecimento", { de: "confirmado", para: null }, null);
        changed = true;
      }
      const [open] = await tx.select({ id: tasks.id }).from(tasks)
        .where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), eq(tasks.title, REMARCAR_TAREFA), isNull(tasks.doneAt))).limit(1);
      if (!open) {
        await createTaskTx(tx, { dealId, contactId: deal.contactId, kind: "proxima_acao", title: REMARCAR_TAREFA, dueAt: input.at ?? new Date(), assigneeId: deal.ownerId }, null);
        changed = true;
      }
      return changed;
    });
    if (changed) await emit("lead_atualizado", { dealId });
    return { applied: "remarcar" };
  }
  return { applied: "nada", ignored: "opcao_desconhecida" };
}
