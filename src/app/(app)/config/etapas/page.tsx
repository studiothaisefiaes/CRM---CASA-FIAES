import { asc } from "drizzle-orm";
import { db } from "@/server/db";
import { stages } from "@/server/db/schema";
import { StagesEditor } from "@/components/config/stages";
export const metadata = { title: "Etapas e prazos" };
export default async function EtapasPage() {
  const st = await db.select().from(stages).orderBy(asc(stages.position));
  return <StagesEditor stages={st.map((s) => ({ id: s.id, key: s.key, name: s.name, kind: s.kind, slaMinutes: s.slaMinutes, staleDays: s.staleDays, color: s.color }))} />;
}
