import { eq, inArray } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, settings } from "../../db/schema";
import { UserFacingError } from "../errors";
import { CAIXA_OFF, isCaixaMode, isDiscountLimitBp, readCaixaRules, type CaixaMode, type CaixaRules } from "@/lib/caixa-settings";

const MODE_KEY = "caixa_modo", RULES_KEY = "caixa_regras";

export async function getCaixaMode(q: Tx | Db = db): Promise<CaixaMode> {
  const [r] = await q.select().from(settings).where(eq(settings.key, MODE_KEY));
  return isCaixaMode(r?.value) ? r.value : "avec";
}

export async function getCaixaRules(q: Tx | Db = db): Promise<CaixaRules> {
  const [r] = await q.select().from(settings).where(eq(settings.key, RULES_KEY));
  return readCaixaRules(r?.value);
}

/** Comanda e caixa do CRM só no modo "crm" (7.4, regra 11). Pacotes e comissão não passam por aqui (a Casa prepara antes). */
export async function assertCaixaOn(q: Tx | Db = db): Promise<void> {
  if ((await getCaixaMode(q)) !== "crm") throw new UserFacingError(CAIXA_OFF);
}

/** Configurações › Caixa: modo e "exigir caixa aberto". Só a gestão; auditado com de/para. */
export async function saveCaixaSettings(input: { mode: CaixaMode; exigeCaixaAberto: boolean }, userId: string): Promise<void> {
  if (!isCaixaMode(input.mode)) throw new UserFacingError("Escolha Avec ou CRM.");
  await db.transaction(async (tx) => {
    const before = Object.fromEntries((await tx.select().from(settings).where(inArray(settings.key, [MODE_KEY, RULES_KEY]))).map((r) => [r.key, r.value]));
    // Mescla: as regras do fechamento (Caixas da equipe) continuam como estão.
    const rules = { ...readCaixaRules(before[RULES_KEY]), exigeCaixaAberto: !!input.exigeCaixaAberto };
    for (const [key, value] of [[MODE_KEY, input.mode], [RULES_KEY, rules]] as const) {
      await tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    }
    await tx.insert(auditLog).values({ userId, action: "caixa_configurado", entity: "settings", entityId: MODE_KEY, data: { de: before, para: { [MODE_KEY]: input.mode, [RULES_KEY]: rules } } });
  });
}

/**
 * Caixa › Caixas da equipe (caixa.gerir): tolerância, contagem cega, sangria grande e o limite de cortesia e desconto (sem ele, fica como
 * está). Mescla com "exigir caixa aberto"; auditado com de/para.
 */
export async function saveCaixaRules(input: Omit<CaixaRules, "exigeCaixaAberto" | "aprovacaoDescontoBp" | "notaPadrao"> & { aprovacaoDescontoBp?: number | null; notaPadrao?: CaixaRules["notaPadrao"] }, userId: string): Promise<void> {
  const ok = (v: number) => Number.isInteger(v) && v >= 0 && v <= 10_000_000;
  if (!ok(input.toleranciaCents)) throw new UserFacingError("Digite a tolerância (pode ser zero).");
  if (!ok(input.sangriaGrandeCents)) throw new UserFacingError("Digite a partir de quanto a sangria é grande.");
  if (input.aprovacaoDescontoBp != null && !isDiscountLimitBp(input.aprovacaoDescontoBp)) throw new UserFacingError("Use de 1% a 100%.");
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).where(eq(settings.key, RULES_KEY)).for("update");
    const before = readCaixaRules(row?.value);
    const value: CaixaRules = { ...before, toleranciaCents: input.toleranciaCents, contagemCega: !!input.contagemCega, sangriaGrandeCents: input.sangriaGrandeCents,
      aprovacaoDescontoBp: input.aprovacaoDescontoBp === undefined ? before.aprovacaoDescontoBp : input.aprovacaoDescontoBp,
      notaPadrao: input.notaPadrao ?? before.notaPadrao };
    await tx.insert(settings).values({ key: RULES_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId, action: "caixa_regras", entity: "settings", entityId: RULES_KEY, data: { de: before, para: value } });
  });
}
