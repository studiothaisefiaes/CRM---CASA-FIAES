import { eq } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, settings } from "../../db/schema";
import { UserFacingError } from "../errors";
import type { Actor } from "../agenda/actor";
import { can } from "@/lib/permissions";
import { ESTOQUE_OFF, isCfop, isCsosn, isUnidade, readEstoqueConfig, type EstoqueConfig } from "@/lib/estoque-settings";

const KEY = "estoque_config";

export async function getEstoqueConfig(q: Tx | Db = db): Promise<EstoqueConfig> {
  const [r] = await q.select().from(settings).where(eq(settings.key, KEY));
  return readEstoqueConfig(r?.value);
}

/** Escritas de produto e estoque param aqui quando a função está desligada (a lista e o estorno não passam por aqui). */
export async function assertEstoqueOn(q: Tx | Db = db): Promise<EstoqueConfig> {
  const c = await getEstoqueConfig(q);
  if (!c.ligado) throw new UserFacingError(ESTOQUE_OFF);
  return c;
}

/** Configurações › Estoque (config.sistema); auditado com de/para. */
export async function saveEstoqueConfig(c: EstoqueConfig, actor: Actor): Promise<void> {
  if (!can(actor.perms, "config.sistema")) throw new UserFacingError("Você não tem permissão para configurar o Estoque.");
  if (!isCfop(c.cfopPadrao)) throw new UserFacingError("O CFOP padrão tem 4 números.");
  if (!isCsosn(c.csosnPadrao)) throw new UserFacingError("O CSOSN padrão tem 3 números.");
  if (!isUnidade(c.unidadePadrao)) throw new UserFacingError("A unidade padrão tem de 1 a 6 letras, como UN ou ML.");
  const para: EstoqueConfig = { ligado: !!c.ligado, cfopPadrao: c.cfopPadrao, csosnPadrao: c.csosnPadrao, unidadePadrao: c.unidadePadrao.toUpperCase() };
  await db.transaction(async (tx) => {
    const de = await getEstoqueConfig(tx);
    await tx.insert(settings).values({ key: KEY, value: para }).onConflictDoUpdate({ target: settings.key, set: { value: para, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId: actor.id, action: "estoque_configurado", entity: "settings", entityId: KEY, data: { de, para } });
  });
}
