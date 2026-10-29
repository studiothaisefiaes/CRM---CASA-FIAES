import { displayName } from "./display-name";
/**
 * Link da cliente (Lote 7B): validade, estado da página, textos e o modelo da mensagem. Puro (servidor e navegador).
 * Datas sempre no relógio de Salvador (Intl com timeZone "America/Bahia"), nunca no do aparelho.
 */
const TZ = "America/Bahia";
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const LONG = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const SHORT_DAY = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit" });
const HOUR = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Status de horário que continua na visita (cancelado e lista de espera ficam de fora). */
export const LINK_ACTIVE = ["agendado", "confirmado", "chegou", "em_atendimento", "compareceu", "faltou", "solicitado"] as const;
const DONE = new Set(["chegou", "em_atendimento", "compareceu", "faltou"]);

/** Validade: o menor entre (fim do último serviço + 24 h) e (geração + 60 dias). */
export function linkExpiry(lastEnd: Date, now: Date): Date {
  return new Date(Math.min(lastEnd.getTime() + 24 * HOUR_MS, now.getTime() + 60 * DAY_MS));
}

/** "MAIARA" → "Maiara". */
const title = (s: string) => s.trim().toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
/** Só o primeiro nome (LGPD: a página pública nunca mostra o sobrenome). */
export const onlyFirstName = (name: string | null | undefined) => {
  const f = name?.trim().split(/\s+/)[0];
  return f ? title(f) : null;
};

export const hourText = (d: Date) => HOUR.format(d);
const PART = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
/** Para o destaque da página: { weekday: "sexta", day: "16", month: "outubro" } (relógio de Salvador). */
export function dayParts(d: Date): { weekday: string; day: string; month: string } {
  const p = Object.fromEntries(PART.formatToParts(d).map((x) => [x.type, x.value]));
  return { weekday: (p.weekday ?? "").replace("-feira", ""), day: p.day ?? "", month: p.month ?? "" };
}
/** "sexta, 16 de outubro". */
export const longDay = (d: Date) => LONG.format(d).replace("-feira", "");
/** "sexta, 16/10". */
export const shortDay = (d: Date) => SHORT_DAY.format(d).replace("-feira", "");

/*
 * Data e hora nas mensagens para a cliente (lembrete, remarcação, confirmação; 21/10, Cati: "a cliente não vê bem a data e a hora").
 * Por extenso, com o dia da semana inteiro, e a hora do jeito que a Casa escreve. Sempre no relógio de Salvador.
 */
const MSG_DAY = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit" });
/** "quinta-feira, 22/10"; "sábado, 24/10". */
export const messageDay = (d: Date) => MSG_DAY.format(d);
/** "14h", "9h", "14h30" (sem o ":00" e sem o zero na frente). */
export const messageHour = (d: Date) => { const [h, m] = HOUR.format(d).split(":"); return `${Number(h)}h${m === "00" ? "" : m}`; };

export type LinkAppt = { startsAt: Date; durationMin: number | null; status: string; service: string; pro: string | null };
export type LinkState = "agendado" | "confirmado" | "cancelado" | "aconteceu" | "solicitado";
export type LinkPage = {
  state: LinkState;
  /** Os serviços que continuam (todos, se a visita foi cancelada), em ordem. */
  items: { service: string; pro: string | null; start: Date; end: Date | null }[];
  start: Date;
  /** Fim do último serviço; null quando algum serviço não tem duração (nunca inventamos). */
  end: Date | null;
  /** O início mudou depois que o link foi gerado. */
  changed: boolean;
  /** Confirmar e "Preciso remarcar" valem. */
  canAct: boolean;
  /** Cancelar vale (dentro do prazo). Fora do prazo, a página mostra "Falar com a Casa". */
  canCancel: boolean;
};

/** O estado da página do link (seção 9.4.3). */
export function linkPageState(appts: LinkAppt[], issuedStartsAt: Date, now: Date, cancelarAteHoras: number): LinkPage {
  const sorted = [...appts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const active = sorted.filter((a) => (LINK_ACTIVE as readonly string[]).includes(a.status));
  const shown = active.length ? active : sorted;
  const items = shown.map((a) => ({ service: a.service, pro: a.pro ? title(a.pro) : null, start: a.startsAt, end: a.durationMin ? new Date(a.startsAt.getTime() + a.durationMin * 60_000) : null }));
  const start = items[0]?.start ?? issuedStartsAt;
  const end = items.length && items.every((i) => i.end) ? new Date(Math.max(...items.map((i) => i.end!.getTime()))) : null;
  if (!active.length) return { state: "cancelado", items, start, end, changed: false, canAct: false, canCancel: false };
  const base = { items, start, end, changed: start.getTime() !== issuedStartsAt.getTime() };
  if (active.some((a) => a.status === "solicitado")) return { ...base, state: "solicitado", canAct: false, canCancel: false };
  if (now.getTime() >= start.getTime() || active.every((a) => DONE.has(a.status))) return { ...base, state: "aconteceu", canAct: false, canCancel: false };
  const state: LinkState = active.every((a) => a.status === "confirmado") ? "confirmado" : "agendado";
  return { ...base, state, canAct: true, canCancel: now.getTime() <= start.getTime() - cancelarAteHoras * HOUR_MS };
}

/** "Corte feminino com Ana e Escova com Bia" (horas diferentes na visita: "11h Corte feminino com Ana e 13h Escova com Bia"). */
export function servicesText(items: ServiceItem[]): string {
  const parts = serviceParts(items);
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`;
}
type ServiceItem = { service: string; pro: string | null; start?: Date | null };
/**
 * Os serviços por quem atende, numa frase por profissional: "Luzes e Mechas e Coloração com Thaise" (17/10), na ordem em que aparecem.
 * O lembrete põe uma por linha. Serviço sem profissional fica sozinho.
 * Visita com serviços em horas diferentes (Luciana 29/10: Thaise às 11h e Jackson remanejado para 13h; o lembrete dizia "às 11h" para os dois):
 * cada linha leva a própria hora ("11h · Ritual de Tratamento com Thaise").
 */
export function serviceParts(items: ServiceItem[]): string[] {
  const hours = new Set(items.map((i) => (i.start ? messageHour(i.start) : "")));
  const withHour = hours.size > 1;
  const groups: { key: string; pro: string | null; hour: string; services: string[] }[] = [];
  for (const i of items) {
    const pro = i.pro ? displayName(i.pro) : null;
    const hour = withHour && i.start ? messageHour(i.start) : "";
    const key = `${hour}|${pro ?? ""}`;
    const g = pro ? groups.find((x) => x.key === key) : undefined;
    if (g) g.services.push(displayName(i.service)); else groups.push({ key, pro, hour, services: [displayName(i.service)] });
  }
  // Sem artigo antes do nome ("com Jackson"); o que vem do Avec em MAIÚSCULAS sai em Título.
  const join = (p: string[]) => (p.length <= 1 ? p.join("") : `${p.slice(0, -1).join(", ")} e ${p.at(-1)}`);
  return groups.map((g) => `${g.hour ? `${g.hour} · ` : ""}${g.pro ? `${join(g.services)} com ${g.pro}` : join(g.services)}`);
}

/** "sexta, 16 de outubro · 10:00 às 11:20" (sem duração: "às 10:00"). */
export function whenLine(start: Date, end: Date | null): string {
  return `${longDay(start)} · ${end ? `${hourText(start)} às ${hourText(end)}` : `às ${hourText(start)}`}`;
}

/** "Seu horário mudou: agora é sexta, 16/10, às 14:00". */
export const changedNotice = (start: Date) => `Seu horário mudou: agora é ${shortDay(start)}, às ${hourText(start)}`;

export type LinkTextVars = { primeiro_nome: string; data: string; hora: string; servicos: string; link: string };
/** O modelo da mensagem com as variáveis. Sem `{link}` no modelo, o link vai no fim: a mensagem nunca sai sem ele. */
export function renderLinkText(tpl: string, v: LinkTextVars): string {
  const text = tpl.replace(/\{(primeiro_nome|data|hora|servicos|link)\}/g, (_m, k: keyof LinkTextVars) => v[k]).replace(/,\s*!/g, "!").replace(/[ \t]{2,}/g, " ").trim();
  return tpl.includes("{link}") ? text : `${text}\n${v.link}`;
}

/** wa.me da Casa com o texto pronto; sem WhatsApp configurado, null. */
export function waLink(whatsapp: string | null, text: string): string | null {
  const digits = whatsapp?.replace(/\D/g, "") ?? "";
  return digits.length >= 10 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

/** "Como chegar": a busca do endereço no Maps (a página vai com Referrer-Policy: no-referrer, o token não vaza). */
export const mapsLink = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** O que a prévia do link mostra (Open Graph): igual para todo link, sem dado da cliente. */
export const LINK_OG = { title: "Seu horário na Casa Fiaes", description: "Confirme, remarque ou cancele com um toque." } as const;

/** Robôs que abrem o link só para montar a prévia (WhatsApp, Facebook, Telegram...): não contam como a cliente abrindo. */
export function isLinkPreviewBot(userAgent: string | null | undefined): boolean {
  return /whatsapp|facebookexternalhit|facebot|meta-externalagent|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|googlebot|bingbot|applebot|iframely|embedly|link-?preview/i.test(userAgent ?? "");
}
