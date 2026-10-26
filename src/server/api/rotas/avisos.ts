import { z } from "zod";
import { getMyAlerts } from "../../queries/alerts";
import { rotaApi, zInstanteSaida, zLista } from "../rota";

/** O sino da pessoa da chave (os mesmos avisos dos últimos 7 dias, com a mesma regra de quem recebe as escaladas da gestão). */
export const listarAvisos = rotaApi({
  metodo: "GET", caminho: "/avisos", escopo: "ler", perm: null, semPerm: "os avisos do sino da própria pessoa da chave (a mesma regra do sino da tela)", grupo: "Avisos",
  resumo: "Avisos do sino", descricao: "Os da pessoa da chave (e os da gestão, para quem recebe escaladas), dos últimos 7 dias, do mais novo para o mais velho.",
  resposta: zLista(z.object({
    id: z.uuid(), tipo: z.string(), gravidade: z.string(), mensagem: z.string(), criado_em: zInstanteSaida, lido: z.boolean(), resolvido: z.boolean(),
    conversa_id: z.uuid().nullable(), contato: z.object({ id: z.uuid(), nome: z.string().nullable() }).nullable(), para_mim: z.boolean(), para_gestao: z.boolean(),
  })),
  handler: async ({ user }) => ({
    dados: (await getMyAlerts(user, 100)).map((a) => ({
      id: a.id, tipo: a.type, gravidade: a.severity, mensagem: a.message, criado_em: new Date(a.createdAt), lido: a.read, resolvido: a.resolved,
      conversa_id: a.dealId, contato: a.contactId ? { id: a.contactId, nome: a.contactName } : null, para_mim: a.forMe, para_gestao: a.forGestao,
    })),
    proximo_cursor: null,
  }),
});
