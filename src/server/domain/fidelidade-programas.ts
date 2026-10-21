import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { auditLog, lists, loyaltyPrograms, settings } from "../db/schema";
import { UserFacingError } from "./errors";
import { assertFuncao } from "./funcoes";
import { isUuid } from "@/lib/uuid";
import { DEFAULT_REWARD_REASON } from "@/lib/loyalty";

/**
 * Programas de fidelidade, lado da gestão (item 22): o editor de Serviços › Fidelidade e o programa que recebe o saldo do Avec (0113).
 * Quem pode mexer (`fidelidade.programas`) e a função Fidelidade são conferidos pela Server Action; a função também aqui, no domínio.
 */
type Q = Tx | typeof db;
export type LoyaltyProgramRow = typeof loyaltyPrograms.$inferSelect;

export const REWARD_REASON_MAX = 200;
const AVEC_PROGRAM_KEY = "fidelidade_programa_avec";
const AVEC_DEFAULT_NAME = "Fiel da Fiaes";

export async function listLoyaltyPrograms(q: Q = db): Promise<LoyaltyProgramRow[]> {
  return q.select().from(loyaltyPrograms).orderBy(asc(loyaltyPrograms.position), asc(loyaltyPrograms.name));
}

const ids = z.array(z.string().uuid()).max(500);
export const loyaltyProgramSchema = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().trim().min(1, "Dê um nome ao programa.").max(80, "Nome: use até 80 caracteres."),
  description: z.string().trim().max(500, "Descrição: use até 500 caracteres.").nullish(),
  /** Quantos serviços para o prêmio (só programa de contagem). */
  goal: z.number().int("Meta: um número inteiro.").min(1, "Meta: a partir de 1.").max(1000).nullish(),
  /** null = todos os serviços contam. */
  countsServiceIds: ids.nullish(),
  rewardServiceIds: ids,
  /** Pontos-base: 10000 = 100%. */
  rewardDiscountBp: z.number().int().min(1, "Desconto do prêmio: a partir de 0,01%.").max(10000, "Desconto do prêmio: no máximo 100%."),
  /** Desconto máximo que ainda pontua; null = pontua com qualquer desconto. */
  maxDiscountBp: z.number().int().min(0).max(10000, "Desconto máximo que pontua: no máximo 100%.").nullish(),
  countsPackageSessions: z.boolean(),
  /** Vazio = o texto sugerido. `{programa}` vira o nome. */
  rewardReasonTemplate: z.string().trim().max(REWARD_REASON_MAX, `Motivo: use até ${REWARD_REASON_MAX} caracteres.`),
  active: z.boolean(),
}).strict();
export type LoyaltyProgramInput = z.input<typeof loyaltyProgramSchema>;

/** Cria (sem `id`: programa de contagem) ou edita o programa. O tipo (contagem ou aniversário) não muda. */
export async function saveLoyaltyProgram(input: LoyaltyProgramInput, userId: string): Promise<{ id: string }> {
  const v = loyaltyProgramSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertFuncao("fidelidade", tx);
    const [old] = v.id ? await tx.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.id, v.id)) : [];
    if (v.id && !old) throw new UserFacingError("Programa de fidelidade não encontrado.");
    const kind = old?.kind ?? "contagem";
    if (kind === "contagem" && !v.goal) throw new UserFacingError("Meta: diga quantos serviços valem o prêmio.");
    const wanted = [...new Set([...(v.countsServiceIds ?? []), ...v.rewardServiceIds])];
    if (wanted.length) {
      const found = await tx.select({ id: lists.id }).from(lists).where(and(inArray(lists.id, wanted), eq(lists.kind, "service")));
      if (found.length !== wanted.length) throw new UserFacingError("Algum serviço escolhido não existe mais. Abra a tela de novo.");
    }
    const same = (await tx.select({ id: loyaltyPrograms.id }).from(loyaltyPrograms).where(eq(loyaltyPrograms.name, v.name)))[0];
    if (same && same.id !== v.id) throw new UserFacingError("Já existe um programa com esse nome.");
    const values = {
      name: v.name, description: v.description?.trim() || null, goal: kind === "contagem" ? v.goal ?? null : null,
      countsServiceIds: kind === "contagem" && v.countsServiceIds?.length ? [...new Set(v.countsServiceIds)] : null,
      rewardServiceIds: [...new Set(v.rewardServiceIds)], rewardDiscountBp: v.rewardDiscountBp, maxDiscountBp: v.maxDiscountBp ?? null,
      countsPackageSessions: v.countsPackageSessions, rewardReasonTemplate: v.rewardReasonTemplate || DEFAULT_REWARD_REASON, active: v.active,
    };
    let id: string;
    if (old) {
      await tx.update(loyaltyPrograms).set(values).where(eq(loyaltyPrograms.id, old.id));
      id = old.id;
    } else {
      const last = (await listLoyaltyPrograms(tx)).reduce((a, p) => Math.max(a, p.position), -1);
      [{ id }] = await tx.insert(loyaltyPrograms).values({ ...values, kind: "contagem", position: last + 1 }).returning({ id: loyaltyPrograms.id });
    }
    await tx.insert(auditLog).values({ userId, action: old ? "editou" : "criou", entity: "loyalty_program", entityId: id, data: { nome: values.name, meta: values.goal, ativo: values.active } });
    return { id };
  });
}

/** O programa que recebe o saldo do Avec (0113): o escolhido em Serviços › Fidelidade ou, sem escolha (ou se sumiu), o "Fiel da Fiaes". Null se não há. */
export async function getAvecLoyaltyProgramId(q: Q = db): Promise<string | null> {
  const raw = (await q.select({ value: settings.value }).from(settings).where(eq(settings.key, AVEC_PROGRAM_KEY)))[0]?.value;
  if (typeof raw === "string" && isUuid(raw)) {
    const [p] = await q.select({ id: loyaltyPrograms.id }).from(loyaltyPrograms).where(eq(loyaltyPrograms.id, raw));
    if (p) return p.id;
  }
  const [fiel] = await q.select({ id: loyaltyPrograms.id }).from(loyaltyPrograms).where(eq(loyaltyPrograms.name, AVEC_DEFAULT_NAME));
  if (fiel) return fiel.id;
  // O "Fiel da Fiaes" foi renomeado: vale o primeiro programa de contagem em uso.
  const [first] = await q.select({ id: loyaltyPrograms.id }).from(loyaltyPrograms)
    .where(and(eq(loyaltyPrograms.kind, "contagem"), eq(loyaltyPrograms.active, true))).orderBy(asc(loyaltyPrograms.position), asc(loyaltyPrograms.name));
  return first?.id ?? null;
}

/** Escolhe o programa que recebe o saldo do Avec (null volta ao "Fiel da Fiaes"). Vale na próxima importação. */
export async function saveAvecLoyaltyProgram(programId: string | null, userId: string | null): Promise<void> {
  const pid = programId === null ? null : z.string().uuid().parse(programId);
  await db.transaction(async (tx) => {
    await assertFuncao("fidelidade", tx);
    if (pid) {
      const [p] = await tx.select({ kind: loyaltyPrograms.kind }).from(loyaltyPrograms).where(eq(loyaltyPrograms.id, pid));
      if (!p) throw new UserFacingError("Programa de fidelidade não encontrado.");
      if (p.kind !== "contagem") throw new UserFacingError("O saldo do Avec só entra em programa de contagem de serviços.");
    }
    await tx.insert(settings).values({ key: AVEC_PROGRAM_KEY, value: pid ?? "" }).onConflictDoUpdate({ target: settings.key, set: { value: pid ?? "", updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: AVEC_PROGRAM_KEY, data: { programa: pid } });
  });
}
