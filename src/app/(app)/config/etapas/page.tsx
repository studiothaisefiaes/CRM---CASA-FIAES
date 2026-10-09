import { asc } from "drizzle-orm";
import { db } from "@/server/db";
import { stages } from "@/server/db/schema";
import { StagesEditor } from "@/components/config/stages";
import { HoursEditor } from "@/components/config/hours";
import { getBusinessHours } from "@/server/rules/engine";
export const metadata = { title: "Etapas e prazos" };
export default async function EtapasPage() {
  const [st, hours] = await Promise.all([db.select().from(stages).orderBy(asc(stages.position)), getBusinessHours()]);
  return <><HoursEditor hours={hours} /><StagesEditor stages={st.map((s) => ({ id: s.id, key: s.key, name: s.name, kind: s.kind, slaMinutes: s.slaMinutes, staleDays: s.staleDays, color: s.color }))} /></>;
}
