/**
 * Lembrete do horário (Lote 7B, pedido do dono de 15/10): sai 24 h antes, dentro da janela 8h–20h de Salvador; se as 24 h caírem fora,
 * no limite da janela mais próximo, sempre antes do horário. Puro (servidor e testes). DESLIGADO até a gestão ligar.
 */
import { bahiaParts, slotMs } from "./schedule";
import { shiftDay } from "./agenda";
import { CASA_CONFIRMACAO_D1 } from "./casa-texts";

export const REMINDER_WINDOW = { from: 8 * 60, to: 20 * 60 } as const;
/** O que entra no fim do lembrete e da remarcação quando o link está ligado (`lembrete_d1.comLink`). */
export const LINK_SUFFIX = "Se quiser, confirme ou remarque por aqui: {link}";

const minuteOf = (ms: number) => { const t = bahiaParts(ms).time; return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); };
const at = (day: string, min: number) => slotMs(day, "00:00") + min * 60_000;

/** Dentro da janela de envio (8:00 até antes das 20:00, Salvador)? */
export const inReminderWindow = (ms: number) => { const m = minuteOf(ms); return m >= REMINDER_WINDOW.from && m < REMINDER_WINDOW.to; };

/** Quando o lembrete sai: 24 h antes; fora da janela, o limite mais próximo (8:00 ou 20:00) que ainda fica antes do horário. */
export function reminderSendAt(startMs: number): Date {
  const t = startMs - 86_400_000;
  const m = minuteOf(t), day = bahiaParts(t).date;
  if (m >= REMINDER_WINDOW.from && m <= REMINDER_WINDOW.to) return new Date(t);
  const options = m < REMINDER_WINDOW.from
    ? [at(day, REMINDER_WINDOW.from), at(shiftDay(day, -1), REMINDER_WINDOW.to)]
    : [at(day, REMINDER_WINDOW.to), at(shiftDay(day, 1), REMINDER_WINDOW.from)];
  const ok = options.filter((o) => o < startMs).sort((a, b) => Math.abs(a - t) - Math.abs(b - t) || a - b);
  return new Date(ok[0] ?? t);
}

/**
 * O instante cai na véspera do horário (o dia anterior, no relógio de Salvador)? O texto do lembrete diz "amanhã": fora da véspera
 * ele mente (17/10: saiu às 8h do próprio dia). Usado ao enfileirar e de novo na hora de enviar.
 */
export const isEveOf = (ms: number, startMs: number) => bahiaParts(ms).date === shiftDay(bahiaParts(startMs).date, -1);

/**
 * Arejado (17/10, a cliente não enxergava data e hora): quebras de linha, data e hora em negrito do WhatsApp, cada serviço numa linha.
 * Lembrete 24 h antes (pedido do dono, 15/10; DESLIGADO até a gestão ligar, com a confirmação de envio real). Vai SEM link por padrão:
 * só com `comLink` (quando a página da cliente estiver publicada) acrescenta {@link LINK_SUFFIX}. Fase B (item 11): é o texto da Casa
 * ({@link CASA_CONFIRMACAO_D1}), com endereço e mapa.
 */
export const DEFAULT_REMINDER_TEXT = CASA_CONFIRMACAO_D1;
/** Mensagem na hora em que o horário é remarcado (mesma chave do lembrete, desligada junto). */
export const DEFAULT_RESCHEDULED_TEXT = [
  "Oi, {primeiro_nome}! 💛", "", "Seu horário na Casa Fiaes foi remarcado para:", "", "📅 *{data}* às *{hora}*", "{servicos}", "",
  "Se o novo horário não ficar bom para você, é só me avisar por aqui.",
].join("\n");
/** Os serviços: cada item já é "Serviço com Profissional". `endereco` e `mapa` (Fase B) vêm da Página da cliente; vazios somem do texto. */
export type ReminderVars = { primeiro_nome: string; data: string; hora: string; servicos: string[]; endereco?: string; mapa?: string };
/** "a", "a e b", "a, b e c". */
const joinPt = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`);

/**
 * O texto com as variáveis. Com link: `{link}` vira o link (sem `{link}` no texto, a frase do link vai no fim, num parágrafo próprio se o
 * texto tem várias linhas). Sem link: `{link}` some. `{servicos}` sozinho numa linha: um serviço por linha (17/10, "tudo junto,
 * bagunçadinho"); no meio da frase: "a, b e c". As quebras de linha do modelo ficam.
 */
export function renderReminder(tpl: string, v: ReminderVars, link: string | null): string {
  const endereco = v.endereco?.trim() ?? "", mapa = endereco ? v.mapa?.trim() ?? "" : "";
  // Fase B: a linha com {endereco} sai sem endereço; a com {mapa}, sem mapa (ou sem endereço). Sem deixar linha em branco dupla.
  const lines = tpl.split("\n"), kept = lines.filter((l) => !(l.includes("{endereco}") && !endereco) && !(l.includes("{mapa}") && !mapa));
  if (kept.length !== lines.length) tpl = kept.join("\n").replace(/\n{3,}/g, "\n\n");
  const alone = /^[ \t]*\{servicos\}[ \t]*$/m.test(tpl);
  const vars = { ...v, servicos: alone ? v.servicos.join("\n") : joinPt(v.servicos), endereco, mapa };
  const fill = (s: string) => s.replace(/\{(primeiro_nome|data|hora|servicos|endereco|mapa|link)\}/g, (_m, k: keyof typeof vars | "link") => (k === "link" ? link ?? "" : vars[k]));
  let text = fill(tpl);
  if (link && !tpl.includes("{link}")) text = `${text.trim()}${text.includes("\n") ? "\n\n" : " "}${fill(LINK_SUFFIX)}`;
  return text.replace(/,[ \t]*!/g, "!").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/gm, "").trim();
}
