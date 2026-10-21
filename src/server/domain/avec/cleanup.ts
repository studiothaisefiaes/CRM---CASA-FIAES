import { and, desc, eq, inArray, isNotNull, isNull, like, sql } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { appointments, auditLog, avecRejectedRows, avecReports } from "../../db/schema";
import { dayOf } from "@/lib/agenda";
import { GENERIC_NAME_RE } from "@/lib/generic-client";
import { absorbCrmPlaceholders } from "../agenda/twins";
import { ImportCtx } from "./context";
import { colOf } from "./formats";
import { matchCancellation, reservationKey, type CancelCand } from "./import-agenda";
import { clean, dateIso, normText, plausibleDay, reservationStatus, splitClientName, timeHm } from "./normalize";
import { closeFromAvecSales } from "./sales-close";
import { isSweepReport, parseReservationKey, sweepVanished, type SweepRow } from "./vanished";

/**
 * Limpeza do lixo que a importação antiga do Avec deixou (17/10), num lugar só, com as mesmas regras da importação nova
 * (`scripts/limpar-avec-lixo.ts`). Cada passo roda em lotes, uma transação curta por lote. `apply: false` (--dry-run) faz cada lote
 * e desfaz (ROLLBACK): os números são os que o --aplicar daria, passo a passo. Idempotente: rodar de novo não acha nada.
 * Também cobre o script de dados 05 do coordenador (partes A, B e C) e o 02 ("(completar cadastro)").
 */
export type CleanupReport = {
  completarCadastro: number;
  cancelSemHora: { casados: number; apagados: number };
  padrao: { visitasDesligadas: number; visitasApagadas: number };
  datas: { canceladas: number };
  desconhecidos: number;
  remarcados: { cancelados: number; sinalizados: number };
  juntados: number;
  /** 18/10: Atendimento com o Avec do dia a mais de 2 h (fica, vai para "Conferir com o Avec"). */
  atendimentoConferir: number;
  /** `conferir`: horário do dia da venda que não bate com ela (fica, vai para "Conferir com o Avec"). */
  baixas: { fechados: number; sinalizados: number; conferir: number; chegouEsquecido: number };
};

class DryRun extends Error {}
async function inTx<T>(apply: boolean, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out!: T;
  try {
    await db.transaction(async (tx) => { out = await fn(tx); if (!apply) throw new DryRun(); });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  return out;
}
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Horário que nada referencia (comanda, aviso da profissional, nota, gêmeo, resultado da espera): pode ser apagado. */
const UNREFERENCED = sql`not exists (select 1 from comanda_items x where x.appointment_id = a.id)
  and not exists (select 1 from pro_notifications x where x.appointment_id = a.id)
  and not exists (select 1 from client_notes x where x.appointment_id = a.id)
  and not exists (select 1 from appointments x where x.avec_twin_of = a.id or x.wait_result_appointment_id = a.id)`;

/** 1. Cancelamentos às 00:00 (375 em 17/10): casa com a reserva do dia (cliente + profissional + serviço) e apaga a linha 00:00. */
async function cancelSemHora(apply: boolean, now: Date, batch: number) {
  const ids = (await db.select({ id: appointments.id }).from(appointments).where(like(appointments.externalKey, "avec:res:%T--:--%"))).map((r) => r.id);
  const total = { casados: 0, apagados: 0 };
  for (const part of chunks(ids, batch)) {
    const r = await inTx(apply, async (tx) => {
      let casados = 0, apagados = 0;
      for (const z of await tx.select().from(appointments).where(inArray(appointments.id, part))) {
        const day = z.externalKey.slice("avec:res:".length, "avec:res:".length + 10);
        const clientKey = z.externalKey.split("|")[1] ?? "";
        const cands: (CancelCand & { id: string; crmTouchedAt: Date | null; createdAt: Date })[] = (await tx.select({ id: appointments.id, key: appointments.externalKey, status: appointments.status,
          professionalId: appointments.professionalId, serviceLabel: appointments.serviceLabel, contactId: appointments.contactId, crmTouchedAt: appointments.crmTouchedAt, createdAt: appointments.createdAt })
          .from(appointments).where(and(like(appointments.externalKey, `avec:res:${day}T%`), sql`${appointments.externalKey} not like '%T--:--%'`)))
          .filter((c) => c.createdAt <= z.createdAt) // reserva criada depois do 00:00 veio de relatório mais novo, que a diz viva: não é ela
          .filter((c) => (z.contactId && c.contactId === z.contactId) || c.key.split("|")[1] === clientKey);
        const m = matchCancellation(cands, { professionalId: z.professionalId, service: z.serviceLabel === "Não informado" ? null : z.serviceLabel });
        if (m && m !== "ja_cancelado") {
          const c = cands.find((x) => x.key === m.key)!;
          if (c.crmTouchedAt) await tx.update(appointments).set({ avecStatus: "cancelado", updatedAt: now }).where(eq(appointments.id, c.id));
          else {
            await tx.update(appointments).set({ status: "cancelado", cancelledVia: "avec", cancelledAt: now, updatedAt: now }).where(eq(appointments.id, c.id));
            await tx.insert(auditLog).values({ userId: null, action: "avec_cancelamento_casado", entity: "appointment", entityId: c.id, data: { de: c.status, para: "cancelado" } });
          }
          casados++;
        }
        const del = await tx.execute(sql`delete from appointments a where a.id = ${z.id} and ${UNREFERENCED} returning a.id`);
        if (del.rows.length) {
          await tx.insert(auditLog).values({ userId: null, action: "avec_lixo_apagado", entity: "appointment", entityId: z.id, data: { motivo: "cancelamento sem hora (00:00)", chave: z.externalKey } });
          apagados++;
        }
      }
      return { casados, apagados };
    });
    total.casados += r.casados; total.apagados += r.apagados;
  }
  return total;
}

/** 2. CLIENTE PADRÃO: sai da visita; a visita que fica vazia (e sem comanda nem link) é apagada. */
async function padrao(apply: boolean) {
  return inTx(apply, async (tx) => {
    const off = await tx.execute(sql`with old as (select id, visit_id from appointments where visit_id is not null and contact_id is null and client_name ~* ${GENERIC_NAME_RE})
      update appointments a set visit_id = null from old where a.id = old.id returning old.visit_id`);
    const visitIds = [...new Set((off.rows as { visit_id: string }[]).map((r) => r.visit_id))];
    let visitasApagadas = 0;
    for (const part of chunks(visitIds, 500)) {
      const del = await tx.execute(sql`delete from visits v where v.id in (${sql.join(part.map((x) => sql`${x}`), sql`, `)})
        and not exists (select 1 from appointments a where a.visit_id = v.id) and not exists (select 1 from comandas c where c.visit_id = v.id)
        and not exists (select 1 from client_links l where l.visit_id = v.id) returning v.id`);
      visitasApagadas += del.rows.length;
    }
    return { visitasDesligadas: off.rows.length, visitasApagadas };
  });
}

/** 3. Data impossível (= parte A do script 05): vai para as recusadas e o horário é cancelado como engano (não apaga). */
async function datas(apply: boolean, now: Date) {
  const rows = await db.select().from(appointments).where(inArray(appointments.status, ["agendado", "confirmado", "conferir", "espera"]));
  const bad = rows.filter((a) => !plausibleDay(dayOf(a.startsAt), now));
  return inTx(apply, async (tx) => {
    for (const a of bad) {
      const k = parseReservationKey(a.externalKey);
      await tx.insert(avecRejectedRows).values({ externalKey: `avec:rej:${a.externalKey}`, reason: "data_fora_do_limite", day: k?.day ?? dayOf(a.startsAt), hm: k?.hm ?? null,
        clientName: a.clientName, contactId: a.contactId, serviceLabel: a.serviceLabel, lastSeenAt: now }).onConflictDoNothing();
      const year = (k?.day ?? dayOf(a.startsAt)).slice(0, 4);
      await tx.update(appointments).set({ status: "cancelado", cancelReason: "engano", cancelledVia: "avec", cancelledAt: now, updatedAt: now, crmTouchedAt: now,
        cancelNote: `Ano impossível vindo do Avec (${year}).` }).where(eq(appointments.id, a.id));
      await tx.insert(auditLog).values({ userId: null, action: "avec_data_impossivel", entity: "appointment", entityId: a.id, data: { de: a.status, para: "cancelado", ano: year } });
    }
    return { canceladas: bad.length };
  });
}

/** 4. Status que o CRM não conhece e que virou agendado/confirmado: vai para `conferir` (o texto do Avec já está em `avec_status`). */
async function desconhecidos(apply: boolean, now: Date) {
  const rows = await db.select({ id: appointments.id, avecStatus: appointments.avecStatus }).from(appointments)
    .where(and(eq(appointments.origin, "avec"), isNull(appointments.crmTouchedAt), isNull(appointments.avecTwinOf), inArray(appointments.status, ["agendado", "confirmado"]), isNotNull(appointments.avecStatus)));
  const ids = rows.filter((r) => reservationStatus(r.avecStatus).status === "conferir").map((r) => r.id);
  let n = 0;
  for (const part of chunks(ids, 500)) n += await inTx(apply, async (tx) => (await tx.update(appointments).set({ status: "conferir", updatedAt: now }).where(inArray(appointments.id, part)).returning({ id: appointments.id })).length);
  return n;
}

/** 5. Remarcações antigas: cada dia pelo relatório "Reservas" mais recente que o traz (guardado em `avec_reports`), como a varredura da importação. */
async function remarcados(apply: boolean, now: Date) {
  const reports = (await db.select({ id: avecReports.id, columns: avecReports.columns, importedAt: avecReports.importedAt }).from(avecReports)
    .orderBy(desc(avecReports.importedAt))).filter((r) => isSweepReport(r.columns)); // pelo nome das colunas, não pela assinatura (QA r66, I-4)
  const handled = new Set<string>();
  const total = { cancelados: 0, sinalizados: 0 };
  for (const rep of reports) {
    const [full] = await db.select({ columns: avecReports.columns, rows: avecReports.rows }).from(avecReports).where(eq(avecReports.id, rep.id));
    const ix = { day: colOf(full.columns, "data reserva"), hm: colOf(full.columns, "hora"), client: colOf(full.columns, "cliente"), pro: colOf(full.columns, "profissional"), service: colOf(full.columns, "servico") };
    if (ix.day < 0 || ix.hm < 0 || ix.client < 0 || ix.pro < 0) continue;
    const parsed = full.rows.map((r) => ({ day: dateIso(r[ix.day]), hm: timeHm(r[ix.hm]), name: splitClientName(r[ix.client]).name, pro: clean(r[ix.pro]), service: clean(r[ix.service]) }))
      .filter((r): r is { day: string; hm: string; name: string | null; pro: string | null; service: string | null } => !!r.day && !!r.hm && plausibleDay(r.day, now) && !handled.has(r.day));
    const days = [...new Set(parsed.map((r) => r.day))].sort();
    for (const part of chunks(days, 30)) {
      const set = new Set(part);
      const r = await inTx(apply, async (tx) => {
        const ctx = new ImportCtx(tx, [], [], [], { now });
        const rows: SweepRow[] = [];
        for (const p of parsed.filter((x) => set.has(x.day))) {
          rows.push({ key: reservationKey(p.day, p.hm, p.name, p.service), day: p.day, hm: p.hm, clientKey: normText(p.name), professionalId: p.pro ? await ctx.professionalId(p.pro) : null });
        }
        return sweepVanished(tx, { rows, now, createdBefore: rep.importedAt });
      });
      total.cancelados += r.cancelled; total.sinalizados += r.flagged;
    }
    for (const d of days) handled.add(d);
  }
  return total;
}

/**
 * 7. Baixas: "chegou" esquecido de dia anterior com venda ou comanda no dia (parte B do script 05: fecha mesmo mexido no CRM, porque o
 * Chegou foi do CRM e a venda prova o fim) e horário passado com venda do Avec (parte C, `closeFromAvecSales`). Por lote de pares
 * (cliente, dia), a parte B do lote roda antes da C na mesma transação: o --dry-run dá o mesmo número que o --aplicar.
 */
async function baixas(apply: boolean, now: Date, batch: number) {
  const today = sql`(date_trunc('day', ${now.toISOString()}::timestamptz at time zone 'America/Bahia') at time zone 'America/Bahia')`;
  const chegou = (tx: Tx, pairs: { contactId: string; day: string }[]) => {
    const ids = `{${pairs.map((p) => p.contactId).join(",")}}`, days = `{${pairs.map((p) => p.day).join(",")}}`;
    return tx.execute(sql`update appointments a set status = 'compareceu', finished_at = coalesce(a.finished_at, a.arrived_at), avec_status = coalesce(a.avec_status, a.status),
        updated_at = ${now.toISOString()}::timestamptz, crm_touched_at = ${now.toISOString()}::timestamptz
      from unnest(${ids}::uuid[], ${days}::date[]) as v(contact_id, day)
      where a.contact_id = v.contact_id and (a.starts_at at time zone 'America/Bahia')::date = v.day
        and a.status = 'chegou' and a.avec_twin_of is null and a.starts_at < ${today}
      returning a.id`);
  };
  const audit = async (tx: Tx, rows: unknown[]) => {
    for (const x of rows as { id: string }[]) await tx.insert(auditLog).values({ userId: null, action: "avec_baixa_comanda", entity: "appointment", entityId: x.id, data: { de: "chegou", para: "compareceu" } });
  };
  // Comanda do caixa do CRM no dia, sem venda do Avec: só a parte B.
  const crmOnly = (await db.execute(sql`select distinct contact_id::text as "contactId", day::text as day from comandas c
    where c.contact_id is not null and c.cancelled_at is null and c.status <> 'cancelada'
      and not exists (select 1 from sales_items s where s.contact_id = c.contact_id and s.sold_on = c.day)
      and not exists (select 1 from sales_payments p where p.contact_id = c.contact_id and coalesce(p.comanda_on, p.paid_on) = c.day)`)).rows as { contactId: string; day: string }[];
  let chegouEsquecido = 0;
  for (const part of chunks(crmOnly, batch)) chegouEsquecido += await inTx(apply, async (tx) => { const r = await chegou(tx, part); await audit(tx, r.rows); return r.rows.length; });
  const pairs = (await db.execute(sql`select distinct contact_id::text as "contactId", day::text as day from (
      select contact_id, sold_on as day from sales_items where contact_id is not null
      union select contact_id, coalesce(comanda_on, paid_on) from sales_payments where contact_id is not null and coalesce(comanda_on, paid_on) is not null) v
    order by 1, 2`)).rows as { contactId: string; day: string }[];
  const total = { fechados: 0, sinalizados: 0, conferir: 0, chegouEsquecido };
  for (const part of chunks(pairs, batch)) {
    const r = await inTx(apply, async (tx) => {
      const b = await chegou(tx, part);
      await audit(tx, b.rows);
      return { b: b.rows.length, ...(await closeFromAvecSales(tx, part, now)) };
    });
    total.chegouEsquecido += r.b; total.fechados += r.closed; total.sinalizados += r.flagged; total.conferir += r.review;
  }
  return total;
}

export async function runAvecCleanup(opts: { apply: boolean; now: Date; batch?: number; log?: (s: string) => void }): Promise<CleanupReport> {
  const { apply, now } = opts;
  const batch = opts.batch ?? 200;
  const log = opts.log ?? (() => {});
  const completarCadastro = await inTx(apply, (tx) => new ImportCtx(tx, [], [], [], { now }).cleanCompleteProfileNames());
  log(`(completar cadastro): ${completarCadastro}`);
  const cs = await cancelSemHora(apply, now, batch);
  log(`cancelamentos às 00:00: ${cs.casados} casados, ${cs.apagados} apagados`);
  const pd = await padrao(apply);
  log(`CLIENTE PADRÃO: ${pd.visitasDesligadas} horários fora da visita, ${pd.visitasApagadas} visitas apagadas`);
  const dt = await datas(apply, now);
  log(`datas impossíveis: ${dt.canceladas}`);
  const dc = await desconhecidos(apply, now);
  log(`status desconhecido → conferir: ${dc}`);
  const rm = await remarcados(apply, now);
  log(`remarcações (sumiu do Avec): ${rm.cancelados} canceladas, ${rm.sinalizados} só anotadas`);
  const jn = await inTx(apply, (tx) => absorbCrmPlaceholders(tx, { now }));
  log(`Atendimento da conversa junto com o Avec: ${jn.joined} (${jn.review} a mais de 2 h, para conferir)`);
  const bx = await baixas(apply, now, batch * 2);
  log(`baixas pela venda: ${bx.fechados} fechados, ${bx.sinalizados} só anotados, ${bx.conferir} para conferir, ${bx.chegouEsquecido} "chegou" esquecido`);
  return { completarCadastro, cancelSemHora: cs, padrao: pd, datas: dt, desconhecidos: dc, remarcados: rm, juntados: jn.joined, atendimentoConferir: jn.review, baixas: bx };
}

