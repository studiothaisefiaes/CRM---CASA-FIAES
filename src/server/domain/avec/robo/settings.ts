import { eq } from "drizzle-orm";
import { db, type Db, type Tx } from "../../../db";
import { alerts, auditLog, settings } from "../../../db/schema";
import { UserFacingError } from "../../errors";
import { DEFAULT_ROBO } from "./plan";

const CFG_KEY = "avec_robo_config", LAST_KEY = "avec_robo_ultimo";

export type RoboConfig = { ativo: boolean; hora: number };
export type RoboLast = {
  em: string; ok: boolean; relatorios: { codigo: string; titulo: string; linhas: number; erro?: string }[];
  linhasNovas: number; erros: string[]; /** Dia (aaaa-mm-dd, Salvador) da última rodada dos completos. */ semanalEm: string | null;
};

const put = (tx: Tx | Db, key: string, value: unknown) => tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });

export async function getRoboConfig(tx: Tx | Db = db): Promise<RoboConfig> {
  const [r] = await tx.select().from(settings).where(eq(settings.key, CFG_KEY));
  const v = (r?.value ?? {}) as Partial<RoboConfig>;
  return { ativo: typeof v.ativo === "boolean" ? v.ativo : DEFAULT_ROBO.ativo, hora: Number.isInteger(v.hora) && v.hora! >= 0 && v.hora! <= 23 ? v.hora! : DEFAULT_ROBO.hora };
}

export async function getRoboLast(tx: Tx | Db = db): Promise<RoboLast | null> {
  const [r] = await tx.select().from(settings).where(eq(settings.key, LAST_KEY));
  return (r?.value as RoboLast | undefined) ?? null;
}
export const saveRoboLast = (last: RoboLast, tx: Tx | Db = db) => put(tx, LAST_KEY, last);

/** Configurações › Ligação com o Avec: liga/desliga e hora (Salvador). Só config.sistema; auditado. */
export async function saveRoboConfig(input: RoboConfig, userId: string): Promise<void> {
  if (typeof input.ativo !== "boolean") throw new UserFacingError("Escolha ligado ou desligado.");
  if (!Number.isInteger(input.hora) || input.hora < 0 || input.hora > 23) throw new UserFacingError("Escolha uma hora de 0 a 23.");
  await db.transaction(async (tx) => {
    const before = await getRoboConfig(tx);
    await put(tx, CFG_KEY, { ativo: input.ativo, hora: input.hora });
    await tx.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: CFG_KEY, data: { de: before, para: input } });
  });
}

/** Aviso no sino da gestão (um por dia): o robô falhou ou o Avec mudou a tela. */
export async function alertRoboFailure(day: string, message: string, tx: Tx | Db = db): Promise<void> {
  await tx.insert(alerts).values({ dealId: null, userId: null, audience: "gestao", type: "avec_robo", severity: "urgente", message, dedupeKey: `avec_robo:${day}` })
    .onConflictDoUpdate({ target: alerts.dedupeKey, set: { message, readAt: null, resolvedAt: null, createdAt: new Date() } });
}
