import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { appointments, auditLog, avecRejectedRows, contacts, settings } from "../../db/schema";
import { normText } from "../avec/normalize";
import { CLOSABLE } from "../avec/sales-close";
import { dayOf } from "@/lib/agenda";
import { statusGroup } from "@/lib/appointment-status";

/** O relógio do banco: o `created_at` das linhas importadas vem dele, então "o que acabou de entrar" se mede por ele. */
export async function dbNow(q: Tx | typeof db = db): Promise<Date> {
  const r = await q.execute(sql`select now() as now`);
  return new Date((r.rows[0] as { now: string | Date }).now);
}

type Ref = { contactId: string | null; clientName: string | null; contactName?: string | null; serviceId: string | null; serviceLabel: string };
const sameClient = (a: Ref, b: Ref) => (a.contactId && b.contactId ? a.contactId === b.contactId : normText(a.contactName ?? a.clientName) === normText(b.contactName ?? b.clientName));
const sameService = (a: Ref, b: Ref) => (a.serviceId && b.serviceId ? a.serviceId === b.serviceId : normText(a.serviceLabel) === normText(b.serviceLabel));
const WAIT = ["espera", "espera_encaixada", "espera_desistiu"];

/**
 * Gêmeos (6.4, regra 11): cada reserva do Avec que acabou de entrar (criada a partir de `from`) e é o mesmo horário de um registro do CRM
 * (criado aqui, ou do Avec e mexido aqui) — mesma cliente, mesmo início, mesmo serviço — vira gêmea dele: some da grade, não ocupa,
 * não entra no funil e nunca muda o do CRM. Casa com o registro do CRM em qualquer status (menos lista de espera), preferindo um aberto:
 * uma reserva esquecida no Avec nunca reativa o horário nem o funil. Serviços diferentes no mesmo horário não são gêmeos.
 */
export async function pairAvecTwins(tx: Tx, opts: { from: Date }): Promise<{ paired: number }> {
  const fresh = await tx.select({ id: appointments.id, contactId: appointments.contactId, clientName: appointments.clientName, contactName: contacts.name,
    serviceId: appointments.serviceId, serviceLabel: appointments.serviceLabel, startsAt: appointments.startsAt })
    .from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(and(eq(appointments.origin, "avec"), gte(appointments.createdAt, opts.from), isNull(appointments.avecTwinOf), isNull(appointments.crmTouchedAt), notInArray(appointments.status, WAIT)));
  let paired = 0;
  for (const f of fresh) {
    const cands = await tx.select({ id: appointments.id, contactId: appointments.contactId, clientName: appointments.clientName, contactName: contacts.name,
      serviceId: appointments.serviceId, serviceLabel: appointments.serviceLabel, status: appointments.status })
      .from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId))
      .where(and(eq(appointments.startsAt, f.startsAt), ne(appointments.id, f.id), isNull(appointments.avecTwinOf), notInArray(appointments.status, WAIT),
        or(eq(appointments.origin, "crm"), isNotNull(appointments.crmTouchedAt))));
    const twin = cands.filter((c) => sameClient(f, c) && sameService(f, c))
      .sort((a, b) => Number(statusGroup(b.status) === "ativo") - Number(statusGroup(a.status) === "ativo"))[0];
    if (!twin) continue;
    await tx.update(appointments).set({ avecTwinOf: twin.id }).where(eq(appointments.id, f.id));
    await tx.insert(auditLog).values({ userId: null, action: "avec_gemeo", entity: "appointment", entityId: f.id, data: { de: null, para: twin.id } });
    paired++;
  }
  return { paired };
}

/** 18/10: o "Atendimento" só se junta a horário do Avec a até 2 h dele (antes: qualquer horário do mesmo dia). */
export const PLACEHOLDER_WINDOW_MS = 2 * 60 * 60_000;

/**
 * O "Atendimento" do lead (17/10): o horário que o CRM criou a partir do lead (`migrate-scheduled`), sem profissional e sem serviço,
 * duplicava a visita do Avec da mesma cliente no mesmo dia (5 de 8 casos: os dois ficavam vivos, e o lembrete citava "Atendimento").
 * Quando o Avec tem horário da cliente no dia (não cancelado, fora da espera) a até 2 h do Atendimento, eles se juntam: o lead (`deal_id`)
 * e a confirmação passam para esses horários do Avec (sem marcar `crm_touched_at`: o Avec continua atualizando) e o "Atendimento" é
 * cancelado com a nota. Horário do Avec no mesmo dia, mas mais longe (18/10, QA r58 I-14): o Atendimento fica e ganha
 * `avec_review = 'atendimento_longe'` ("Conferir com o Avec"); a recepção decide.
 */
export async function absorbCrmPlaceholders(tx: Tx, opts: { now: Date; contactIds?: string[] }): Promise<{ joined: number; review: number }> {
  const day = sql`(${appointments.startsAt} at time zone 'America/Bahia')::date`;
  const holders = await tx.select().from(appointments)
    .where(and(eq(appointments.origin, "crm"), isNull(appointments.professionalId), isNull(appointments.serviceId), isNull(appointments.avecTwinOf),
      inArray(appointments.status, ["agendado", "confirmado"]), isNotNull(appointments.contactId),
      opts.contactIds ? inArray(appointments.contactId, opts.contactIds.length ? opts.contactIds : ["00000000-0000-0000-0000-000000000000"]) : undefined));
  let joined = 0, review = 0;
  for (const h of holders) {
    const sameDay = await tx.select({ id: appointments.id, status: appointments.status, dealId: appointments.dealId, crmTouchedAt: appointments.crmTouchedAt, startsAt: appointments.startsAt }).from(appointments)
      .where(and(eq(appointments.origin, "avec"), eq(appointments.contactId, h.contactId!), isNull(appointments.avecTwinOf),
        notInArray(appointments.status, ["cancelado", ...WAIT]), sql`${day} = (${h.startsAt.toISOString()}::timestamptz at time zone 'America/Bahia')::date`));
    if (!sameDay.length) continue;
    const avec = sameDay.filter((a) => Math.abs(a.startsAt.getTime() - h.startsAt.getTime()) <= PLACEHOLDER_WINDOW_MS);
    if (!avec.length) {
      if (h.avecReview === "atendimento_longe") continue;
      await tx.update(appointments).set({ avecReview: "atendimento_longe", updatedAt: opts.now }).where(eq(appointments.id, h.id));
      await tx.insert(auditLog).values({ userId: null, action: "avec_atendimento_conferir", entity: "appointment", entityId: h.id, data: { de: null, para: "atendimento_longe", avec: sameDay.map((a) => a.id) } });
      review++;
      continue;
    }
    for (const a of avec) {
      const set: Partial<typeof appointments.$inferInsert> = {};
      if (!a.dealId && h.dealId) set.dealId = h.dealId;
      if (h.status === "confirmado" && a.status === "agendado" && !a.crmTouchedAt) Object.assign(set, { status: "confirmado", confirmedAt: h.confirmedAt ?? opts.now, confirmedVia: h.confirmedVia ?? "recepcao" });
      if (Object.keys(set).length) await tx.update(appointments).set({ ...set, updatedAt: opts.now }).where(eq(appointments.id, a.id));
    }
    await tx.update(appointments).set({ status: "cancelado", cancelReason: "outro", cancelNote: "Junto com o horário do Avec do mesmo dia.", cancelledVia: "avec",
      cancelledAt: opts.now, updatedAt: opts.now, avecReview: null }).where(eq(appointments.id, h.id));
    await tx.insert(auditLog).values({ userId: null, action: "avec_juntou_atendimento", entity: "appointment", entityId: h.id, data: { de: h.status, para: "cancelado", avec: avec.map((a) => a.id) } });
    joined++;
  }
  return { joined, review };
}

export type DivergenceKind = "horario_diferente" | "status_diferente" | "criado_depois_da_virada" | "status_desconhecido" | "venda_sem_par" | "atendimento_longe" | "sem_baixa_no_avec";
export const DIVERGENCE_LABEL: Record<DivergenceKind, string> = {
  horario_diferente: "Horário diferente nos dois sistemas", status_diferente: "Situação diferente no Avec", criado_depois_da_virada: "Criado no Avec depois da troca para só CRM",
  status_desconhecido: "Situação que o CRM não conhece", venda_sem_par: "Venda no Avec sem horário certo",
  atendimento_longe: "Atendimento do CRM e horário do Avec no mesmo dia", sem_baixa_no_avec: "No Avec continua Agendado, sem desfecho",
};
export type AvecDivergence = {
  kind: DivergenceKind; appointmentId: string; avecAppointmentId: string | null; day: string; clientName: string; serviceLabel: string;
  crmStartsAt: string | null; avecStartsAt: string | null; crmStatus: string | null; avecStatus: string | null;
};

/** "Conferir com o Avec" (6.4, regra 12): só leitura. A recepção decide o que fazer; o sistema não corrige sozinho. */
export async function listAvecDivergences(range: { from: Date; to: Date }): Promise<AvecDivergence[]> {
  const rows = await db.select({
    id: appointments.id, contactId: appointments.contactId, clientName: appointments.clientName, contactName: contacts.name, serviceId: appointments.serviceId,
    serviceLabel: appointments.serviceLabel, startsAt: appointments.startsAt, status: appointments.status, avecStatus: appointments.avecStatus, origin: appointments.origin,
    crmTouchedAt: appointments.crmTouchedAt, avecTwinOf: appointments.avecTwinOf, createdAt: appointments.createdAt, avecReview: appointments.avecReview, avecUnclosedAt: appointments.avecUnclosedAt,
  }).from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(and(gte(appointments.startsAt, range.from), lt(appointments.startsAt, range.to), notInArray(appointments.status, WAIT)));
  type Row = (typeof rows)[number];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const nameOf = (r: Row) => r.contactName?.trim() || r.clientName?.trim() || "Sem nome";
  const base = (x: Row, y: Row | null) => ({ appointmentId: x.id, avecAppointmentId: y?.id ?? null, day: dayOf(x.startsAt), clientName: nameOf(x), serviceLabel: x.serviceLabel,
    crmStartsAt: x.startsAt.toISOString(), avecStartsAt: (y ?? x).startsAt.toISOString(), crmStatus: x.status });
  const out: AvecDivergence[] = [];
  for (const y of rows.filter((r) => r.avecTwinOf)) {
    const x = byId.get(y.avecTwinOf!);
    if (x && statusGroup(y.status) !== statusGroup(x.status)) out.push({ kind: "status_diferente", ...base(x, y), avecStatus: y.status });
  }
  for (const x of rows.filter((r) => r.origin === "avec" && r.crmTouchedAt && !r.avecTwinOf && r.avecStatus)) {
    if (statusGroup(x.avecStatus) !== statusGroup(x.status)) out.push({ kind: "status_diferente", ...base(x, null), avecStatus: x.avecStatus });
  }
  // 17/10: status do Avec que o CRM não conhece fica em `conferir` (neutro) até a recepção resolver.
  for (const x of rows.filter((r) => r.status === "conferir" && !r.avecTwinOf)) out.push({ kind: "status_desconhecido", ...base(x, null), avecStatus: x.avecStatus });
  // 18/10: o Avec deu sinal, mas a importação não teve certeza e não mexeu. Sai daqui quando o horário ganha desfecho.
  for (const x of rows.filter((r) => r.avecReview && !r.avecTwinOf && CLOSABLE.includes(r.status))) {
    out.push({ kind: x.avecReview === "atendimento_longe" ? "atendimento_longe" : "venda_sem_par", ...base(x, null), avecStatus: x.avecStatus });
  }
  // Gap Avec (A1): o 0248 diz que no Avec a reserva continua Agendado, mas o CRM já deu desfecho (a baixa falta lá). Aberta nos dois fica no Sem desfecho.
  for (const x of rows.filter((r) => r.avecUnclosedAt && !r.avecTwinOf && ["compareceu", "faltou", "cancelado"].includes(r.status))) {
    out.push({ kind: "sem_baixa_no_avec", ...base(x, null), avecStatus: "agendado" });
  }
  const crmOwned = rows.filter((r) => !r.avecTwinOf && (r.origin === "crm" || r.crmTouchedAt) && statusGroup(r.status) === "ativo");
  const avecPlain = rows.filter((r) => r.origin === "avec" && !r.crmTouchedAt && !r.avecTwinOf && statusGroup(r.status) === "ativo");
  for (const x of crmOwned) for (const y of avecPlain) {
    if (dayOf(x.startsAt) === dayOf(y.startsAt) && x.startsAt.getTime() !== y.startsAt.getTime() && sameClient(x, y) && sameService(x, y)) {
      out.push({ kind: "horario_diferente", ...base(x, y), avecStatus: y.status });
    }
  }
  const [mode] = await db.select().from(settings).where(eq(settings.key, "agenda_modo"));
  if (mode?.value === "so_crm") {
    for (const y of rows.filter((r) => r.origin === "avec" && !r.avecTwinOf && r.createdAt > mode.updatedAt)) out.push({ kind: "criado_depois_da_virada", ...base(y, y), avecStatus: y.status });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.clientName.localeCompare(b.clientName, "pt-BR"));
}

export type AvecRejected = { id: string; reason: string; day: string; hm: string | null; clientName: string; serviceLabel: string | null; professionalName: string | null };

/**
 * Linhas do Avec que a importação recusou (17/10: data fora do limite, como 4676-11-10), para "Conferir com o Avec". Só as que vieram
 * numa importação dos últimos 30 dias: corrigida no Avec, para de vir e sai da lista sozinha.
 */
export async function listAvecRejected(now: Date): Promise<AvecRejected[]> {
  const rows = await db.select({ id: avecRejectedRows.id, reason: avecRejectedRows.reason, day: avecRejectedRows.day, hm: avecRejectedRows.hm, clientName: avecRejectedRows.clientName,
    contactName: contacts.name, serviceLabel: avecRejectedRows.serviceLabel, professionalName: avecRejectedRows.professionalName })
    .from(avecRejectedRows).leftJoin(contacts, eq(contacts.id, avecRejectedRows.contactId))
    .where(gte(avecRejectedRows.lastSeenAt, new Date(now.getTime() - 30 * 86_400_000))).orderBy(avecRejectedRows.day);
  return rows.map(({ contactName, ...r }) => ({ ...r, clientName: contactName?.trim() || r.clientName?.trim() || "Sem nome" }));
}
