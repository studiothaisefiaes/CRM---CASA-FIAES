import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { profiles, users } from "@/server/db/schema";
import type { Actor } from "@/server/domain/agenda/actor";
import { setSetting, setupAgenda } from "./agenda-fixtures";
import { permsFor } from "./perms";

/**
 * O `setupAgenda()` (6B.3) com o caixa do CRM ligado. A equipe opera (caixa.operar); a gestão também gere e vê a comissão.
 * Plano 3: a gestora e a Cati ficam ligadas aos perfis (quem aprova a diferença do fechamento é conferido pelo perfil).
 */
export async function setupCaixa(opts: { estoque?: boolean } = {}) {
  const s = await setupAgenda();
  await setSetting("caixa_modo", "crm");
  // Produtos e estoque nasce ligado (padrão). `estoque: false` só para testes que lançam produto como texto livre sem testar produto.
  if (opts.estoque === false) await setSetting("estoque_config", { ligado: false, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" });
  const perfil = async (key: string) => (await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, key)))[0]?.id ?? null;
  await db.update(users).set({ profileId: await perfil("gestao") }).where(eq(users.id, s.gestora.id));
  await db.update(users).set({ profileId: await perfil("atendente") }).where(eq(users.id, s.cati.id));
  const caixaRecepcao: Actor = { id: s.cati.id, perms: permsFor("atendente") };
  const caixaGestao: Actor = { id: s.gestora.id, perms: permsFor("gestor") };
  return { ...s, caixaRecepcao, caixaGestao };
}
