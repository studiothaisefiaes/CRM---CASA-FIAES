import { eq } from "drizzle-orm";
import { db } from "../../db";
import { fiscalDocuments } from "../../db/schema";
import { UserFacingError } from "../errors";
import type { Actor } from "../agenda/actor";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { audit, RESOLVIDA_FORA } from "./fila";

/**
 * "Resolver fora do CRM" (revisão final do branch, I-2; pede `nota.resolver`, só a Gestão): a saída para a comanda que o CRM não consegue
 * soltar sozinho — sem certificado (ou A1 vencido) para conferir a nota incerta, NFC-e autorizada fora do prazo de cancelamento, envio
 * sem resposta. A Gestão confere no portal do governo e registra o que viu, com o motivo:
 * - "Conferi no portal: a nota NÃO saiu" → `rejeitada`;
 * - "A nota saiu e foi resolvida fora do CRM (cancelada/estornada no portal ou na SEFAZ)" → `cancelada` (chave opcional).
 * Depois disso as três portas da comanda deixam reabrir e cancelar. Não fala com o governo; grava `nota_resolvida_fora` com de/para.
 */
export const RESOLVER_ESCOLHAS = ["nao_saiu", "saiu_resolvida"] as const;
export type ResolverEscolha = (typeof RESOLVER_ESCOLHAS)[number];

const TAMANHO_CHAVE = { nfse: 50, nfce: 44 } as const;
const NOME = { nfse: "NFS-e", nfce: "NFC-e" } as const;

export async function resolverNotaForaDoCrm(
  docId: string, i: { escolha: ResolverEscolha; motivo: string; chave?: string | null }, actor: Actor, now = new Date(),
): Promise<void> {
  if (!can(actor.perms, "nota.resolver")) throw new UserFacingError("Você não tem permissão para resolver nota fora do CRM.");
  if (!RESOLVER_ESCOLHAS.includes(i.escolha)) throw new UserFacingError("Escolha se a nota saiu ou não saiu no governo.");
  const motivo = (i.motivo ?? "").trim().replace(/\s+/g, " ");
  if (motivo.length < 15) throw new UserFacingError("Escreva o motivo (pelo menos 15 letras).");
  if (motivo.length > 255) throw new UserFacingError("O motivo passa de 255 caracteres.");
  if (!isUuid(docId)) throw new UserFacingError("Nota fiscal não encontrada.");
  const chave = (i.chave ?? "").replace(/\D/g, "") || null;
  await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, docId)).for("update");
    if (!doc) throw new UserFacingError("Nota fiscal não encontrada.");
    const kind = doc.kind as keyof typeof TAMANHO_CHAVE;
    const resolvivel = doc.status === "erro_envio" || doc.status === "autorizada" || (doc.status === "pendente" && doc.attempts > 0);
    if (!resolvivel) throw new UserFacingError("Só nota com erro no envio, enviando ou autorizada pode ser resolvida fora do CRM.");
    if (i.escolha === "nao_saiu" && doc.status === "autorizada")
      throw new UserFacingError("Essa nota foi autorizada pelo governo: escolha \"A nota saiu e foi resolvida fora do CRM\".");
    if (chave && i.escolha === "saiu_resolvida" && chave.length !== TAMANHO_CHAVE[kind])
      throw new UserFacingError(`A chave de acesso da ${NOME[kind]} tem ${TAMANHO_CHAVE[kind]} números.`);
    const texto = `${RESOLVIDA_FORA} ${motivo}`;
    const para = i.escolha === "nao_saiu" ? "rejeitada" : "cancelada";
    const accessKey = i.escolha === "saiu_resolvida" ? chave ?? doc.accessKey : doc.accessKey;
    await tx.update(fiscalDocuments).set(i.escolha === "nao_saiu"
      ? { status: para, rejectReason: texto, nextTryAt: null, lastError: null }
      : { status: para, accessKey, cancelReason: texto, cancelledAt: now, cancelledBy: actor.id, nextTryAt: null, lastError: null })
      .where(eq(fiscalDocuments.id, doc.id));
    await audit(tx, actor.id, "nota_resolvida_fora", doc.comandaId, { tipo: doc.kind, nota: doc.number, de: doc.status, para, motivo, chave: accessKey ?? null }, now);
  });
}
