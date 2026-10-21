import { eq } from "drizzle-orm";
import { db, type Db, type Tx } from "../db";
import { auditLog, settings } from "../db/schema";
import { UserFacingError } from "./errors";
import type { Actor } from "./agenda/actor";
import { can } from "@/lib/permissions";
import { OCUPACAO_OFF, readRelatoriosConfig, type RelatoriosConfig } from "@/lib/relatorios-settings";

const KEY = "relatorios_config";

export async function getRelatoriosConfig(q: Tx | Db = db): Promise<RelatoriosConfig> {
  const [r] = await q.select().from(settings).where(eq(settings.key, KEY));
  return readRelatoriosConfig(r?.value);
}

/** A Ocupação só roda com a função ligada em Configurações › Relatórios. */
export async function assertOcupacaoOn(q: Tx | Db = db): Promise<void> {
  if (!(await getRelatoriosConfig(q)).ocupacao) throw new UserFacingError(OCUPACAO_OFF);
}

/** Configurações › Relatórios (config.sistema); auditado com de/para. */
export async function saveRelatoriosConfig(c: RelatoriosConfig, actor: Actor): Promise<void> {
  if (!can(actor.perms, "config.sistema")) throw new UserFacingError("Você não tem permissão para configurar os Relatórios.");
  const para: RelatoriosConfig = { ocupacao: !!c.ocupacao };
  await db.transaction(async (tx) => {
    const de = await getRelatoriosConfig(tx);
    await tx.insert(settings).values({ key: KEY, value: para }).onConflictDoUpdate({ target: settings.key, set: { value: para, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId: actor.id, action: "relatorios_configurado", entity: "settings", entityId: KEY, data: { de, para } });
  });
}
