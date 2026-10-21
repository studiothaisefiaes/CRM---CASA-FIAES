import { and, eq, gte, inArray, isNull, like, lt, notLike, sql } from "drizzle-orm";
import type { Tx } from "../../db";
import { appointments, auditLog } from "../../db/schema";
import { bahiaAt } from "./normalize";
import { colOf } from "./formats";

/**
 * "Sumiu do Avec" (17/10): remarcar no Avec muda a hora da reserva sem mandar cancelamento; a chave da reserva tem a hora, então a antiga
 * ficava "agendado" para sempre (9 em 30 dias; ex.: pedicure 11:30 e 15:00 vivas, a cliente veio 13:30).
 *
 * Só o relatório "Reservas" (f18900ac) varre: ele é filtrado pela Data Reserva e traz todos os status, então o dia que aparece nele está
 * completo. O "Reservas (quem cadastrou)" (1903eedc) é filtrado pela data de CADASTRO (arquivo de 17/10: cadastro 15–16/10, reservas até
 * 10/12): um dia dele não está completo e varrer apagaria reserva viva.
 *
 * Grupo = cliente + dia + profissional que o relatório traz. A reserva ativa do Avec desse grupo que não veio no relatório é cancelada
 * (motivo `remarcado`, via `avec`); mexida no CRM, só ganha `avec_status = 'cancelado'` (aparece em "Conferir com o Avec").
 * Relatório filtrado por uma profissional não toca as outras; cliente que não está no relatório não é tocada.
 */
export const SWEEP_SIGNATURES = new Set(["f18900ac"]);
/**
 * O relatório "Reservas" pelo NOME das colunas, não pela assinatura nem pela posição (QA r66, I-4): coluna a mais ou em outra ordem continua
 * sendo o mesmo relatório. O "Reservas (quem cadastrou)" (1903eedc) não tem "Data Cadastro Reserva": é filtrado pela data de cadastro e não varre.
 */
export function isSweepReport(columns: string[]): boolean {
  return ["data cadastro reserva", "data reserva", "hora", "cliente", "profissional", "status"].every((n) => colOf(columns, n) >= 0);
}
const ALIVE = ["agendado", "confirmado", "solicitado", "conferir"];

export type SweepRow = { key: string; day: string; hm: string; clientKey: string; professionalId: string | null };

/** "avec:res:2026-10-15T11:30|carla werneck|pedicure" → dia, hora e o pedaço da cliente. */
export function parseReservationKey(key: string): { day: string; hm: string; clientKey: string } | null {
  const m = /^avec:res:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})\|([^|]*)\|/.exec(key);
  return m ? { day: m[1], hm: m[2], clientKey: m[3] } : null;
}

export async function sweepVanished(tx: Tx, input: { rows: SweepRow[]; now: Date; /** Só o que já existia antes (o script passa a hora do relatório); padrão: antes desta transação. */ createdBefore?: Date }):
  Promise<{ cancelled: number; flagged: number }> {
  const present = new Set(input.rows.map((r) => r.key));
  const groups = new Map<string, string[]>();
  for (const r of input.rows) {
    if (!r.professionalId) continue;
    const g = `${r.day}|${r.clientKey}|${r.professionalId}`;
    groups.set(g, [...(groups.get(g) ?? []), r.hm]);
  }
  if (!groups.size) return { cancelled: 0, flagged: 0 };
  const days = [...new Set(input.rows.map((r) => r.day))].sort();
  const from = bahiaAt(days[0], "00:00"), to = new Date(bahiaAt(days[days.length - 1], "00:00").getTime() + 86_400_000);
  const cands = await tx.select({ id: appointments.id, key: appointments.externalKey, professionalId: appointments.professionalId, status: appointments.status,
    crmTouchedAt: appointments.crmTouchedAt, avecStatus: appointments.avecStatus })
    .from(appointments)
    .where(and(eq(appointments.origin, "avec"), like(appointments.externalKey, "avec:res:%"), notLike(appointments.externalKey, "%T--:--%"), isNull(appointments.avecTwinOf),
      inArray(appointments.status, ALIVE), gte(appointments.startsAt, from), lt(appointments.startsAt, to),
      input.createdBefore ? lt(appointments.createdAt, input.createdBefore) : sql`${appointments.createdAt} < now()`));
  let cancelled = 0, flagged = 0;
  for (const a of cands) {
    if (present.has(a.key) || !a.professionalId) continue;
    const k = parseReservationKey(a.key);
    const hours = k && groups.get(`${k.day}|${k.clientKey}|${a.professionalId}`);
    if (!k || !hours) continue;
    if (a.crmTouchedAt) {
      if (a.avecStatus === "cancelado") continue;
      await tx.update(appointments).set({ avecStatus: "cancelado", updatedAt: input.now }).where(eq(appointments.id, a.id));
      flagged++;
      continue;
    }
    const note = `Sumiu do Avec (remarcado para ${[...new Set(hours)].sort().join(" e ")}).`;
    await tx.update(appointments).set({ status: "cancelado", cancelReason: "remarcado", cancelledVia: "avec", cancelledAt: input.now, cancelNote: note, updatedAt: input.now })
      .where(eq(appointments.id, a.id));
    await tx.insert(auditLog).values({ userId: null, action: "avec_sumiu", entity: "appointment", entityId: a.id, data: { de: a.status, para: "cancelado", motivo: "remarcado" } });
    cancelled++;
  }
  return { cancelled, flagged };
}
