import { and, asc, eq, gt, isNull, lte, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { can } from "@/lib/permissions";
import { db } from "../../db";
import { contacts, tasks, users } from "../../db/schema";
import { assertCanActOnDeal } from "../../domain/deal-scope";
import { completeTask, setNextAction, TASK_KINDS } from "../../domain/tasks";
import { ApiErro, lerCursor, pagina, rotaApi, zId, zInstante, zInstanteSaida, zLista, zPaginacao, zUm, zUuid } from "../rota";
import { zBool, zInstanteOuNulo, zPessoa } from "./comum";

/**
 * Tarefas pela API. Ler: como o Hoje, a pessoa vê as dela; as sem responsável e as de outra pessoa, só com "Ver conversas de todas".
 * Criar: a "próxima ação" da conversa (setNextAction: UMA aberta por conversa; a anterior é cancelada e fica no histórico), como o
 * "Combinar próxima ação" da tela. Concluir: completeTask (repetir não duplica).
 */
const GRUPO = "Tarefas";
const zTarefa = z.object({
  id: z.uuid(), titulo: z.string(), tipo: z.enum(TASK_KINDS), vence_em: zInstanteSaida, concluida_em: zInstanteOuNulo,
  responsavel: zPessoa, conversa_id: z.uuid().nullable(), contato: z.object({ id: z.uuid(), nome: z.string().nullable() }), criada_em: zInstanteSaida,
});
const resp = alias(users, "responsavel");
const consulta = () => db.select({ t: tasks, assigneeName: resp.name, contactName: contacts.name }).from(tasks)
  .leftJoin(resp, eq(resp.id, tasks.assigneeId)).innerJoin(contacts, eq(contacts.id, tasks.contactId));
const tarefaDe = (r: Awaited<ReturnType<typeof consulta>>[number]) => ({
  id: r.t.id, titulo: r.t.title, tipo: r.t.kind as (typeof TASK_KINDS)[number], vence_em: r.t.dueAt, concluida_em: r.t.doneAt,
  responsavel: r.t.assigneeId && r.assigneeName ? { id: r.t.assigneeId, nome: r.assigneeName } : null, conversa_id: r.t.dealId,
  contato: { id: r.t.contactId, nome: r.contactName }, criada_em: r.t.createdAt,
});
async function tarefaPorId(id: string) {
  const [r] = await consulta().where(eq(tasks.id, id));
  if (!r) throw new ApiErro(404, "Essa tarefa não existe.");
  return tarefaDe(r);
}

export const listarTarefas = rotaApi({
  metodo: "GET", caminho: "/tarefas", escopo: "ler", perm: "atendimento.ver", grupo: GRUPO,
  resumo: "Tarefas", descricao: "Por vencimento (a mais antiga primeiro). `responsavel`: `eu` (padrão), `sem` ou o id de alguém (esses dois pedem \"Ver conversas de todas\").",
  query: z.object({
    responsavel: z.union([z.enum(["eu", "sem"]), zUuid]).default("eu"),
    abertas: zBool.default(true).meta({ description: "true (padrão): só as não concluídas." }),
    ate: zInstante.optional().meta({ description: "Só as que vencem até este instante." }),
    conversa_id: zUuid.optional(),
    ...zPaginacao,
  }),
  resposta: zLista(zTarefa),
  handler: async ({ user, query }) => {
    const minha = query.responsavel === "eu" || query.responsavel === user.id;
    if (!minha && !can(user.perms, "atendimento.todas")) throw new ApiErro(403, "Ver as tarefas de outras pessoas pede \"Ver conversas de todas\".");
    const conds: (SQL | undefined)[] = [
      minha ? eq(tasks.assigneeId, user.id) : query.responsavel === "sem" ? isNull(tasks.assigneeId) : eq(tasks.assigneeId, query.responsavel),
      query.abertas ? isNull(tasks.doneAt) : undefined,
      query.ate ? lte(tasks.dueAt, query.ate) : undefined,
      query.conversa_id ? eq(tasks.dealId, query.conversa_id) : undefined,
    ];
    const c = lerCursor(query.cursor);
    if (c) conds.push(or(gt(tasks.dueAt, c.em), and(eq(tasks.dueAt, c.em), gt(tasks.id, c.id))));
    const rows = await consulta().where(and(...conds)).orderBy(asc(tasks.dueAt), asc(tasks.id)).limit(query.limite + 1);
    const p = pagina(rows, query.limite, (r) => ({ em: r.t.dueAt, id: r.t.id }));
    return { dados: p.dados.map(tarefaDe), proximo_cursor: p.proximo_cursor };
  },
});

export const criarTarefa = rotaApi({
  metodo: "POST", caminho: "/tarefas", escopo: "escrever", perm: "atendimento.ver", grupo: GRUPO, status: 201,
  resumo: "Combinado da conversa",
  descricao: "Um combinado aberto por conversa: o anterior é cancelado (fica no histórico), como na tela. Sem `responsavel_id`, fica com a dona da conversa; `null` = sem responsável. A data precisa ser futura.",
  corpo: z.object({ conversa_id: zUuid, titulo: z.string().trim().min(1).max(120), vence_em: zInstante, responsavel_id: zUuid.nullable().optional() }),
  resposta: zUm(zTarefa),
  handler: async ({ user, body, alvo }) => {
    await assertCanActOnDeal(user, body.conversa_id);
    const t = await setNextAction(body.conversa_id, { title: body.titulo, dueAt: body.vence_em, assigneeId: body.responsavel_id }, user.id);
    alvo(t.id);
    return { dados: await tarefaPorId(t.id) };
  },
});

export const concluirTarefa = rotaApi({
  metodo: "PATCH", caminho: "/tarefas/{id}", escopo: "escrever", perm: null, grupo: GRUPO,
  semPerm: "concluir tarefa só exige estar logada na tela (completeTaskAction); a conversa da tarefa ainda passa pelo escopo da pessoa",
  resumo: "Conclui a tarefa", descricao: "Só `{ \"concluida\": true }`. Repetir não duplica.",
  params: zId, corpo: z.object({ concluida: z.literal(true) }),
  resposta: zUm(zTarefa),
  handler: async ({ user, params, alvo }) => {
    alvo(params.id);
    const [t] = await db.select({ dealId: tasks.dealId }).from(tasks).where(eq(tasks.id, params.id));
    if (!t) throw new ApiErro(404, "Essa tarefa não existe.");
    if (t.dealId) await assertCanActOnDeal(user, t.dealId);
    await completeTask(params.id, user.id);
    return { dados: await tarefaPorId(params.id) };
  },
});
