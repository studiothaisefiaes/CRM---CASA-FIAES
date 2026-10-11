/** Etiquetas de sinal de um lead, calculadas só pelas últimas mensagens. Funções puras (sem banco). */
export type Signal = "pediu_preco" | "pediu_horario" | "sumiu_apos_preco" | "respondeu_rapido";
export type SignalMessage = { direction: "in" | "out"; body: string | null; createdAt: Date | string };

/** Rótulos curtos, na ordem de prioridade (a Fila mostra no máximo 2). */
export const SIGNAL_LABEL: Record<Signal, string> = {
  sumiu_apos_preco: "Sumiu após preço", pediu_preco: "Pediu preço", pediu_horario: "Pediu horário", respondeu_rapido: "Responde rápido",
};
export const SIGNAL_ORDER: Signal[] = ["sumiu_apos_preco", "pediu_preco", "pediu_horario", "respondeu_rapido"];
export const QUEUE_SIGNAL_MAX = 2;
export const SIGNAL_WINDOW = 30;

const HOUR_MS = 3_600_000;
export const GHOST_AFTER_PRICE_MS = 24 * HOUR_MS;
export const FAST_REPLY_MS = 2 * 60_000;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ASKS_PRICE = /\b(precos?|valor(es)?|quanto( custa| e| fica| sai| cobra| ta| esta|s)?|custa(m)?|custo|orcamento|tabela|investimento)\b/;
const ASKS_TIME = /\b(horarios?|vagas?|disponivel|disponibilidade|agenda|agendar|agendamento|encaixe|que horas|tem (hoje|amanha|sabado|domingo|segunda|terca|quarta|quinta|sexta))\b/;
const MONEY = /r\s?\$\s*\d|\b\d+([.,]\d+)?\s*(reais|conto|contos)\b/;
const PRICE_CONTEXT = /\b(valor|preco|custa|sai por|fica|investimento|por apenas|a partir de)\b[^\d]{0,25}\d/;
const sentPrice = (body: string) => { const t = fold(body); return MONEY.test(t) || PRICE_CONTEXT.test(t); };
const ts = (d: Date | string) => new Date(d).getTime();

export function signalsOf(messages: SignalMessage[], now: Date = new Date()): Signal[] {
  const msgs = [...messages].sort((a, b) => ts(a.createdAt) - ts(b.createdAt));
  const out = new Set<Signal>();
  for (const m of msgs) {
    if (m.direction !== "in" || !m.body) continue;
    const t = fold(m.body);
    if (ASKS_PRICE.test(t)) out.add("pediu_preco");
    if (ASKS_TIME.test(t)) out.add("pediu_horario");
  }
  // Sumiu após o preço: a Casa mandou valor e, desde então, a cliente não disse mais nada há mais de 24 h.
  let lastPrice = -1;
  msgs.forEach((m, i) => { if (m.direction === "out" && m.body && sentPrice(m.body)) lastPrice = i; });
  if (lastPrice >= 0 && !msgs.slice(lastPrice + 1).some((m) => m.direction === "in") && now.getTime() - ts(msgs[lastPrice].createdAt) > GHOST_AFTER_PRICE_MS) out.add("sumiu_apos_preco");
  // Respondeu rápido: a cliente respondeu à Casa em menos de 2 minutos.
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i - 1].direction === "out" && msgs[i].direction === "in" && ts(msgs[i].createdAt) - ts(msgs[i - 1].createdAt) < FAST_REPLY_MS) { out.add("respondeu_rapido"); break; }
  }
  return SIGNAL_ORDER.filter((s) => out.has(s));
}

/** Rótulos prontos para a tela, no máximo `max`. */
export const signalLabels = (signals: Signal[], max = QUEUE_SIGNAL_MAX) => signals.slice(0, max).map((s) => SIGNAL_LABEL[s]);

export const SIGNAL_LABELS: ReadonlySet<string> = new Set(Object.values(SIGNAL_LABEL));
