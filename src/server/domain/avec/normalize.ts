import { stripCompleteProfile } from "@/lib/complete-profile";
/**
 * Leitura dos valores que vêm nos relatórios do Avec: nomes, dinheiro (em reais, como número), datas "dd/mm/aaaa", hora "HH:MM",
 * status de reserva e dias da semana. Funções puras; nada aqui inventa dado: o que não dá para ler volta null.
 */

const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão

const unaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const spaces = (s: string) => s.replace(/\s+/g, " ").trim();

/** Cabeçalho para comparar: sem acento, minúsculo, espaços únicos. */
export const normHeader = (h: string | null | undefined) => spaces(unaccent(String(h ?? "")).toLowerCase());

/** Texto para casar (cliente, serviço, profissional): sem acento, minúsculo, sem o parêntese final ("(T. USO DE IMAGEM)"), espaços únicos. */
export function normText(s: string | null | undefined): string {
  return spaces(unaccent(String(s ?? "")).toLowerCase().replace(/\([^()]*\)\s*$/, ""));
}

/**
 * Nome da cliente como deve ser gravado (sem o parêntese de observação do Avec), se a observação é a de uso de imagem e se o Avec marcou
 * "completar cadastro" (17/10: vira a etiqueta). Só o parêntese fechado sai do nome, como sempre: a chave da reserva (`normText`) não muda.
 */
export function splitClientName(raw: string | null | undefined): { name: string | null; imageUse: boolean; completeProfile: boolean } {
  const s = spaces(String(raw ?? ""));
  const m = s.match(/\(([^()]*)\)\s*$/);
  const imageUse = !!m && /uso\s*de\s*imagem/i.test(unaccent(m[1]));
  const name = spaces(m ? s.slice(0, m.index) : s).replace(/^[\s:;,.\-]+/, "");
  return { name: name || null, imageUse, completeProfile: stripCompleteProfile(s).hit };
}

/** Dinheiro em reais → centavos. O Avec manda número (150 = R$ 150,00); aceita também "R$ 1.158,50". */
export function moneyCents(v: string | null | undefined): number | null {
  let s = String(v ?? "").replace(/R\$|\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  return Number.isSafeInteger(n) ? n : null;
}

/** Porcentagem ("40", "40,5", "35 %") com 2 casas; fora de 0 a 100 ou texto: null. */
export function pctOrNull(v: string | null | undefined): number | null {
  const s = String(v ?? "").replace(/%|\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return n >= 0 && n <= 100 ? n : null;
}

/** Data "dd/mm/aaaa" (com ou sem hora depois) ou "aaaa-mm-dd…" → "aaaa-mm-dd". Data impossível (31/02) volta null. */
export function dateIso(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  let y: number, mo: number, d: number;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (br) { d = +br[1]; mo = +br[2]; y = +br[3]; if (y < 100) y += 2000; }
  else if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Dia que pode ser de um horário de verdade: de 2000-01-01 até um ano (366 dias) depois de hoje em Salvador. O Avec já mandou 2029, 2923
 * e 4676 (17/10); fora disso a linha é recusada na importação.
 */
export function plausibleDay(day: string, now: Date): boolean {
  const max = new Date(now.getTime() - OFFSET_MS + 366 * 86_400_000).toISOString().slice(0, 10);
  return day >= "2000-01-01" && day <= max;
}

/** Hora "H:MM" ou "HH:MM:SS" → "HH:MM". */
export function timeHm(v: string | null | undefined): string | null {
  const m = String(v ?? "").trim().match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?$/) ?? String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Instante de "aaaa-mm-dd" + "HH:MM" no horário de Salvador. */
export const bahiaAt = (day: string, hm: string) => new Date(Date.parse(`${day}T${hm}:00Z`) + OFFSET_MS);

/** Meio-dia (UTC) do dia: para datas sem hora (última visita, comanda), como já faz a importação de clientes. */
export const noonUtc = (day: string) => new Date(`${day}T12:00:00Z`);

export type AppointmentStatus = "agendado" | "confirmado" | "compareceu" | "faltou" | "cancelado" | "espera" | "conferir";

const STATUS: Record<string, AppointmentStatus> = {
  agendado: "agendado", confirmado: "confirmado",
  pago: "compareceu", atendido: "compareceu", finalizado: "compareceu", "em atendimento": "compareceu", compareceu: "compareceu",
  faltou: "faltou", "nao compareceu": "faltou", "nao veio": "faltou",
  cancelado: "cancelado", cancelada: "cancelado",
};
/**
 * Status de reserva do Avec → nosso. Vazio: agendado. Desconhecido ("Aguardando", "Desmarcado"…): `conferir`, um estado neutro (17/10:
 * antes virava agendado e recebia lembrete), com o texto original em `avecStatus`, para a recepção ver em "Conferir com o Avec".
 */
export function reservationStatus(raw: string | null | undefined): { status: AppointmentStatus; avecStatus: string | null } {
  const k = normHeader(raw);
  if (!k) return { status: "agendado", avecStatus: null };
  const status = STATUS[k];
  return status ? { status, avecStatus: null } : { status: "conferir", avecStatus: spaces(String(raw)) };
}

const WEEKDAYS: [string, number][] = [["dom", 0], ["seg", 1], ["ter", 2], ["qua", 3], ["qui", 4], ["sex", 5], ["sab", 6]];
/** "Terça," / "Segunda, Quarta" → [2] / [1, 3] (0=dom..6=sáb). Vazio = null (vale todos os dias do intervalo). */
export function weekdaysOf(raw: string | null | undefined): number[] | null {
  const days = new Set<number>();
  for (const part of normHeader(raw).split(/[,;/]/)) {
    const p = part.trim();
    if (!p) continue;
    const hit = WEEKDAYS.find(([k]) => p.startsWith(k));
    if (hit) days.add(hit[1]);
  }
  return days.size ? [...days].sort((a, b) => a - b) : null;
}

export function intOrNull(v: string | null | undefined): number | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s));
}

/** Número de comanda como texto ("1234", nunca "1234.0"). */
export function comandaOf(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, "") : s;
}

/** Duração "HH:MM" ou minutos ("45"). Qualquer outra coisa volta null (não chutar). */
export function durationMin(v: string | null | undefined): number | null {
  const s = String(v ?? "").trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) return +hm[1] * 60 + +hm[2] || null;
  if (/^\d{1,3}$/.test(s)) return +s || null;
  return null;
}

export type ItemKind = "servico" | "produto" | "pacote" | "outro";
/** Tipo do item da comanda: Serviço / Produto / Pacote; o resto é "outro". */
export function itemKind(v: string | null | undefined): ItemKind {
  const k = normHeader(v);
  if (k.startsWith("servico")) return "servico";
  if (k.startsWith("produto")) return "produto";
  if (k.startsWith("pacote")) return "pacote";
  return "outro";
}

/** Texto limpo ou null. */
export const clean = (v: string | null | undefined) => spaces(String(v ?? "")) || null;
