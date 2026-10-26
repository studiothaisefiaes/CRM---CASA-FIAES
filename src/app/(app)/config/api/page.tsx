import { requirePerm } from "@/server/auth/session";
import { listarChaves, podeCriarParaOutra } from "@/server/api/chaves";
import { activeUsers } from "@/server/domain/deals";
import { ApiKeys } from "@/components/config/api-keys";

export const metadata = { title: "API" };

/** Configurações › Pessoas › API: as chaves para scripts e outros sistemas usarem o CRM em nome de alguém da equipe. Pede api.gerir. */
export default async function ApiPage() {
  const eu = await requirePerm("api.gerir");
  const [chaves, pessoas, paraOutras] = await Promise.all([listarChaves(), activeUsers(), podeCriarParaOutra(eu.id)]);
  return (
    <ApiKeys
      eu={{ id: eu.id, nome: eu.name }}
      // "Em nome de" outra pessoa só para a Gestão (criarChave confere de novo).
      pessoas={paraOutras ? pessoas.map((p) => ({ id: p.id, nome: p.name })) : null}
      chaves={chaves.map((c) => ({
        id: c.id, nome: c.nome, prefixo: c.prefixo, escopos: c.escopos, pessoa: c.userName,
        criadaEm: c.criadaEm.toISOString(), ultimoUso: c.ultimoUso?.toISOString() ?? null, expiraEm: c.expiraEm?.toISOString() ?? null,
        situacao: c.situacao,
      }))}
    />
  );
}
