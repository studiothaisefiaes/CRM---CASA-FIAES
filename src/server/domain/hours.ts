import { eq } from "drizzle-orm";
import { db, type Tx } from "../db";
import { settings } from "../db/schema";
import { DEFAULT_HOURS, type BusinessHours } from "../../lib/business-hours";

/** Horário de atendimento salvo pela gestão (Configurações › Etapas); padrão seg–sex 8–20, sáb 8–17. */
export async function getBusinessHours(tx: Tx | typeof db = db): Promise<BusinessHours> {
  const [r] = await tx.select().from(settings).where(eq(settings.key, "business_hours"));
  return (r?.value as BusinessHours | undefined) ?? DEFAULT_HOURS;
}
