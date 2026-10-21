// src/lib/team-now.ts
/** Estado de cada pessoa no painel "Equipe agora". A cor nunca vem sozinha: a tela sempre escreve o rótulo. */
export type TeamState = "respondendo" | "no_crm" | "pausa" | "sem_sinal";
export const TEAM_STATE_LABEL: Record<TeamState, string> = {
  respondendo: "Respondendo agora", no_crm: "Com o CRM aberto", pausa: "Em pausa", sem_sinal: "Sem atividade agora",
};
/** Respondeu há até isto (pelo CRM ou, pela assinatura, pelo celular): conta como "respondendo agora". */
export const REPLYING_WINDOW_MIN = 15;
/** O CRM aberto bate a cada minuto; sem batida há mais que isto, a pessoa não está com o CRM aberto (mesmo prazo da distribuição). */
export const SEEN_WINDOW_MIN = 5;

export function teamState(p: { availability: string; lastSeenAt: Date | string | null; lastReplyAt: Date | string | null }, now: Date): TeamState {
  const ago = (d: Date | string | null) => (d ? now.getTime() - new Date(d).getTime() : Infinity);
  if (p.availability === "pausa") return "pausa";
  if (ago(p.lastReplyAt) <= REPLYING_WINDOW_MIN * 60_000) return "respondendo";
  if (ago(p.lastSeenAt) <= SEEN_WINDOW_MIN * 60_000) return "no_crm";
  return "sem_sinal";
}

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" });
const DATA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });

/** "há 4 min, pelo celular", "hoje 09:12, pelo CRM", "ontem 13:15, pelo celular", "12/10 17:40, pelo CRM"; sem resposta: "nenhuma resposta nos últimos 7 dias". */
export function lastReplyLabel(at: Date | string | null, via: "celular" | "crm" | null, now: Date): string {
  if (!at) return "nenhuma resposta nos últimos 7 dias";
  const t = new Date(at);
  const min = Math.floor((now.getTime() - t.getTime()) / 60_000);
  const yesterday = new Date(now.getTime() - 86_400_000);
  const when = min < 1 ? "agora" : min < 60 ? `há ${min} min`
    : DIA.format(t) === DIA.format(now) ? `hoje ${HORA.format(t)}`
    : DIA.format(t) === DIA.format(yesterday) ? `ontem ${HORA.format(t)}`
    : `${DATA.format(t)} ${HORA.format(t)}`;
  return via ? `${when}, ${via === "celular" ? "pelo celular" : "pelo CRM"}` : when;
}
