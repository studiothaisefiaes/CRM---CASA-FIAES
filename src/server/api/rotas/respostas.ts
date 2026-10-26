import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { can } from "@/lib/permissions";
import { db } from "../../db";
import { lists } from "../../db/schema";
import type { SessionUser } from "../../auth/sessions-store";
import { createQuickReply, makeQuickReplyUniversal, quickRepliesFor, quickReplyAttachment, quickReplyOwnerId, updateQuickReply } from "../../domain/quick-replies";
import { ApiErro, rotaApi, zId, zLista, zUm } from "../rota";

/**
 * Respostas prontas pela API: as mesmas do "/" da conversa. Lista = as universais + as da pessoa da chave. Criar "minha" vale para quem
 * atende; universal (para todas) e editar as de todas, só a gestão (config.sistema), como na tela.
 */
const GRUPO = "Respostas prontas";
const zResposta = z.object({
  id: z.uuid(), atalho: z.string().meta({ description: "O que se digita depois da /." }), texto: z.string().nullable(), pasta: z.string().nullable(),
  anexo: z.object({ nome: z.string(), tipo: z.string() }).nullable(), minha: z.boolean().meta({ description: "Só a pessoa da chave vê (false = universal)." }),
});
const ator = (u: SessionUser) => ({ id: u.id, canShare: can(u.perms, "config.sistema") });
async function porId(user: SessionUser, id: string) {
  const r = (await quickRepliesFor(user.id)).find((x) => x.id === id);
  if (!r) throw new ApiErro(404, "Essa resposta pronta não existe (ou está desativada).");
  return { id: r.id, atalho: r.label, texto: r.body, pasta: r.folder, anexo: r.attachment ? { nome: r.attachment.name, tipo: r.attachment.kind } : null, minha: r.mine };
}

export const listarRespostas = rotaApi({
  metodo: "GET", caminho: "/respostas-prontas", escopo: "ler", perm: "atendimento.ver", grupo: GRUPO,
  resumo: "Respostas prontas", descricao: "As ativas: as universais e as da pessoa da chave, por pasta.",
  resposta: zLista(zResposta),
  handler: async ({ user }) => ({
    dados: (await quickRepliesFor(user.id)).map((r) => ({ id: r.id, atalho: r.label, texto: r.body, pasta: r.folder, anexo: r.attachment ? { nome: r.attachment.name, tipo: r.attachment.kind } : null, minha: r.mine })),
    proximo_cursor: null,
  }),
});

export const criarResposta = rotaApi({
  metodo: "POST", caminho: "/respostas-prontas", escopo: "escrever", perm: "atendimento.ver", grupo: GRUPO, status: 201,
  resumo: "Cria resposta pronta", descricao: "`para`: `minha` (padrão; só a pessoa da chave vê) ou `todas` (universal: só a gestão).",
  corpo: z.object({ atalho: z.string().min(1).max(60), texto: z.string().min(1).max(4000), pasta: z.string().max(40).optional(), para: z.enum(["minha", "todas"]).default("minha") }),
  resposta: zUm(zResposta),
  handler: async ({ user, body, alvo }) => {
    const r = await createQuickReply({ label: body.atalho, body: body.texto, folder: body.pasta ?? null, scope: body.para === "todas" ? "universal" : "minha" }, ator(user));
    alvo(r.id);
    return { dados: await porId(user, r.id) };
  },
});

export const alterarResposta = rotaApi({
  metodo: "PATCH", caminho: "/respostas-prontas/{id}", escopo: "escrever", perm: "atendimento.ver", grupo: GRUPO,
  resumo: "Edita resposta pronta",
  descricao: "A dona muda a sua; as universais, só a gestão. `ativa: false` tira de uso. `para: \"todas\"` transforma a sua em universal (só a gestão).",
  params: zId,
  corpo: z.object({ atalho: z.string().min(1).max(60).optional(), texto: z.string().min(1).max(4000).optional(), ativa: z.boolean().optional(), para: z.literal("todas").optional() })
    .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Mande pelo menos um campo: atalho, texto, ativa ou para." }),
  resposta: zUm(zResposta.extend({ ativa: z.boolean() })),
  handler: async ({ user, params, body, alvo }) => {
    alvo(params.id);
    const [row] = await db.select({ label: lists.label, body: lists.body, active: lists.active, meta: lists.meta }).from(lists).where(and(eq(lists.id, params.id), eq(lists.kind, "quick_reply")));
    const dona = row ? quickReplyOwnerId(row.meta) : null;
    // Pessoal de outra pessoa: "não existe" (como a tela, nem confirma que existe).
    if (!row || (dona && dona !== user.id && !can(user.perms, "config.sistema"))) throw new ApiErro(404, "Essa resposta pronta não existe.");
    // Conferido antes da primeira escrita: "para todas" recusado não deixa o texto mudado.
    if (body.para === "todas" && !can(user.perms, "config.sistema")) throw new ApiErro(403, "Só a gestão transforma uma resposta em universal.");
    if (body.atalho !== undefined || body.texto !== undefined || body.ativa !== undefined) {
      await updateQuickReply(params.id, { label: body.atalho ?? row.label, body: body.texto ?? row.body ?? "", active: body.ativa }, ator(user));
    }
    if (body.para === "todas") await makeQuickReplyUniversal(params.id, ator(user));
    const [d] = await db.select({ active: lists.active, label: lists.label, body: lists.body, category: lists.category, meta: lists.meta }).from(lists).where(eq(lists.id, params.id));
    const a = quickReplyAttachment(d.meta);
    return { dados: { id: params.id, atalho: d.label, texto: d.body, pasta: d.category, anexo: a ? { nome: a.name, tipo: a.kind } : null, minha: quickReplyOwnerId(d.meta) === user.id, ativa: d.active } };
  },
});
