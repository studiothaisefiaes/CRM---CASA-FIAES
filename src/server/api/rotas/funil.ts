import { z } from "zod";
import { getStages } from "../../domain/deals";
import { OWN_ACTION_STAGE_KINDS } from "../../domain/stage-move";
import { rotaApi, zLista } from "../rota";

/** As etapas do funil (Configurações › Etapas), na ordem. `muda_direto`: dá para pôr uma conversa nela pelo PATCH /conversas/{id}. */
export const listarEtapas = rotaApi({
  metodo: "GET", caminho: "/funil/etapas", escopo: "ler", perm: ["atendimento.ver", "quadro.ver"], grupo: "Etapas",
  resumo: "Etapas da conversa", descricao: "As ativas, na ordem. Agendado, Fechado e Perdido pedem dados (data, valor, motivo): `muda_direto: false`.",
  resposta: zLista(z.object({
    chave: z.string(), nome: z.string(), tipo: z.string(), posicao: z.number().int(), cor: z.string(),
    prazo_minutos: z.number().int().nullable().meta({ description: "Prazo de resposta da etapa." }), parada_apos_dias: z.number().int().nullable(), muda_direto: z.boolean(),
  })),
  handler: async () => ({
    dados: (await getStages()).map((s) => ({
      chave: s.key, nome: s.name, tipo: s.kind, posicao: s.position, cor: s.color, prazo_minutos: s.slaMinutes, parada_apos_dias: s.staleDays,
      muda_direto: !(OWN_ACTION_STAGE_KINDS as readonly string[]).includes(s.kind),
    })),
    proximo_cursor: null,
  }),
});
