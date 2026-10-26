import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";
import { apiKeys, auditLog, profiles, users } from "../db/schema";
import { isPerm, PERM_LABEL, type Perm } from "@/lib/permissions";
import type { SessionUser } from "../auth/sessions-store";
import { UserFacingError } from "../domain/errors";
import { assertActorCanTouchMember } from "../domain/profiles";

/**
 * Chaves da API v1. Formato `cf_<43 caracteres base64url>` (32 bytes aleatórios). No banco fica só o sha256 da chave inteira e os
 * 8 primeiros caracteres (o "prefixo", para reconhecer na lista); quem perde a chave cria outra. Mostrar a chave é só na criação.
 */
export const ESCOPOS = ["ler", "escrever", "enviar"] as const;
export type Escopo = (typeof ESCOPOS)[number];
export const PREFIXO_TAM = 8;
const FORMATO = /^cf_[A-Za-z0-9_-]{43}$/;

export const hashChave = (chave: string) => createHash("sha256").update(chave).digest("hex");
export const novaChave = () => `cf_${randomBytes(32).toString("base64url")}`;

export type ChaveCriada = { id: string; chave: string; prefixo: string };
export type NovaChaveInput = { nome: string; userId: string; escopos: Escopo[]; expiraEm?: Date | null };

export const TEXTO_SO_GESTAO_OUTRA = "Só quem é da Gestão cria chave em nome de outra pessoa. Crie a chave em seu nome.";
/** "Receber leads novos no rodízio" é algo que acontece com a pessoa, não algo que a chave faça: não conta na comparação. */
const PERMS_PASSIVAS: readonly string[] = ["distribuicao.receber"];
const permsDe = async (userId: string) => {
  const [r] = await db.select({ key: profiles.key, perms: profiles.permissions }).from(users).leftJoin(profiles, eq(profiles.id, users.profileId)).where(eq(users.id, userId));
  return { gestao: r?.key === "gestao", perms: (r?.perms ?? []).filter(isPerm) };
};
/** Quem cria pode escolher outra pessoa? (A tela mostra o "Em nome de" só para a Gestão.) */
export const podeCriarParaOutra = async (userId: string) => (await permsDe(userId)).gestao;

/**
 * Revisão de segurança da API (26/10): por padrão a chave é de quem cria. Em nome de outra pessoa, só a Gestão; mesmo assim vale a regra
 * de 17/10 (assertActorCanTouchMember) e a chave não pode agir com permissão que quem cria não tem (senão, criar chave viraria um jeito
 * de ganhar permissão). Pelo terminal do servidor (`criadoPor` nulo) é o administrador: escolhe qualquer pessoa.
 */
async function assertPodeCriarPara(criadoPor: string, userId: string): Promise<void> {
  if (criadoPor === userId) return;
  const quem = await permsDe(criadoPor);
  if (!quem.gestao) throw new UserFacingError(TEXTO_SO_GESTAO_OUTRA);
  await assertActorCanTouchMember(criadoPor, userId);
  const alvo = await permsDe(userId);
  const faltam = alvo.perms.filter((p) => !PERMS_PASSIVAS.includes(p) && !quem.perms.includes(p));
  if (faltam.length) {
    throw new UserFacingError(`Essa pessoa tem permissões que você não tem (${faltam.map((p) => PERM_LABEL[p as Perm]).join(", ")}): a chave faria o que você não pode. Peça para quem tem criar, ou crie a chave em seu nome.`);
  }
}

/**
 * Cria a chave e devolve o segredo UMA vez. A pessoa em nome de quem a chave age precisa estar ativa (chave de quem saiu da equipe
 * já nasceria morta). Fica na auditoria quem criou, para quem e com quais escopos (nunca a chave).
 */
export async function criarChave(input: NovaChaveInput, criadoPor: string | null, now = new Date()): Promise<ChaveCriada> {
  const nome = input.nome.trim();
  if (!nome || nome.length > 80) throw new UserFacingError("Dê um nome de até 80 caracteres para a chave (ex.: Planilha da gestão).");
  const escopos = [...new Set(input.escopos)].filter((e): e is Escopo => (ESCOPOS as readonly string[]).includes(e));
  if (!escopos.length) throw new UserFacingError("Escolha pelo menos um escopo: ler, escrever ou enviar.");
  if (input.expiraEm && input.expiraEm.getTime() <= now.getTime()) throw new UserFacingError("A validade precisa ser uma data no futuro.");
  const [u] = await db.select({ id: users.id, active: users.active }).from(users).where(eq(users.id, input.userId));
  if (!u) throw new UserFacingError("Essa pessoa não existe mais na equipe.");
  if (!u.active) throw new UserFacingError("Essa pessoa está desativada: a chave não funcionaria.");
  if (criadoPor) await assertPodeCriarPara(criadoPor, u.id);
  const chave = novaChave();
  const prefixo = chave.slice(0, PREFIXO_TAM);
  const [row] = await db.insert(apiKeys).values({ name: nome, prefix: prefixo, keyHash: hashChave(chave), userId: u.id, scopes: escopos, createdBy: criadoPor, expiresAt: input.expiraEm ?? null })
    .returning({ id: apiKeys.id });
  await db.insert(auditLog).values({ userId: criadoPor, action: "criou_chave", entity: "api", entityId: row.id, data: { nome, prefixo, emNomeDe: u.id, escopos, expiraEm: input.expiraEm?.toISOString() ?? null } });
  return { id: row.id, chave, prefixo };
}

export type ChaveListada = {
  id: string; nome: string; prefixo: string; escopos: Escopo[]; userId: string; userName: string;
  criadaEm: Date; ultimoUso: Date | null; expiraEm: Date | null; revogadaEm: Date | null;
  situacao: "ativa" | "revogada" | "vencida";
};

/** Todas as chaves (as revogadas também, no fim), da mais nova para a mais velha. Nunca devolve o hash. */
export async function listarChaves(now = new Date()): Promise<ChaveListada[]> {
  const rows = await db.select({
    id: apiKeys.id, nome: apiKeys.name, prefixo: apiKeys.prefix, escopos: apiKeys.scopes, userId: apiKeys.userId, userName: users.name,
    criadaEm: apiKeys.createdAt, ultimoUso: apiKeys.lastUsedAt, expiraEm: apiKeys.expiresAt, revogadaEm: apiKeys.revokedAt,
  }).from(apiKeys).innerJoin(users, eq(users.id, apiKeys.userId)).orderBy(sql`${apiKeys.revokedAt} is not null`, desc(apiKeys.createdAt));
  return rows.map((r) => ({ ...r, situacao: r.revogadaEm ? "revogada" : r.expiraEm && r.expiraEm.getTime() <= now.getTime() ? "vencida" : "ativa" }));
}

/** Revoga (não apaga): a chave para de funcionar na hora e a linha fica para a auditoria. Revogar de novo não muda nada. */
export async function revogarChave(id: string, por: string | null, now = new Date()): Promise<{ revogada: boolean }> {
  const [row] = await db.update(apiKeys).set({ revokedAt: now }).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id, prefix: apiKeys.prefix });
  if (!row) {
    const [existe] = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, id));
    if (!existe) throw new UserFacingError("Essa chave não existe.");
    return { revogada: false };
  }
  await db.insert(auditLog).values({ userId: por, action: "revogou_chave", entity: "api", entityId: id, data: { prefixo: row.prefix } });
  return { revogada: true };
}

/** Quem a chave é: a pessoa (com as permissões do perfil dela, lidas a cada pedido) e os escopos da chave. */
export type ChaveAutenticada = { chave: { id: string; nome: string; prefixo: string; escopos: Escopo[]; criadaPor: string | null }; user: SessionUser };
export type FalhaChave = { erro: string };

export const TEXTO_SEM_CHAVE = "Falta a chave da API. Mande o cabeçalho Authorization: Bearer cf_…";
export const TEXTO_CHAVE_INVALIDA = "Chave da API inválida.";
export const TEXTO_CHAVE_REVOGADA = "Esta chave da API foi revogada.";
export const TEXTO_CHAVE_VENCIDA = "Esta chave da API venceu.";
export const TEXTO_USUARIO_INATIVO = "A pessoa desta chave está desativada no CRM.";

/**
 * Confere o cabeçalho `Authorization: Bearer cf_…`. O perfil é lido a cada pedido (sem cache): tirar uma permissão do perfil ou desativar
 * a pessoa vale no pedido seguinte, como na sessão da tela. O "último uso" é gravado no máximo uma vez por minuto por chave.
 */
export async function autenticarChave(authorization: string | null, now = new Date()): Promise<ChaveAutenticada | FalhaChave> {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  if (!m) return { erro: TEXTO_SEM_CHAVE };
  const chave = m[1];
  if (!FORMATO.test(chave)) return { erro: TEXTO_CHAVE_INVALIDA };
  const [r] = await db.select({
    id: apiKeys.id, nome: apiKeys.name, prefixo: apiKeys.prefix, escopos: apiKeys.scopes, expiresAt: apiKeys.expiresAt, revokedAt: apiKeys.revokedAt,
    criadaPor: apiKeys.createdBy, userId: users.id, name: users.name, email: users.email, active: users.active, availability: users.availability, profileId: users.profileId,
    profileName: profiles.name, permissions: profiles.permissions,
  }).from(apiKeys).innerJoin(users, eq(users.id, apiKeys.userId)).leftJoin(profiles, eq(profiles.id, users.profileId))
    .where(eq(apiKeys.keyHash, hashChave(chave))).limit(1);
  if (!r) return { erro: TEXTO_CHAVE_INVALIDA };
  if (r.revokedAt) return { erro: TEXTO_CHAVE_REVOGADA };
  if (r.expiresAt && r.expiresAt.getTime() <= now.getTime()) return { erro: TEXTO_CHAVE_VENCIDA };
  if (!r.active) return { erro: TEXTO_USUARIO_INATIVO };
  await db.update(apiKeys).set({ lastUsedAt: now })
    .where(and(eq(apiKeys.id, r.id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(now.getTime() - 60_000)))));
  return {
    chave: { id: r.id, nome: r.nome, prefixo: r.prefixo, escopos: r.escopos, criadaPor: r.criadaPor },
    user: { id: r.userId, name: r.name, email: r.email, profileId: r.profileId, profileName: r.profileName ?? "Sem perfil", perms: (r.permissions ?? []).filter(isPerm), availability: r.availability },
  };
}
