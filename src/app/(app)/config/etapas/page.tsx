import { requirePerm } from "@/server/auth/session";
import { asc } from "drizzle-orm";
import { db } from "@/server/db";
import { profiles, stages } from "@/server/db/schema";
import { StagesEditor } from "@/components/config/stages";
import { HoursEditor } from "@/components/config/hours";
import { getWeekHours } from "@/server/domain/hours";
import { getSpecialDays } from "@/server/domain/special-days";
import { funcaoLigada, funcaoParam } from "@/server/domain/funcoes";
import { SpecialDaysEditor } from "@/components/config/special-days";
import { todayBahia } from "@/lib/agenda";
import { can } from "@/lib/permissions";
export const metadata = { title: "Etapas e prazos" };
/** Horário de funcionamento e Etapas e prazos são dois itens (`?parte=`); sem `parte` (endereço antigo), mostra os dois. */
export default async function EtapasPage({ searchParams }: PageProps<"/config/etapas">) {
  const user = await requirePerm("config.sistema");
  const p = (await searchParams).parte;
  const parte = p === "horario" || p === "etapas" ? p : null;
  const showEspeciais = parte !== "etapas" && can(user.perms, "horario.dias_especiais");
  const [st, hours, profs, especiais] = await Promise.all([
    db.select().from(stages).orderBy(asc(stages.position)), getWeekHours(),
    db.select({ id: profiles.id, name: profiles.name, key: profiles.key }).from(profiles).orderBy(asc(profiles.name)),
    showEspeciais ? Promise.all([getSpecialDays(), funcaoParam("dias_especiais", "dias_a_frente"), funcaoLigada("dias_especiais")]) : null,
  ]);
  return (
    <>
      {parte !== "etapas" && <HoursEditor hours={hours} />}
      {especiais && <SpecialDaysEditor days={especiais[0]} diasAFrente={especiais[1]} ligada={especiais[2]} today={todayBahia(new Date())} />}
      {parte !== "horario" && <StagesEditor
        stages={st.map((s) => ({ id: s.id, key: s.key, name: s.name, kind: s.kind, slaMinutes: s.slaMinutes, staleDays: s.staleDays, color: s.color, active: s.active, visibleProfileIds: s.visibleProfileIds, attemptDays: s.attemptDays }))}
        profiles={profs.filter((p) => p.key !== "gestao").map(({ id, name }) => ({ id, name }))} />}
    </>
  );
}
