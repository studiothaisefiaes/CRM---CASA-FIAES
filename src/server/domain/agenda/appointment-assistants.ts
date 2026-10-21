import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type Db, type Tx } from "../../db";
import { appointmentAssistants, lists, professionals } from "../../db/schema";
import { conflictText, refusalText } from "@/lib/agenda-text";
import { firstName } from "@/lib/authorship";
import { isUuid } from "@/lib/uuid";
import { UserFacingError } from "../errors";
import type { Actor } from "./actor";
import { checkSlotTx } from "./slots";

/**
 * Auxiliares do horário (0089, 20/10): em cada serviço, além da profissional principal, quantas auxiliares a Casa quiser. A auxiliar ocupa
 * a agenda dela no mesmo período (o motor confere igual à principal: conflito, bloqueio, fora do horário) e vira assistente do item quando
 * a comanda abre. Não é "quem atende": não entra no funil, no lembrete da cliente nem na comanda como serviço.
 */
export const MAX_AUXILIARES = 6;
export const auxiliariesSchema = z.array(z.string().uuid()).max(MAX_AUXILIARES, `Até ${MAX_AUXILIARES} auxiliares por serviço.`);

type Q = Tx | Db;
export type AuxPro = { id: string; name: string };

/**
 * Confere a lista: sem repetir, nunca a própria principal, só profissionais que existem e estão ativas (a que já estava no horário pode
 * seguir mesmo inativa: `keep`). Devolve na ordem pedida, com o nome.
 */
export async function validateAuxiliariesTx(q: Q, ids: readonly string[], mainProId: string | null, keep: ReadonlySet<string> = new Set()): Promise<AuxPro[]> {
  if (!ids.length) return [];
  if (ids.length > MAX_AUXILIARES) throw new UserFacingError(`Até ${MAX_AUXILIARES} auxiliares por serviço.`);
  if (new Set(ids).size !== ids.length) throw new UserFacingError("A mesma auxiliar não pode entrar duas vezes no serviço.");
  const rows = await q.select({ id: professionals.id, name: professionals.name, active: professionals.active }).from(professionals).where(inArray(professionals.id, ids.filter(isUuid)));
  return ids.map((id) => {
    const p = rows.find((r) => r.id === id);
    if (!p) throw new UserFacingError("Auxiliar não encontrada.");
    if (mainProId && id === mainProId) throw new UserFacingError(`${firstName(p.name) ?? p.name} é quem atende este serviço; não pode ser auxiliar dele também.`);
    if (!p.active && !keep.has(id)) throw new UserFacingError(`${firstName(p.name) ?? p.name} está inativa. Escolha outra auxiliar.`);
    return { id: p.id, name: p.name };
  });
}

/** "A auxiliar Sidney não está livre: Sidney já tem Paula das 14:00 às 15:00." (a frase do motor, com quem é). */
const auxText = (name: string, msg: string) => {
  const who = firstName(name) ?? name;
  const body = msg.startsWith(who) ? msg : `${msg.charAt(0).toLowerCase()}${msg.slice(1)}`;
  return `A auxiliar ${who} não está livre: ${body}${/[.!?]$/.test(msg) ? "" : "."}`;
};

/**
 * A agenda de cada auxiliar no período do serviço, relida do banco (chame depois de `lockAgendaTx`). A regra é a da principal: conflito e
 * fora do horário só passam com "Encaixar mesmo assim" e a permissão `agenda.encaixar`; bloqueio e dia que passou, nunca. A cliente não
 * entra na conta (a principal já confere). Devolve se alguma precisou de encaixe.
 */
export async function checkAuxiliariesTx(q: Q, aux: readonly AuxPro[], slot: {
  startsAt: Date; durationMin: number; bufferMin: number | null; parallelOk: boolean | null; ignoreAppointmentId?: string | null;
  fitIn: boolean; actor: Actor; now: Date;
}, decide: (check: Awaited<ReturnType<typeof checkSlotTx>>, proName: string) => { fitIn: boolean; outsideHours: boolean }): Promise<{ fitIn: boolean }> {
  let fitIn = false;
  for (const a of aux) {
    const check = await checkSlotTx(q, { professionalId: a.id, startsAt: slot.startsAt, durationMin: slot.durationMin, bufferMin: slot.bufferMin, clientId: null,
      ignoreAppointmentId: slot.ignoreAppointmentId ?? null, now: slot.now, parallelOk: slot.parallelOk });
    try {
      const d = decide(check, a.name);
      if (d.fitIn || d.outsideHours) fitIn = true;
    } catch (e) {
      if (e instanceof UserFacingError) throw new UserFacingError(auxText(a.name, e.message));
      throw e;
    }
  }
  return { fitIn };
}

/** Grava as auxiliares do horário na ordem (posição 1, 2…), trocando as que havia. */
export async function saveAuxiliariesTx(tx: Tx, appointmentId: string, ids: readonly string[], actorId: string | null, now = new Date()): Promise<void> {
  await tx.delete(appointmentAssistants).where(eq(appointmentAssistants.appointmentId, appointmentId));
  if (ids.length) await tx.insert(appointmentAssistants).values(ids.map((professionalId, k) => ({ appointmentId, professionalId, position: k + 1, createdBy: actorId, createdAt: now })));
}

/** As auxiliares de cada horário, na ordem. */
export async function auxiliariesOf(appointmentIds: readonly string[], q: Q = db): Promise<Map<string, AuxPro[]>> {
  const ids = appointmentIds.filter(isUuid);
  if (!ids.length) return new Map();
  const rows = await q.select({ appointmentId: appointmentAssistants.appointmentId, id: professionals.id, name: professionals.name }).from(appointmentAssistants)
    .innerJoin(professionals, eq(professionals.id, appointmentAssistants.professionalId))
    .where(inArray(appointmentAssistants.appointmentId, ids)).orderBy(asc(appointmentAssistants.appointmentId), asc(appointmentAssistants.position));
  const out = new Map<string, AuxPro[]>();
  for (const r of rows) out.set(r.appointmentId, [...(out.get(r.appointmentId) ?? []), { id: r.id, name: r.name }]);
  return out;
}

/** Só os ids, na ordem (para comparar e auditar). */
export async function auxiliaryIdsTx(q: Q, appointmentId: string): Promise<string[]> {
  const rows = await q.select({ id: appointmentAssistants.professionalId }).from(appointmentAssistants)
    .where(eq(appointmentAssistants.appointmentId, appointmentId)).orderBy(asc(appointmentAssistants.position));
  return rows.map((r) => r.id);
}

/**
 * Dentro da mesma visita, ninguém está em dois serviços que se cruzam: a principal de um não é auxiliar do outro ao mesmo tempo, nem a
 * mesma auxiliar em dois serviços juntos (o banco ainda não tem esses horários, então o motor não vê).
 */
export function assertNoSelfOverlap(items: { start: Date; durationMin: number; people: { id: string; name: string }[] }[]): void {
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    const aEnd = a.start.getTime() + a.durationMin * 60_000, bEnd = b.start.getTime() + b.durationMin * 60_000;
    if (!(a.start.getTime() < bEnd && b.start.getTime() < aEnd)) continue;
    const clash = a.people.find((p) => b.people.some((q) => q.id === p.id));
    if (clash) throw new UserFacingError(`${firstName(clash.name) ?? clash.name} não pode estar em dois serviços ao mesmo tempo nesta visita.`);
  }
}

export type AuxPreview = { professionalId: string; name: string; state: "livre" | "encaixe" | "fora_do_horario" | "recusado"; text: string };

/**
 * A prévia das auxiliares na folha (só ajuda: quem decide é o servidor ao marcar). Para cada uma: "Livre", o conflito exato ou a regra
 * que recusa, no período do serviço. Sem início ou duração válidos, nada.
 */
export async function previewAuxiliaries(i: { assistantIds: string[]; startsAt: string; durationMin: number | null; serviceId?: string | null; ignoreAppointmentId?: string | null }, now: Date, q: Q = db): Promise<AuxPreview[]> {
  const ids = i.assistantIds.filter(isUuid).slice(0, MAX_AUXILIARES);
  const startsAt = new Date(i.startsAt);
  if (!ids.length || !Number.isFinite(startsAt.getTime()) || !i.durationMin || i.durationMin < 5) return [];
  const [svc] = i.serviceId && isUuid(i.serviceId) ? await q.select({ bufferMin: lists.bufferMin, parallelOk: lists.parallelOk, label: lists.label }).from(lists).where(eq(lists.id, i.serviceId)) : [];
  const rows = await q.select({ id: professionals.id, name: professionals.name }).from(professionals).where(inArray(professionals.id, ids));
  const out: AuxPreview[] = [];
  for (const id of ids) {
    const p = rows.find((r) => r.id === id);
    if (!p) continue;
    const check = await checkSlotTx(q, { professionalId: id, startsAt, durationMin: i.durationMin, bufferMin: svc?.bufferMin ?? null, clientId: null,
      ignoreAppointmentId: i.ignoreAppointmentId && isUuid(i.ignoreAppointmentId) ? i.ignoreAppointmentId : null, now, parallelOk: svc?.parallelOk ?? null });
    const who = firstName(p.name) ?? p.name;
    if (!check.ok) {
      const c = check.conflicts[0];
      out.push({ professionalId: id, name: p.name, state: "recusado", text: auxText(p.name, check.reason === "conflito" && c ? conflictText(p.name, c) : refusalText(check.reason, { proName: p.name, serviceLabel: svc?.label ?? "", blockedBy: check.blockedBy })) });
    } else if (check.conflicts.length) out.push({ professionalId: id, name: p.name, state: "encaixe", text: auxText(p.name, conflictText(p.name, check.conflicts[0])) });
    else if (check.outsideHours) out.push({ professionalId: id, name: p.name, state: "fora_do_horario", text: auxText(p.name, refusalText("fora_do_horario", { proName: p.name, serviceLabel: "" })) });
    else out.push({ professionalId: id, name: p.name, state: "livre", text: `${who} livre` });
  }
  return out;
}
