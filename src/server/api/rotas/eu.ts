import { z } from "zod";
import { PERMS } from "@/lib/permissions";
import { ESCOPOS } from "../chaves";
import { rotaApi, zUm } from "../rota";

/** Quem é a chave: para conferir, antes de qualquer script, em nome de quem ela age e o que pode. */
export const eu = rotaApi({
  metodo: "GET", caminho: "/eu", escopo: "ler", perm: null, semPerm: "só devolve os dados da própria chave e da pessoa dela",
  grupo: "Chave", resumo: "Quem é esta chave",
  descricao: "A pessoa em nome de quem a chave age, os escopos da chave e as permissões do perfil dessa pessoa (lidas agora: mudar o perfil vale no pedido seguinte).",
  resposta: zUm(z.object({
    chave: z.object({ id: z.uuid(), nome: z.string(), prefixo: z.string(), escopos: z.array(z.enum(ESCOPOS)) }),
    usuario: z.object({ id: z.uuid(), nome: z.string(), email: z.string(), perfil: z.string() }),
    permissoes: z.array(z.enum(PERMS)),
  })),
  handler: async ({ user, chave }) => ({
    dados: {
      chave: { id: chave.id, nome: chave.nome, prefixo: chave.prefixo, escopos: chave.escopos },
      usuario: { id: user.id, nome: user.name, email: user.email, perfil: user.profileName },
      permissoes: user.perms,
    },
  }),
});
