import { nextOpeningAfter, type BusinessHours } from "./business-hours";

/** {nome} → o primeiro nome da cliente; sem nome, some junto com a vírgula ("Oi, {nome}!" → "Oi!"). Nunca o telefone. */
export function fillName(tpl: string, name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (first) return tpl.replaceAll("{nome}", first).trim();
  return tpl.replace(/,?\s*\{nome\}/g, "").replace(/ {2,}/g, " ").replace(/\s+([!?.,])/g, "$1").trim();
}

const WEEKDAY = ["no domingo", "na segunda", "na terça", "na quarta", "na quinta", "na sexta", "no sábado"];
const OFFSET_MS = 3 * 3_600_000; // America/Bahia
const dayIndex = (ms: number) => Math.floor((ms - OFFSET_MS) / 86_400_000);

/**
 * O prazo concreto da resposta fora do horário (pesquisa 20/10, Maister: espera incerta parece maior): "amanhã a partir das 9h",
 * "na terça a partir das 8h30", "hoje a partir das 8h". Sem expediente nos próximos dias: "assim que a Casa abrir".
 */
export function openingPhrase(atMs: number, hours: BusinessHours): string {
  const open = nextOpeningAfter(atMs, hours);
  if (open == null) return "assim que a Casa abrir";
  const local = new Date(open - OFFSET_MS);
  const h = local.getUTCHours(), m = local.getUTCMinutes();
  const hour = m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  const diff = dayIndex(open) - dayIndex(atMs);
  const day = diff === 0 ? "hoje" : diff === 1 ? "amanhã" : WEEKDAY[local.getUTCDay()];
  return `${day} a partir das ${hour}`;
}

/** {abertura} → o prazo concreto de quando a Casa responde (ver `openingPhrase`). */
export const fillOpening = (tpl: string, atMs: number, hours: BusinessHours): string => tpl.replaceAll("{abertura}", openingPhrase(atMs, hours));

/** Texto sugerido da resposta fora do horário: prazo concreto e uma pergunta útil (nunca só "aguarde"). Só sugestão: nada liga sozinho. */
export const AUTO_REPLY_SUGGESTED = "Oi, {nome}! Agora estamos fechadas; respondemos {abertura}. Para adiantar, me conta o serviço e o dia que você prefere?";
