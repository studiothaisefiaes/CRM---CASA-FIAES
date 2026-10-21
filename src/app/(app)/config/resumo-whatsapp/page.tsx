import { and, asc, eq, sql } from "drizzle-orm";
import { requirePerm } from "@/server/auth/session";
import { db } from "@/server/db";
import { profiles, users } from "@/server/db/schema";
import { getSummaryWhatsapp } from "@/server/domain/summary-whatsapp";
import { SummaryWhatsappSettings } from "@/components/config/summary-whatsapp";

export const metadata = { title: "Resumo do dia no WhatsApp" };

export default async function ResumoWhatsappPage() {
  await requirePerm("config.sistema");
  // Quem pode receber: pessoas ativas com "Ver números de toda a equipe" (o resumo mostra a Casa inteira).
  const rows = await db.select({ id: users.id, name: users.name, key: profiles.key })
    .from(users).innerJoin(profiles, eq(profiles.id, users.profileId))
    .where(and(eq(users.active, true), sql`'relatorios.equipe' = any(${profiles.permissions})`)).orderBy(asc(users.name));
  return <SummaryWhatsappSettings initial={await getSummaryWhatsapp()} people={rows.map((r) => ({ id: r.id, name: r.name, gestao: r.key === "gestao" }))} />;
}
