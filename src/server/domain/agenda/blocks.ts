import { eq } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { agendaBlocks, auditLog, professionals } from "../../db/schema";
import { UserFacingError } from "../errors";
import { assertCanBook } from "./mode";
import { loadOccupied } from "./occupancy";
import { BLOCK_REASON_LABEL, blockAppliesOn, isBlockReason, type BlockReason, type ClientInside } from "../../../lib/agenda-blocks";
import { dayOf, minuteOfDay, shiftDay } from "../../../lib/agenda";
import { hmMin } from "../../../lib/work-hours";
import { isUuid } from "../../../lib/uuid";

/**
 * Bloqueios criados, editados e apagados no CRM (spec §5.5). Seguem o modo da agenda (recusados no modo consulta). Apagar só marca
 * `deleted_at` — vale também para os que vieram do Avec, e a reimportação não traz de volta. Salvar por cima de clientes marcadas não
 * mexe nelas: devolve a lista para a tela mostrar.
 */
export type BlockInput = {
  /** null = Todas */ professionalId: string | null; /** "AAAA-MM-DD" */ startsOn: string; endsOn: string;
  /** "HH:MM" (Salvador); dia inteiro = "00:00" a "24:00" */ startTime: string; endTime: string;
  /** 0=dom..6=sáb; null ou vazio = todos os dias do período */ weekdays: number[] | null; reason: BlockReason; /** obrigatório em Outro */ note?: string | null;
};

const DAY_MS = 86_400_000;
const NOTE_MAX = 200;
const realDay = (d: unknown): d is string =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

function validate(input: BlockInput) {
  if (!isBlockReason(input.reason)) throw new UserFacingError("Escolha o motivo do bloqueio.");
  const note = (input.note ?? "").trim().replace(/\s+/g, " ");
  if (note.length > NOTE_MAX) throw new UserFacingError(`Use até ${NOTE_MAX} caracteres no motivo.`);
  if (input.reason === "outro" && !note) throw new UserFacingError("Escreva o motivo do bloqueio.");
  if (input.professionalId !== null && !isUuid(input.professionalId)) throw new UserFacingError("Profissional não encontrada.");
  if (!realDay(input.startsOn) || !realDay(input.endsOn)) throw new UserFacingError("Confira as datas do bloqueio.");
  if (input.endsOn < input.startsOn) throw new UserFacingError("A data final não pode vir antes da inicial.");
  const days = (Date.parse(`${input.endsOn}T00:00:00Z`) - Date.parse(`${input.startsOn}T00:00:00Z`)) / DAY_MS;
  if (days > 366) throw new UserFacingError("Use um período de até 366 dias.");
  const s = hmMin(input.startTime), e = hmMin(input.endTime);
  if (s == null || e == null) throw new UserFacingError("Confira as horas (HH:MM).");
  if (e <= s) throw new UserFacingError("A hora final precisa ser depois da inicial.");
  let weekdays: number[] | null = null;
  if (input.weekdays?.length) {
    if (!input.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) throw new UserFacingError("Confira os dias da semana.");
    weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);
    const rule = { startsOn: input.startsOn, endsOn: input.endsOn, weekdays };
    if (!Array.from({ length: Math.min(days, 6) + 1 }, (_, i) => shiftDay(input.startsOn, i)).some((d) => blockAppliesOn(rule, d)))
      throw new UserFacingError("Nenhum dos dias escolhidos cai nesse período.");
  }
  return {
    professionalId: input.professionalId, startsOn: input.startsOn, endsOn: input.endsOn, startTime: input.startTime, endTime: input.endTime, weekdays,
    reason: input.reason, title: input.reason === "outro" ? note : BLOCK_REASON_LABEL[input.reason], notes: input.reason === "outro" ? null : note || null,
  };
}
type BlockValues = ReturnType<typeof validate>;

const snapshot = (b: Pick<typeof agendaBlocks.$inferSelect, "professionalId" | "title" | "notes" | "startsOn" | "endsOn" | "startTime" | "endTime" | "weekdays" | "reason">) => ({
  professionalId: b.professionalId, title: b.title, notes: b.notes, startsOn: b.startsOn, endsOn: b.endsOn, startTime: b.startTime, endTime: b.endTime, weekdays: b.weekdays, reason: b.reason,
});

async function assertProfessional(tx: Tx, id: string | null) {
  if (!id) return;
  const [p] = await tx.select({ id: professionals.id }).from(professionals).where(eq(professionals.id, id));
  if (!p) throw new UserFacingError("Profissional não encontrada.");
}

/** Clientes marcadas dentro do bloqueio (pela hora de cada uma), em ordem. */
async function clientsInside(tx: Tx, v: BlockValues): Promise<ClientInside[]> {
  const from = new Date(Date.parse(`${v.startsOn}T00:00:00-03:00`)), to = new Date(Date.parse(`${shiftDay(v.endsOn, 1)}T00:00:00-03:00`));
  const rows = await loadOccupied(tx, { from, to, professionalIds: v.professionalId ? [v.professionalId] : "all" });
  const bs = hmMin(v.startTime)!, be = hmMin(v.endTime)!;
  return rows.filter((r) => {
    const s = minuteOfDay(r.startsAt), e = s + (r.durationMin ?? 1);
    return blockAppliesOn(v, dayOf(r.startsAt)) && s < be && bs < e;
  }).map((r) => ({ name: r.clientName, startsAt: r.startsAt.toISOString(), professionalName: r.professionalName }));
}

/**
 * `opts.externalKey`: chave própria para quem sincroniza bloqueios por regra (ex.: "dia_especial:AAAA-MM-DD"); criar de novo com a mesma
 * chave não duplica (devolve o que já está vivo) e recupera o que foi apagado. `opts.title` troca o nome mostrado na Agenda.
 */
export async function createBlock(input: BlockInput, userId: string, opts?: { externalKey?: string; title?: string }): Promise<{ id: string; clientsInside: ClientInside[] }> {
  const v = validate(input);
  if (opts?.title) v.title = opts.title;
  return db.transaction(async (tx) => {
    await assertCanBook(tx);
    await assertProfessional(tx, v.professionalId);
    if (opts?.externalKey) {
      const [old] = await tx.select().from(agendaBlocks).where(eq(agendaBlocks.externalKey, opts.externalKey)).for("update");
      if (old) {
        if (!old.deletedAt) return { id: old.id, clientsInside: await clientsInside(tx, v) };
        await tx.update(agendaBlocks).set({ ...v, deletedAt: null, deletedBy: null, updatedAt: new Date(), updatedBy: userId }).where(eq(agendaBlocks.id, old.id));
        await tx.insert(auditLog).values({ userId, action: "criou_bloqueio", entity: "agenda_block", entityId: old.id, data: { para: snapshot(v), recuperado: true } });
        return { id: old.id, clientsInside: await clientsInside(tx, v) };
      }
    }
    const id = crypto.randomUUID();
    await tx.insert(agendaBlocks).values({ id, ...v, externalKey: opts?.externalKey ?? `crm:blq:${id}`, origin: "crm", createdBy: userId });
    await tx.insert(auditLog).values({ userId, action: "criou_bloqueio", entity: "agenda_block", entityId: id, data: { para: snapshot(v) } });
    return { id, clientsInside: await clientsInside(tx, v) };
  });
}

async function lockBlock(tx: Tx, id: string) {
  const [b] = isUuid(id) ? await tx.select().from(agendaBlocks).where(eq(agendaBlocks.id, id)).for("update") : [];
  if (!b) throw new UserFacingError("Bloqueio não encontrado.");
  return b;
}

/** Edita um bloqueio (do CRM ou do Avec), com de/para na auditoria. */
export async function updateBlock(id: string, input: BlockInput, userId: string): Promise<{ clientsInside: ClientInside[] }> {
  const v = validate(input);
  return db.transaction(async (tx) => {
    await assertCanBook(tx);
    const old = await lockBlock(tx, id);
    if (old.deletedAt) throw new UserFacingError("Esse bloqueio já foi apagado.");
    await assertProfessional(tx, v.professionalId);
    await tx.update(agendaBlocks).set({ ...v, updatedAt: new Date(), updatedBy: userId }).where(eq(agendaBlocks.id, id));
    await tx.insert(auditLog).values({ userId, action: "editou_bloqueio", entity: "agenda_block", entityId: id, data: { de: snapshot(old), para: snapshot(v) } });
    return { clientsInside: await clientsInside(tx, v) };
  });
}

/** Apaga (só marca a data e quem apagou). Apagar de novo não faz nada. */
export async function deleteBlock(id: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await assertCanBook(tx);
    const old = await lockBlock(tx, id);
    if (old.deletedAt) return;
    await tx.update(agendaBlocks).set({ deletedAt: new Date(), deletedBy: userId }).where(eq(agendaBlocks.id, id));
    await tx.insert(auditLog).values({ userId, action: "apagou_bloqueio", entity: "agenda_block", entityId: id, data: { de: snapshot(old), origem: old.origin } });
  });
}
