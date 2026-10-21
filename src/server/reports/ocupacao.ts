import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { professionals } from "../db/schema";
import { rows } from "./common";
import { can, canSeeSalon } from "../../lib/permissions";
import { dayOf, entryDuration, hmToMinutes, minuteOfDay } from "../../lib/agenda";
import { blockAppliesOn } from "../../lib/agenda-blocks";
import { effectiveRanges } from "../../lib/work-hours";
import { availableMinutes, clippedMinutes, subtractRanges, type MinRange } from "../../lib/occupancy-math";
import type { SalonRange } from "../../lib/salon-period";
import { getBusinessHours } from "../domain/hours";
import { assertOcupacaoOn } from "../domain/relatorios-config";
import { UserFacingError } from "../domain/errors";

/**
 * Salão › Ocupação: mapa de calor (dia da semana x hora) dos horários marcados e a ocupação de cada profissional
 * (agendado dentro do horário de trabalho ÷ disponível). Quem vê: `canSeeSalon`; a medida "Valor" pede `valores.ver`.
 */
export type OcupacaoMedida = "horarios" | "valor";
export type OcupacaoView = {
  range: SalonRange; money: boolean; medida: OcupacaoMedida; professionalId: string | null;
  grid: number[][]; /* [dia da semana 0..6][hora 0..23] */
  professionals: { id: string; name: string; availableMin: number; bookedMin: number; pct: number | null; days: number }[];
};

/** Horários que entram: marcados ou em andamento ou já atendidos; faltou, cancelado e espera ficam de fora. */
const STATUSES = ["agendado", "confirmado", "chegou", "em_atendimento", "compareceu"];

type Appt = { professionalId: string | null; startsAt: Date; durationMin: number | null; bufferMin: number | null; priceCents: number | null };
type BlockRow = { professionalId: string | null; startsOn: string; endsOn: string; startTime: string; endTime: string; weekdays: number[] | null };

const eachDay = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

export async function loadOcupacao(user: { perms: readonly string[] }, range: SalonRange, o: { professionalId?: string | null; medida?: OcupacaoMedida }): Promise<OcupacaoView> {
  if (!canSeeSalon(user.perms)) throw new UserFacingError("Você não tem permissão para ver a Ocupação.");
  await assertOcupacaoOn();
  const money = can(user.perms, "valores.ver");
  const medida: OcupacaoMedida = money && o.medida === "valor" ? "valor" : "horarios";
  const professionalId = o.professionalId || null;

  const [pros, appts, blocks, casa] = await Promise.all([
    db.select({ id: professionals.id, name: professionals.name, workHours: professionals.workHours }).from(professionals)
      .where(and(eq(professionals.active, true))).orderBy(asc(professionals.agendaPosition), asc(professionals.name)),
    // Hora de início em Salvador; "sem hora" do Avec (00:00) e gêmeos do Avec ficam de fora.
    rows<{ professionalId: string | null; startsAt: Date; durationMin: number | null; bufferMin: number | null; priceCents: number | null }>(sql`
      select a.professional_id as "professionalId", a.starts_at as "startsAt", coalesce(a.duration_min, l.duration_min) as "durationMin",
        coalesce(a.buffer_min, l.buffer_min) as "bufferMin", a.price_cents as "priceCents"
      from appointments a left join lists l on l.id = a.service_id
      where a.status in (${sql.join(STATUSES.map((s) => sql`${s}`), sql`, `)}) and a.avec_twin_of is null
        and ((a.starts_at at time zone 'America/Bahia')::date) between ${range.from}::date and ${range.to}::date
        and ((a.starts_at at time zone 'America/Bahia')::time) <> time '00:00'`),
    // Só o que tira tempo: bloqueio normal ou folga aprovada. Pedido de folga (só avisa), recusado e apagado não tiram.
    rows<BlockRow>(sql`
      select professional_id as "professionalId", starts_on::text as "startsOn", ends_on::text as "endsOn", start_time as "startTime", end_time as "endTime", weekdays
      from agenda_blocks
      where deleted_at is null and (request_status is null or request_status = 'aprovado')
        and starts_on <= ${range.to}::date and ends_on >= ${range.from}::date`),
    getBusinessHours(),
  ]);
  const list = appts.map((a): Appt => ({ ...a, startsAt: new Date(a.startsAt) }));

  // Mapa de calor: todas as profissionais (e horários sem profissional) ou só a escolhida.
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const a of list) {
    if (professionalId && a.professionalId !== professionalId) continue;
    const day = dayOf(a.startsAt);
    grid[new Date(`${day}T00:00:00Z`).getUTCDay()][Math.floor(minuteOfDay(a.startsAt) / 60)] += medida === "valor" ? (a.priceCents ?? 0) : 1;
  }

  // Ocupação por profissional ativa e por dia do período.
  const days = eachDay(range.from, range.to);
  const byPro = new Map<string, Map<string, MinRange[]>>();
  for (const a of list) {
    if (!a.professionalId) continue;
    const start = minuteOfDay(a.startsAt), dur = entryDuration(a.durationMin, null).minutes;
    const perDay = byPro.get(a.professionalId) ?? new Map<string, MinRange[]>();
    const day = dayOf(a.startsAt);
    perDay.set(day, [...(perDay.get(day) ?? []), [start, Math.min(1440, start + dur + Math.max(0, a.bufferMin ?? 0))]]);
    byPro.set(a.professionalId, perDay);
  }
  const result = pros.map((p) => {
    let availableMin = 0, bookedMin = 0, worked = 0;
    for (const day of days) {
      const ranges = effectiveRanges(day, p.workHours ?? null, casa);
      if (!ranges.length) continue;
      const bl: MinRange[] = blocks
        .filter((b) => (b.professionalId === null || b.professionalId === p.id) && blockAppliesOn({ startsOn: b.startsOn, endsOn: b.endsOn, weekdays: b.weekdays }, day))
        .flatMap((b) => { const s = hmToMinutes(b.startTime), e = hmToMinutes(b.endTime); return s != null && e != null && e > s ? [[s, e] as MinRange] : []; });
      const avail = availableMinutes(ranges, bl);
      if (avail <= 0) continue;
      worked++;
      availableMin += avail;
      bookedMin += clippedMinutes(byPro.get(p.id)?.get(day) ?? [], subtractRanges(ranges, bl));
    }
    return { id: p.id, name: p.name, availableMin, bookedMin, pct: availableMin > 0 ? Math.round((100 * bookedMin) / availableMin) : null, days: worked };
  });
  result.sort((a, b) => (a.pct == null ? 1 : 0) - (b.pct == null ? 1 : 0) || (b.pct ?? 0) - (a.pct ?? 0) || a.name.localeCompare(b.name, "pt-BR"));
  return { range, money, medida, professionalId, grid, professionals: result };
}
