import { dayOf, minuteOfDay } from "./agenda";
import { firstName } from "./authorship";

/**
 * Bloqueios de agenda (almoço, folga): se um bloqueio vale num dia. Função pura, serve à consulta e à tela.
 * weekdays: 0=dom..6=sáb; null = todos os dias do intervalo.
 */
export type BlockRule = { startsOn: string; endsOn: string; weekdays: number[] | null };

export function blockAppliesOn(block: BlockRule, day: string): boolean {
  if (day < block.startsOn || day > block.endsOn) return false;
  if (!block.weekdays?.length) return true;
  return block.weekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay());
}

/** Motivo do bloqueio criado no CRM (Outro pede texto, que vira o título). */
export const BLOCK_REASONS = ["almoco", "folga", "atestado", "feriado", "curso", "outro"] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];
export const BLOCK_REASON_LABEL: Record<BlockReason, string> = { almoco: "Almoço", folga: "Folga", atestado: "Atestado", feriado: "Feriado", curso: "Curso", outro: "Outro" };
export const isBlockReason = (v: unknown): v is BlockReason => typeof v === "string" && (BLOCK_REASONS as readonly string[]).includes(v);

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** Bloqueio do Avec (só título) aberto para editar: o motivo que o título diz, senão Outro com o título como texto. */
export function reasonFromTitle(title: string): { reason: BlockReason; note: string | null } {
  const found = BLOCK_REASONS.find((r) => r !== "outro" && plain(BLOCK_REASON_LABEL[r]) === plain(title));
  return found ? { reason: found, note: null } : { reason: "outro", note: title.trim() || null };
}

/** Quem já está marcado dentro de um bloqueio (o bloqueio salva e não mexe nelas; a recepção remarca). */
export type ClientInside = { name: string; startsAt: string; professionalName: string | null };

const pad = (n: number) => String(n).padStart(2, "0");
/** "3 clientes marcadas: Paula 10:00, Rita 11:00, Lia 14:00" (com o dia quando pega mais de um; até 5 nomes). */
export function clientsInsideText(list: ClientInside[]): string {
  if (!list.length) return "";
  const manyDays = new Set(list.map((c) => dayOf(c.startsAt))).size > 1;
  const shown = list.slice(0, 5).map((c) => {
    const m = minuteOfDay(c.startsAt), d = dayOf(c.startsAt);
    return `${firstName(c.name) ?? c.name}${manyDays ? ` ${d.slice(8, 10)}/${d.slice(5, 7)}` : ""} ${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  });
  const more = list.length > 5 ? ` e mais ${list.length - 5}` : "";
  return `${list.length} ${list.length === 1 ? "cliente marcada" : "clientes marcadas"}: ${shown.join(", ")}${more}`;
}
