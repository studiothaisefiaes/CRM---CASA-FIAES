import { asc, inArray, isNotNull, and, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, professionals } from "../db/schema";
import { todayBahia } from "@/lib/agenda";
import { displayName } from "@/lib/display-name";
import { photoVersionOf, proPhotoUrl } from "@/lib/pro-photo";
import type { DayVisit } from "@/lib/day-visit";
import type { LivePro } from "@/lib/ao-vivo";
import { dayVisitsOf } from "./day-visit";

export type LiveBoardData = { day: string; visits: DayVisit[]; pros: LivePro[]; startedAt: Record<string, string> };

/**
 * Os dados do Ao vivo: as visitas do dia (as mesmas do quadro do Hoje, `dayVisitsOf`), o início real de cada horário (`started_at`, o
 * "Começar") e as profissionais na ordem da Agenda, com foto e de quem são assistentes. Entram as ativas e quem tem horário no dia
 * (e a principal dela). Sem valores: a tela não mostra preço.
 */
export async function getLiveBoardData(now: Date): Promise<LiveBoardData> {
  const day = todayBahia(now);
  const visits = await dayVisitsOf(day, { withValues: false });
  const ids = visits.flatMap((v) => v.services.map((s) => s.appointmentId));
  const [started, all] = await Promise.all([
    ids.length ? db.select({ id: appointments.id, at: appointments.startedAt }).from(appointments).where(and(inArray(appointments.id, ids), isNotNull(appointments.startedAt))) : [],
    db.select({ id: professionals.id, name: professionals.name, active: professionals.active, color: professionals.color, photoPath: professionals.photoPath, assistantOf: professionals.assistantOf })
      .from(professionals).orderBy(sql`${professionals.agendaPosition} asc nulls last`, asc(professionals.name)),
  ]);
  const used = new Set(visits.flatMap((v) => v.services.map((s) => s.professionalId)).filter((x): x is string => !!x));
  for (const p of all) if (used.has(p.id) && p.assistantOf) used.add(p.assistantOf);
  const pros: LivePro[] = all.filter((p) => p.active || used.has(p.id)).map((p) => ({
    id: p.id, name: displayName(p.name), photoUrl: proPhotoUrl(p.id, photoVersionOf(p.photoPath)), color: p.color, assistantOf: p.assistantOf,
  }));
  return { day, visits, pros, startedAt: Object.fromEntries(started.map((r) => [r.id, r.at!.toISOString()])) };
}
