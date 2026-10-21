import { and, eq } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, professionals, professionalServices, settings } from "../../db/schema";
import { readCommissionRules, readProCommissionRules, type CommissionRules, type DeductMode, type ProCommissionRules } from "@/lib/commission-rules";
import { isUuid } from "@/lib/uuid";
import type { Actor } from "../agenda/actor";
import { UserFacingError } from "../errors";

/**
 * Regras da comissão (Fase A, decisões 3, 4 e 6): as da Casa ficam em `settings.comissao_regras` (só a migration 0063 cria a linha; sem
 * ela vale o neutro), as próprias de cada profissional em `professionals.commission_rules` (só cartão, antecipação e custo) e o % da
 * assistente em `professional_services.assistant_bp`. Valem para as comandas fechadas depois; o que fechou é retrato. A permissão
 * (`comissao.regras`) fica nas ações (Tarefa 6).
 */
const KEY = "comissao_regras";
const MODES: readonly DeductMode[] = ["nao", "antes", "depois"];
const PICK = "Escolha uma das opções.";
const PCT = "Use de 0% a 100%.";
const isMode = (v: unknown): v is DeductMode => MODES.includes(v as DeductMode);
const isBp = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10000;

export async function getCommissionRules(q: Tx | Db = db): Promise<CommissionRules> {
  const [r] = await q.select().from(settings).where(eq(settings.key, KEY));
  return readCommissionRules(r?.value);
}

/** Caixa › Comissão › Regras (as da Casa). Valida tudo, trava a linha e audita com de/para. */
export async function saveCommissionRules(input: CommissionRules, actor: Actor): Promise<void> {
  if (![input.cartao, input.antecipacao, input.custo].every(isMode)) throw new UserFacingError(PICK);
  if (!["total", "metade"].includes(input.doisAssistentes) || !["agora", "quitacao"].includes(input.divida)) throw new UserFacingError(PICK);
  if (!isBp(input.antecipacaoBp) || !isBp(input.assistenteSaiDaPrincipalBp)) throw new UserFacingError(PCT);
  const value: CommissionRules = {
    cartao: input.cartao, antecipacao: input.antecipacao, antecipacaoBp: input.antecipacaoBp, custo: input.custo,
    doisAssistentes: input.doisAssistentes, assistenteSaiDaPrincipalBp: input.assistenteSaiDaPrincipalBp, divida: input.divida,
  };
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).where(eq(settings.key, KEY)).for("update");
    const before = readCommissionRules(row?.value);
    await tx.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId: actor.id, action: "comissao_regras_casa", entity: "settings", entityId: KEY, data: { de: before, para: value } });
  });
}

/** Regras próprias da profissional (cartão, antecipação, custo); `null` (ou nada marcado) volta a seguir as da Casa. */
export async function saveProfessionalCommissionRules(professionalId: string, input: ProCommissionRules | null, actor: Actor): Promise<void> {
  let value: ProCommissionRules | null = null;
  if (input) {
    const out: ProCommissionRules = {};
    for (const k of ["cartao", "antecipacao", "custo"] as const) {
      const v = input[k];
      if (v === undefined) continue;
      if (!isMode(v)) throw new UserFacingError(PICK);
      out[k] = v;
    }
    value = Object.keys(out).length ? out : null;
  }
  if (!isUuid(professionalId)) throw new UserFacingError("Profissional não encontrada.");
  await db.transaction(async (tx) => {
    const [pro] = await tx.select({ id: professionals.id, rules: professionals.commissionRules }).from(professionals).where(eq(professionals.id, professionalId)).for("update");
    if (!pro) throw new UserFacingError("Profissional não encontrada.");
    const before = readProCommissionRules(pro.rules);
    await tx.update(professionals).set({ commissionRules: value }).where(eq(professionals.id, pro.id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "comissao_regras_profissional", entity: "professional", entityId: pro.id, data: { de: before, para: value } });
  });
}

/** % da assistente na linha da principal × serviço (vazio = assistente sem regra). Igual ao que está: nada muda, sem rastro. */
export async function setAssistantCommission(input: { professionalId: string; serviceId: string; bp: number | null }, actor: Actor): Promise<void> {
  if (input.bp !== null && !isBp(input.bp)) throw new UserFacingError(PCT);
  if (!isUuid(input.professionalId) || !isUuid(input.serviceId)) throw new UserFacingError("Ela não faz esse serviço: marque em Profissionais primeiro.");
  await db.transaction(async (tx) => {
    const where = and(eq(professionalServices.professionalId, input.professionalId), eq(professionalServices.serviceId, input.serviceId));
    const [row] = await tx.select().from(professionalServices).where(where).for("update");
    if (!row) throw new UserFacingError("Ela não faz esse serviço: marque em Profissionais primeiro.");
    if (row.assistantBp === input.bp) return;
    await tx.update(professionalServices).set({ assistantBp: input.bp }).where(where);
    await tx.insert(auditLog).values({ userId: actor.id, action: "comissao_assistente", entity: "professional", entityId: input.professionalId,
      data: { servico: input.serviceId, de: row.assistantBp, para: input.bp } });
  });
}
