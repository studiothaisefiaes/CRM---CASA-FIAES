import { and, eq, like, isNull } from "drizzle-orm";
import { db } from "../db";
import { agendaBlocks, auditLog, settings } from "../db/schema";
import { UserFacingError } from "./errors";
import { assertFuncaoLigada, funcaoLigada, funcaoParam } from "./funcoes";
import { getAgendaMode } from "./agenda/mode";
import { createBlock, deleteBlock } from "./agenda/blocks";
import { SPECIAL_DAYS_KEY } from "./hours";
import { dayLabel, type SpecialDay } from "../../lib/special-days";
import { dayOf, shiftDay, todayBahia } from "../../lib/agenda";

export type { SpecialDay };
const KEY_PREFIX = "dia_especial:";
const TEXT_MAX = 600;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const realDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Dias especiais cadastrados (em ordem de data), mesmo com a função desligada: é o que a tela mostra para editar. */
export async function getSpecialDays(): Promise<SpecialDay[]> {
  const [r] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SPECIAL_DAYS_KEY));
  if (!Array.isArray(r?.value)) return [];
  return (r.value as SpecialDay[]).filter((d) => realDay(d?.day)).sort((a, b) => a.day.localeCompare(b.day));
}

async function validate(days: unknown, now: Date): Promise<SpecialDay[]> {
  if (!Array.isArray(days)) throw new UserFacingError("Confira os dias especiais.");
  const limite = await funcaoParam("dias_especiais", "dias_a_frente");
  const today = todayBahia(now), last = shiftDay(today, limite);
  const seen = new Set<string>();
  const out: SpecialDay[] = [];
  for (const raw of days as SpecialDay[]) {
    if (!raw || !realDay(raw.day)) throw new UserFacingError("Confira a data de cada dia especial.");
    const label = dayLabel(raw.day);
    if (seen.has(raw.day)) throw new UserFacingError(`O dia ${label} aparece duas vezes.`);
    seen.add(raw.day);
    if (raw.day < today) throw new UserFacingError(`O dia ${label} já passou.`);
    if (raw.day > last) throw new UserFacingError(`O dia ${label} está longe demais: use até ${limite} dias à frente (o limite fica em Configurações › Recursos).`);
    const w = raw.window;
    if (w !== null) {
      if (!Array.isArray(w) || w.length !== 2 || !HHMM.test(w[0]) || !HHMM.test(w[1])) throw new UserFacingError(`Confira as horas do dia ${label} (HH:MM).`);
      if (w[0] >= w[1]) throw new UserFacingError(`No dia ${label}, a Casa precisa abrir antes de fechar.`);
    }
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (text.length > TEXT_MAX) throw new UserFacingError(`O texto do dia ${label} passou de ${TEXT_MAX} caracteres.`);
    out.push({ day: raw.day, window: w === null ? null : [w[0], w[1]], text: text || null });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Grava os Dias especiais (`settings.dias_especiais`) e sincroniza a Agenda: dia fechado vira um bloqueio "Feriado" da Casa inteira
 * (chave `dia_especial:AAAA-MM-DD`); tirar o dia (ou abrir com horário reduzido) apaga o bloqueio. Horário reduzido não bloqueia.
 * No modo "só consulta" a Agenda não aceita bloqueios do CRM: os dias valem para mensagens e prazos e o retorno avisa (`agenda: "consulta"`).
 */
export async function saveSpecialDays(days: SpecialDay[], userId: string, now: Date = new Date()): Promise<{ agenda: "sincronizada" | "consulta" }> {
  await assertFuncaoLigada("dias_especiais");
  const v = await validate(days, now);
  const before = await getSpecialDays();
  await db.transaction(async (tx) => {
    await tx.insert(settings).values({ key: SPECIAL_DAYS_KEY, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: SPECIAL_DAYS_KEY, data: { de: before, para: v } });
  });
  if ((await getAgendaMode()) === "consulta") return { agenda: "consulta" };
  const today = todayBahia(now);
  const wanted = new Set(v.filter((d) => d.window === null).map((d) => d.day));
  for (const day of [...wanted])
    await createBlock({ professionalId: null, startsOn: day, endsOn: day, startTime: "00:00", endTime: "24:00", weekdays: null, reason: "feriado" }, userId,
      { externalKey: KEY_PREFIX + day, title: "Casa fechada" });
  const live = await db.select({ id: agendaBlocks.id, key: agendaBlocks.externalKey, startsOn: agendaBlocks.startsOn }).from(agendaBlocks)
    .where(and(like(agendaBlocks.externalKey, `${KEY_PREFIX}%`), isNull(agendaBlocks.deletedAt)));
  for (const b of live) if (!wanted.has(b.key.slice(KEY_PREFIX.length)) && b.startsOn >= today) await deleteBlock(b.id, userId);
  return { agenda: "sincronizada" };
}

/** O texto próprio do dia especial em que cai `atMs` (para a Resposta fora do horário), ou null: sem texto, sem dia ou função desligada. */
export async function specialDayText(atMs: number): Promise<string | null> {
  if (!(await funcaoLigada("dias_especiais"))) return null;
  const day = dayOf(new Date(atMs));
  return (await getSpecialDays()).find((d) => d.day === day)?.text ?? null;
}
