import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../../db";
import { auditLog, settings } from "../../db/schema";

export const proAppSchema = z.object({ mostraValorServico: z.boolean(), avisaConfirmacao: z.boolean() });
export type ProAppSettings = z.infer<typeof proAppSchema>;
export const PRO_APP_DEFAULT: ProAppSettings = { mostraValorServico: false, avisaConfirmacao: false };

/** `app_profissional` (seção 3.1). Sem a chave, tudo desligado: a Casa escondeu o valor no Avec e o aviso de confirmação é opcional. */
export async function getProAppSettings(q: Tx | typeof db = db): Promise<ProAppSettings> {
  const [r] = await q.select({ value: settings.value }).from(settings).where(eq(settings.key, "app_profissional"));
  const v = proAppSchema.partial().safeParse(r?.value);
  return { ...PRO_APP_DEFAULT, ...(v.success ? v.data : {}) };
}

export async function saveProAppSettings(input: unknown, userId: string): Promise<void> {
  const v = proAppSchema.parse(input);
  await db.insert(settings).values({ key: "app_profissional", value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: "app_profissional", data: v });
}
