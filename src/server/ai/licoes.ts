import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { aiLicoes, auditLog, users } from "../db/schema";
import { UserFacingError } from "../domain/errors";

/**
 * Rebater a sugestão (29/10, pedido do dono): a atendente diz o que não gostou, a IA refaz e diz o que errou. O que ela errou vira uma
 * LIÇÃO pendente; só entra no pedido da IA (seção "Lições aprendidas" do bloco fixo) depois que a gestão toca "Usar sempre".
 * Uma crítica errada nunca muda todas as respostas sozinha. Nunca dado de cliente aqui: a IA escreve a regra geral.
 */
export const MAX_LICOES = 30;

/** As aprovadas, da mais antiga para a mais nova (o bloco fixo fica igual entre chamadas: o cache vale). */
export async function approvedLicoes(): Promise<string[]> {
  const rows = await db.select({ licao: aiLicoes.licao }).from(aiLicoes).where(eq(aiLicoes.status, "aprovada")).orderBy(asc(aiLicoes.decidedAt), asc(aiLicoes.id)).limit(MAX_LICOES);
  return rows.map((r) => r.licao);
}

export async function saveLicao(input: { suggestionId: string; critica: string; licao: string; userId: string | null }): Promise<void> {
  const licao = input.licao.replace(/\s+/g, " ").trim().slice(0, 300);
  if (licao.length < 8) return;
  await db.insert(aiLicoes).values({ suggestionId: input.suggestionId, critica: input.critica.slice(0, 1000), licao, createdBy: input.userId });
}

export type LicaoView = { id: string; licao: string; critica: string; status: "pendente" | "aprovada" | "descartada"; createdAt: string; quem: string | null };
/** Para Configurações: as pendentes e as aprovadas (as descartadas somem). */
export async function listLicoes(): Promise<LicaoView[]> {
  const rows = await db.select({ id: aiLicoes.id, licao: aiLicoes.licao, critica: aiLicoes.critica, status: aiLicoes.status, createdAt: aiLicoes.createdAt, quem: users.name })
    .from(aiLicoes).leftJoin(users, eq(users.id, aiLicoes.createdBy)).where(inArray(aiLicoes.status, ["pendente", "aprovada"])).orderBy(desc(aiLicoes.createdAt)).limit(200);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** "Usar sempre" (aprovada), "Descartar" ou "Tirar" (aprovada → descartada). O texto pode ser ajustado ao aprovar. */
export async function decideLicao(id: string, status: "aprovada" | "descartada", userId: string, texto?: string | null, now = new Date()): Promise<void> {
  const licao = texto?.replace(/\s+/g, " ").trim().slice(0, 300);
  if (status === "aprovada") {
    const n = (await db.select({ id: aiLicoes.id }).from(aiLicoes).where(eq(aiLicoes.status, "aprovada"))).length;
    const [cur] = await db.select({ status: aiLicoes.status }).from(aiLicoes).where(eq(aiLicoes.id, id));
    if (cur?.status !== "aprovada" && n >= MAX_LICOES) throw new UserFacingError(`Já há ${MAX_LICOES} lições em uso. Tire uma antes, ou passe a regra para o manual da Casa.`);
  }
  const [r] = await db.update(aiLicoes).set({ status, decidedBy: userId, decidedAt: now, ...(licao ? { licao } : {}) })
    .where(and(eq(aiLicoes.id, id))).returning({ id: aiLicoes.id });
  if (!r) throw new UserFacingError("Essa lição não existe mais.");
  await db.insert(auditLog).values({ userId, action: status === "aprovada" ? "licao_ia_aprovada" : "licao_ia_descartada", entity: "ai_licao", entityId: id, data: licao ? { licao } : {} });
}
