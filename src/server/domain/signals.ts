/** Etiquetas de sinal de um lead, calculadas só pelas últimas mensagens. Funções puras (sem banco). */
export type Signal = "pediu_preco" | "pediu_horario" | "sumiu_apos_preco"
  | "pediu_desconto" | "remarcar_cancelar" | "reclamacao" | "evento" | "urgente" | "indicacao";
export type SignalMessage = { direction: "in" | "out"; body: string | null; createdAt: Date | string };

/** Rótulos curtos, na ordem de prioridade (a Fila mostra no máximo 2). */
export const SIGNAL_LABEL: Record<Signal, string> = {
  reclamacao: "Reclamação", urgente: "Urgente", sumiu_apos_preco: "Sumiu após preço", remarcar_cancelar: "Quer remarcar/cancelar",
  pediu_preco: "Pediu preço", pediu_horario: "Pediu horário", evento: "Evento/noiva", pediu_desconto: "Pediu desconto",
  indicacao: "Indicação",
};
/** Ordem de prioridade (a Fila mostra no máximo 2): risco primeiro. */
export const SIGNAL_ORDER: Signal[] = ["reclamacao", "urgente", "sumiu_apos_preco", "remarcar_cancelar", "pediu_preco", "pediu_horario", "evento", "pediu_desconto", "indicacao"];
export const QUEUE_SIGNAL_MAX = 2;
export const SIGNAL_WINDOW = 30;

const HOUR_MS = 3_600_000;
export const GHOST_AFTER_PRICE_MS = 24 * HOUR_MS;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// "quanto" só conta com verbo de preço ("quanto tempo dura?" não é pedido de preço); custo, tabela e investimento pedem contexto.
const ASKS_PRICE = /\b(precos?|valor(es)?|quanto (custa|custam|e|fica|sai|cobra|que e|ta|esta)|custa(m)?|orcamento|(qual|quais) (o|e o|a|as) (custo|investimento|tabela de (precos?|valores?))|(custo|investimento) (da|do|de|para|pra)|tabela de (precos?|valores?))\b/;
const ASKS_TIME = /\b(horarios?|vagas?|disponivel|disponibilidade|agenda|agendar|agendamento|encaixe|que horas|tem (hoje|amanha|sabado|domingo|segunda|terca|quarta|quinta|sexta))\b/;
const ASKS_DISCOUNT = /\b(descontos?|promocao|promocoes|promo|cupom|cupons|faz por menos|fazer por menos|mais barato)\b/;
const RESCHEDULE = /\b(remarcar|desmarcar|cancelar|nao vou (poder|conseguir) (ir|vir|comparecer))\b/;
// "não gostei (muito) do preço" é objeção de preço; "não posso reclamar" é elogio; "o sol queimou" não é culpa do salão (só "queimaram").
const COMPLAINT = /(?<!nao posso )(?<!nao tenho do que )(?<!nao tenho de que )(?<!nada a )\b(reclamacao|reclamar)\b|\b(insatisfeita|insatisfeito|ficou (ruim|horrivel|pessimo|feio)|estragou|estragaram|manchou|queimaram|nao gostei(?!(?: \w+){0,2} (?:d[oa]s? )?(?:precos?|valor(?:es)?)))\b/;
const EVENT = /\b(noiva|noivado|casamento|me caso|vou casar|formatura|madrinha|debutante|festa)\b/;
const URGENT = /\b(urgente|urgencia|hoje ainda|ainda hoje|o quanto antes|o mais rapido possivel|pra ja)\b/;
const REFERRAL = /\b(me indicou|indicaram|indicacao|me passaram (seu|o seu|o) (contato|numero)|me recomendou|recomendacao)\b/;
const MONEY = /r\s?\$\s*\d|\b\d+([.,]\d+)?\s*(reais|conto|contos)\b/;
const PRICE_CONTEXT = /\b(valor|preco|custa|sai por|investimento|por apenas|a partir de)\b[^\d]{0,25}\d/; // sem "fica": casa com endereço ("fica na Rua X, 123")
const sentPrice = (body: string) => { const t = fold(body); return MONEY.test(t) || PRICE_CONTEXT.test(t); };
// A Casa ofereceu um horário: "14h", "às 9h30", "15:30", "10 horas".
const OFFERS_TIME = /\b\d{1,2}\s?(h\d{0,2}|:\d{2}|horas?)\b/;
const sentTime = (body: string) => OFFERS_TIME.test(fold(body));
const ts = (d: Date | string) => new Date(d).getTime();

/**
 * Sinais das últimas mensagens. "Pediu preço" e "Pediu horário" valem só enquanto não respondidos: somem quando a Casa manda um valor
 * (ou um horário) depois da última pergunta da cliente, e voltam se ela perguntar de novo.
 */
export function signalsOf(messages: SignalMessage[], now: Date = new Date()): Signal[] {
  const msgs = [...messages].sort((a, b) => ts(a.createdAt) - ts(b.createdAt));
  const out = new Set<Signal>();
  let askPrice = -1, askTime = -1;
  msgs.forEach((m, i) => {
    if (m.direction !== "in" || !m.body) return;
    const t = fold(m.body);
    if (ASKS_PRICE.test(t)) askPrice = i;
    if (ASKS_TIME.test(t)) askTime = i;
    if (ASKS_DISCOUNT.test(t)) out.add("pediu_desconto");
    if (RESCHEDULE.test(t)) out.add("remarcar_cancelar");
    if (COMPLAINT.test(t)) out.add("reclamacao");
    if (EVENT.test(t)) out.add("evento");
    if (URGENT.test(t)) out.add("urgente");
    if (REFERRAL.test(t)) out.add("indicacao");
  });
  const answered = (from: number, test: (body: string) => boolean) => msgs.slice(from + 1).some((m) => m.direction === "out" && !!m.body && test(m.body));
  if (askPrice >= 0 && !answered(askPrice, sentPrice)) out.add("pediu_preco");
  if (askTime >= 0 && !answered(askTime, sentTime)) out.add("pediu_horario");
  // Sumiu após o preço: a Casa mandou valor e, desde então, a cliente não disse mais nada há mais de 24 h.
  let lastPrice = -1;
  msgs.forEach((m, i) => { if (m.direction === "out" && m.body && sentPrice(m.body)) lastPrice = i; });
  if (lastPrice >= 0 && !msgs.slice(lastPrice + 1).some((m) => m.direction === "in") && now.getTime() - ts(msgs[lastPrice].createdAt) > GHOST_AFTER_PRICE_MS) out.add("sumiu_apos_preco");
  return SIGNAL_ORDER.filter((s) => out.has(s));
}

/** Rótulos prontos para a tela, no máximo `max`. */
export const signalLabels = (signals: Signal[], max = QUEUE_SIGNAL_MAX) => signals.slice(0, max).map((s) => SIGNAL_LABEL[s]);

export const SIGNAL_LABELS: ReadonlySet<string> = new Set(Object.values(SIGNAL_LABEL));

/* ---------- Interesse por serviço e palavras-chave da gestão (comparação por palavra/frase inteira) ---------- */
/** Sem acento, minúsculo e sem pontuação: "MEGA-HAIR!" vira "mega hair". */
const plain = (s: string) => fold(s).replace(/[^a-z0-9]+/g, " ").trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRe = (phrase: string) => new RegExp(`(^| )${escape(plain(phrase))}( |$)`);

/** O primeiro serviço cadastrado cujo nome aparece como palavra inteira ("corte" não casa com "cortesia"). */
export function matchService<T extends { label: string }>(body: string | null | undefined, services: T[]): T | null {
  if (!body) return null;
  const t = plain(body);
  return services.find((s) => plain(s.label) && phraseRe(s.label).test(t)) ?? null;
}

export type KeywordItem = { label: string; phrases: string[]; boost: boolean };
/** Palavras-chave da gestão que aparecem na mensagem (frase inteira, sem acento, caixa ou pontuação). */
export function matchKeywords<T extends KeywordItem>(body: string | null | undefined, items: T[]): T[] {
  if (!body) return [];
  const t = plain(body);
  return items.filter((k) => k.phrases.some((p) => plain(p) && phraseRe(p).test(t)));
}

/**
 * As mesmas comparações, montadas uma vez para muitos leads (a Fila): cada mensagem é testada sozinha (uma frase da
 * gestão não emenda o fim de uma mensagem com o começo da outra). Serviço de nome mais longo primeiro ("Corte feminino" antes de "Corte").
 */
export function compileMatchers<S extends { label: string }, K extends KeywordItem>(services: S[], keywords: K[]) {
  const svc = [...services].filter((s) => plain(s.label)).sort((a, b) => plain(b.label).length - plain(a.label).length).map((s) => ({ s, re: phraseRe(s.label) }));
  const kws = keywords.map((k) => ({ k, res: k.phrases.filter((p) => plain(p)).map(phraseRe) }));
  return {
    service: (bodies: string[]): S | null => {
      const texts = bodies.map(plain);
      return svc.find(({ re }) => texts.some((t) => re.test(t)))?.s ?? null;
    },
    keywords: (bodies: string[]): K[] => {
      const texts = bodies.map(plain);
      return kws.filter(({ res }) => res.some((re) => texts.some((t) => re.test(t)))).map(({ k }) => k);
    },
  };
}
