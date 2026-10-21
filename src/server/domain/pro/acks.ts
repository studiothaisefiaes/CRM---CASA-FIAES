import { sql } from "drizzle-orm";
import { db } from "../../db";
import { proDayAcks } from "../../db/schema";
import { shiftDay } from "@/lib/agenda";
import { slotMs } from "@/lib/schedule";
import type { ProContext } from "../../queries/pro";

/** "Vi minha agenda de amanhã": grava (ou atualiza) quando ela viu a agenda daquele dia. */
export async function ackDay(pro: ProContext, day: string, now = new Date()): Promise<void> {
  await db.insert(proDayAcks).values({ professionalId: pro.professionalId, day, ackedAt: now, ackedBy: pro.userId })
    .onConflictDoUpdate({ target: [proDayAcks.professionalId, proDayAcks.day], set: { ackedAt: now, ackedBy: pro.userId } });
}

export type DayAck = { ackedAt: string; changedAfter: boolean };

/**
 * Para a Agenda ("Ana viu a agenda de amanhã às 19:02") e para ela: quem viu o dia e se mudou depois.
 * "Mudou" junta dois sinais: um horário dela daquele dia com `updated_at` depois do "vi", ou um aviso dela daquele dia
 * (URL `/pro/dia/<dia>`) criado depois. O aviso é o que pega o horário que saiu da agenda dela.
 */
export async function dayAcks(day: string): Promise<Record<string, DayAck>> {
  const from = new Date(slotMs(day, "00:00")).toISOString(), to = new Date(slotMs(shiftDay(day, 1), "00:00")).toISOString();
  const r = await db.execute(sql`
    select k.professional_id as id, k.acked_at as "ackedAt",
      (exists (select 1 from appointments a where a.professional_id = k.professional_id and a.avec_twin_of is null
                 and a.starts_at >= ${from}::timestamptz and a.starts_at < ${to}::timestamptz and a.updated_at > k.acked_at)
       or exists (select 1 from pro_notifications n where n.professional_id = k.professional_id and n.created_at > k.acked_at
                 and n.url like ${`/pro/dia/${day}%`})) as "changedAfter"
    from pro_day_acks k where k.day = ${day}::date`);
  return Object.fromEntries((r.rows as { id: string; ackedAt: Date | string; changedAfter: boolean }[]).map((x) => [x.id, { ackedAt: new Date(x.ackedAt).toISOString(), changedAfter: x.changedAfter }]));
}
