import { windowOf, type BusinessHours } from "@/lib/business-hours";
import { shiftDay } from "@/lib/agenda";
import { displayName } from "@/lib/display-name";

/**
 * Horários livres para a sugestão por IA (pedido do dono, 16/10: "ver os horários abertos para poder falar quais tem"). Módulo puro.
 * Só entra na parte VARIÁVEL do prompt e só quando a conversa pede horário; a lista é curtíssima (até 8 opções, ~150 tokens).
 */

export const FREE_DAYS = 5;
export const MAX_OPTIONS = 8;
/** Dentro do dia/período que a cliente pediu: mais opções (até 6). */
export const MAX_IN_WINDOW = 6;
export const MAX_LINE_CHARS = 560;
/** Marca gravada no começo do `motivo` da sugestão que ofereceu horários da lista (sem migration): a tela mostra o aviso. */
export const AGENDA_TAG = "[agenda]";

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ASK = new RegExp([
  "horario", "agenda", "marca", "remarca", "vaga", "disponi", "encaixe", "livre",
  "\\bdia\\b", "\\bdias\\b", "amanha", "\\bhoje\\b", "semana", "sabado", "domingo", "segunda", "terca", "quarta", "quinta", "sexta", "feriado",
  "manutencao", "que horas", "\\bmanha\\b", "\\btarde\\b", "\\bnoite\\b", "\\d{1,2} ?h\\b", "\\d{1,2}:\\d{2}", "\\bas \\d{1,2}\\b", "\\d{1,2}/\\d{1,2}",
].join("|"));

const GREET = /\b(bom dia|boa tarde|boa noite|tenha um otimo dia|bom fim de semana)\b/g;
/**
 * Tira o que é cadastro e nunca é pedido de horário (caso Lorena, 17/10: "CPF nome e-mail 11/03/2007" virou "qui 11/03"):
 * CPF, e-mail, telefone, marcadores do redact e data com ano anterior ao atual (nascimento). `t` já sem acento e em minúsculas.
 */
export function semCadastro(t: string, year: number): string {
  return t
    .replace(/\[(cpf|e-?mail|telefone)\]/g, " ")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}[-.]?\d{2}\b/g, " ")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, " ")
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, " ")
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g, (m, _d, _m, y: string) => ((y.length === 2 ? 2000 + Number(y) : Number(y)) < year ? " " : m));
}
/** A conversa parece pedir horário? Cumprimento ("bom dia", "boa tarde") e cadastro (CPF, e-mail, data de nascimento) não contam. */
export function asksForSlots(texts: (string | null | undefined)[], year = new Date().getFullYear()): boolean {
  return texts.some((t) => !!t && ASK.test(semCadastro(plain(t), year).replace(GREET, " ")));
}

/** Palavras que já são pedido de horário ("tem horário", "quero agendar", "remarcar", "vaga", "que horas"). */
const PEDE = /horario|agend|marca|remarca|reagend|vaga|disponi|encaixe|que horas/;
/** Quando (dia, período, hora): só vira pedido com intenção ("tem", "consegue", "pode ser", "quero", "preciso", ou pergunta). */
const QUANDO = /\bhoje\b|amanha|semana|sabado|domingo|segunda|terca|quarta|quinta|sexta|\bmanha\b|\btarde\b|\bnoite\b|\d{1,2} ?h\b|\d{1,2}:\d{2}|\bas \d{1,2}\b|\d{1,2}\/\d{1,2}|\bdia \d{1,2}\b/;
const INTENCAO = /\?|\b(?:tem|teria|consegue|conseguiria|pode|poderia|quero|queria|gostaria|prefiro|melhor|seria|possivel|possibilidade|preciso|precisava)\b/;
const CANCELA = /\b(?:desagend|desmarc|cancel)\w*/g;
const REMARCA = /remarc|reagend|outro dia|outra data|outro horario|(?:mudar|trocar) (?:o |de )?(?:dia|horario|data)/;
/**
 * A cliente pediu horário de verdade? É o gatilho da garantia do servidor (src/server/ai/pos.ts → `garantirHorario`): só aí a sugestão
 * tem que trazer um horário concreto. Não é pedido: cancelamento sem remarcar (em qualquer das mensagens), pergunta de preço, e dia/hora
 * sem intenção ("obrigada pelo atendimento de hoje", "vou chegar atrasada hoje").
 */
export function pediuHorario(texts: (string | null | undefined)[], year = new Date().getFullYear()): boolean {
  const ps = texts.filter((t): t is string => !!t).map((t) => semCadastro(plain(t), year).replace(GREET, " "));
  if (ps.some((p) => new RegExp(CANCELA.source).test(p)) && !ps.some((p) => REMARCA.test(p))) return false;
  return ps.some((raw) => { const p = raw.replace(CANCELA, " "); return PEDE.test(p) || (QUANDO.test(p) && INTENCAO.test(p)); });
}

/** Recusa ou pausa ("não deixe esse horário reservado", "vou pensar", "dar mais um tempo", "desisti"): não é pedido de horário. */
const RECUSA = /\bnao (?:deixe|deixa|precisa|quero mais|vou mais)\b|\bvou pensar\b|\b(?:dar|dando|dei) (?:mais )?um tempo\b|\bdesist|\blibera(?:r)? (?:o|esse|meu|a) (?:horario|vaga|reserva)\b/;
/** Ela pede para a Casa conferir com alguém ("verifica com ele", "confirma com o Jackson", "pergunta pra Thaise"): a resposta é conferir. */
const PEDE_CONFERIR = /\b(?:verifica|verifique|confere|confira|confirma|confirme|pergunta|pergunte|ve)\s+(?:com|pra|para|ao|a)\s+\S+/;
/** Pede horário novo mesmo já tendo um marcado ("tem vaga pra unha?", "outro dia", "quero marcar"). */
const PEDE_NOVO = /\b(?:tem|teria|tera|consegue|conseguiria|ha)\b[^.?!]{0,30}\b(?:horario|vaga|disponib|encaixe)|\boutr[oa] (?:dia|horario|data)\b|\bquero (?:marcar|agendar)\b/;
/**
 * Pedido de horário NOVO, o gatilho da garantia do servidor (src/server/ai/pos.ts → `garantirHorario`): `pediuHorario` menos os casos em
 * que oferecer um horário quebra a conversa (avaliação de coerência, 20/10): recusa ou pausa ("não deixe esse horário reservado"),
 * remarcação sem dia nem período (a equipe pergunta o melhor dia), pedido para conferir com alguém e conversa sobre o horário que ela já
 * tem marcado (`temHorario`) sem pedir outro.
 */
export function pediuHorarioNovo(texts: (string | null | undefined)[], opts: { temHorario?: boolean } = {}, year = new Date().getFullYear()): boolean {
  if (!pediuHorario(texts, year)) return false;
  const ps = texts.filter((t): t is string => !!t).map((t) => semCadastro(plain(t), year).replace(GREET, " "));
  const all = ps.join("\n");
  if (RECUSA.test(all) || PEDE_CONFERIR.test(all)) return false;
  const quando = ps.some((p) => QUANDO.test(p.replace(ORDINAL_SEMANA, " ")));
  if (REMARCA.test(all) && !quando) return false;
  if (opts.temHorario && !quando && !PEDE_NOVO.test(all)) return false;
  return true;
}

/* ---------- A janela pedida: dia(s) e período ---------- */
export type Period = "manha" | "tarde" | "noite";
/** Manhã antes das 12h, tarde 12h–18h, noite depois das 18h (minutos do dia). */
export const PERIOD_RANGE: Record<Period, [number, number]> = { manha: [0, 720], tarde: [720, 1080], noite: [1080, 1440] };
const PERIOD_LABEL: Record<Period, string> = { manha: "de manhã", tarde: "à tarde", noite: "à noite" };
const WEEKDAYS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
export type SlotWindow = { days: string[]; period: Period | null; label: string };

const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
/** A semana (segunda a domingo) do dia, a partir de hoje. */
const weekOf = (day: string, today: string) => Array.from({ length: 7 }, (_, i) => shiftDay(shiftDay(day, -((weekdayOf(day) + 6) % 7)), i)).filter((d) => d >= today);
/**
 * "semana do dia 26", "semana do 26/10", "semana que vem", "próxima semana": a semana inteira (caso Mary, 17/10: "semana do dia 26"
 * virava só a segunda 26/10, dia fechado). `null`: não pediu semana.
 */
function weekIn(t: string, today: string, dayOf: (s: string) => string[]): { days: string[]; label: string } | null {
  const m = /\bsemana do (?:dia )?(\d{1,2}(?:\/\d{1,2})?)\b/.exec(t);
  if (m) {
    const [d] = dayOf(m[1].includes("/") ? m[1] : `dia ${m[1]}`);
    if (d) { const w = weekOf(d, today); return w.length ? { days: w, label: `semana de ${dayLabel(shiftDay(d, -((weekdayOf(d) + 6) % 7))).slice(4)}` } : null; }
  }
  if (/\b(semana que vem|proxima semana)\b/.test(t)) {
    const monday = shiftDay(today, 7 - ((weekdayOf(today) + 6) % 7));
    return { days: weekOf(monday, today), label: `semana de ${dayLabel(monday).slice(4)}` };
  }
  return null;
}
/** "segunda semana", "primeira quinzena": ordinal de semana, não dia da semana (caso 19/09: "pode ser na segunda semana" virava segunda-feira). */
const ORDINAL_SEMANA = /\b(?:primeira|segunda|terceira|quarta|ultima) (?:semana|quinzena)\b/g;
function daysIn(raw: string, today: string): string[] {
  const t = raw.replace(ORDINAL_SEMANA, " ");
  const out = new Set<string>();
  if (/\bhoje\b/.test(t)) out.add(today);
  if (/\bdepois de amanha\b/.test(t)) out.add(shiftDay(today, 2));
  else if (/\bamanha\b/.test(t)) out.add(shiftDay(today, 1));
  WEEKDAYS.forEach((name, wd) => {
    if (!new RegExp(`\\b${name}`).test(t)) return;
    // "sábado que vem" / "próximo sábado" dito na véspera ou no dia: o da semana seguinte (caso Leomar, 17/10).
    const next = new RegExp(`\\b${name}(?:-feira)? que vem\\b|\\bproxim[oa] ${name}`).test(t);
    for (let i = 0; i < 7; i++) if (weekdayOf(shiftDay(today, i)) === wd) { out.add(shiftDay(today, next && i <= 1 ? i + 7 : i)); break; }
  });
  const [y, mo] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/g)) {
    const [dd, mm] = [Number(m[1]), Number(m[2])];
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) continue;
    // Com ano: ano passado nunca é pedido de horário (nascimento); senão vale o ano escrito.
    const yy = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    if (yy != null) { if (yy >= y && iso(yy, mm, dd) >= today) out.add(iso(yy, mm, dd)); continue; }
    const d = iso(y, mm, dd);
    out.add(d < today ? iso(y + 1, mm, dd) : d);
  }
  // "dia 21/11" é a data 21/11, não o dia 21 deste mês.
  for (const m of t.matchAll(/\bdia (\d{1,2})\b(?!\/)/g)) {
    const dd = Number(m[1]);
    if (dd < 1 || dd > 31) continue;
    const d = iso(y, mo, dd);
    out.add(d < today ? (mo === 12 ? iso(y + 1, 1, dd) : iso(y, mo + 1, dd)) : d);
  }
  return [...out].sort();
}
function periodIn(t: string): Period | null {
  if (/\bmanha\b|\bcedo\b/.test(t)) return "manha";
  if (/\btarde\b|\bdepois do almoco\b/.test(t)) return "tarde";
  if (/\bnoite\b|\bdepois do trabalho\b/.test(t)) return "noite";
  return null;
}

/**
 * O dia e o período que a cliente pediu ("terça à tarde", "amanhã cedo", "dia 20", "20/10", "hoje à noite"). Da mensagem mais nova
 * para a mais antiga: o dia vem da mais nova que cita dia, o período da mais nova que cita período. Cumprimento não conta.
 */
export function parseWindow(texts: (string | null | undefined)[], today: string): SlotWindow | null {
  let days: string[] = [], period: Period | null = null, week: string | null = null;
  for (const raw of [...texts].reverse()) {
    if (!raw) continue;
    // Cadastro (CPF, e-mail, data de nascimento) não é dia pedido.
    const t = semCadastro(plain(raw), Number(today.slice(0, 4))).replace(GREET, " ");
    if (!days.length) {
      const w = weekIn(t, today, (x) => daysIn(x, today));
      if (w) ({ days, label: week } = w); else days = daysIn(t, today);
    }
    period ??= periodIn(t);
    if (days.length && period) break;
  }
  if (!days.length && !period) return null;
  const label = [week ?? days.map(dayLabel).join(", "), period ? PERIOD_LABEL[period] : ""].filter(Boolean).join(" ");
  return { days, period, label };
}
const inWindow = (w: SlotWindow, day: string, start: number) =>
  (!w.days.length || w.days.includes(day)) && (!w.period || (start >= PERIOD_RANGE[w.period][0] && start < PERIOD_RANGE[w.period][1]));

/** Dentro da janela: por profissional, horários a cada 1 h ou mais; vai pegando o 1º de cada uma, depois o 2º… (até `max`). */
export function pickInWindow(days: DayFree[], w: SlotWindow, max = MAX_IN_WINDOW): Picked[] {
  const lists: Picked[][] = [];
  for (const d of days) for (const p of d.pros) {
    const l: Picked[] = [];
    for (const s of p.starts) if (inWindow(w, d.day, s) && (!l.length || s >= l.at(-1)!.start + 60)) l.push({ day: d.day, name: p.name, start: s, proId: p.id });
    if (l.length) lists.push(l);
  }
  const out: Picked[] = [];
  for (let k = 0; out.length < max && lists.some((l) => l.length > k); k++) for (const l of lists) if (l[k] && out.length < max) out.push(l[k]);
  return out;
}

// "cabelo" é a categoria, não o serviço: "meu cabelo hoje" não escolhe "Cabelo Método Fiaes 1" (20/10, P33).
const STOP = new Set(["casa", "fiaes", "para", "com", "sem", "dos", "das", "uma", "the", "cabelo", "cabelos"]);
/** Palavras da descrição que não dizem qual é o serviço ("Profissional autorizado: THAISE…"). */
const DESC_STOP = new Set(["profissional", "autorizado", "autorizada", "profissionais"]);
const words = (s: string) => plain(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));

/**
 * O serviço que o texto cita: o que tem mais palavras do nome no texto (empate: o que tem a maior parte do nome, depois o `prefere`
 * (o assunto da cliente, ex.: ela é do Método), depois o nome mais curto). Nome de profissional (`nomes`) não conta como palavra do serviço
 * (20/10: "retoque de raiz com Thaise" virava "Corte Thaise Fiaes"; "manutenção" de cliente do Método virava "Manutenção unha Gel").
 * "escova" → Escova (não Escova Progressiva); "progressiva" → Escova Progressiva; "manutenção" → Manutenção Método Fiaes.
 */
export function serviceFromText<T extends { label: string; description?: string | null }>(text: string, services: T[], o: { nomes?: string[]; prefere?: (s: T) => boolean | number } = {}): T | null {
  const nomes = new Set((o.nomes ?? []).map((n) => plain(n.trim().split(/\s+/)[0] ?? "")).filter((n) => n.length >= 3));
  // O nome no texto não acerta o serviço; no nome do serviço ele continua contando para a fração ("Corte Thaise Fiaes" é mais
  // específico que "Corte Feminino": "corte" sozinho não o escolhe).
  const inText = new Set(words(text).filter((x) => !nomes.has(x)));
  const pref = (s: T) => Number(o.prefere?.(s) ?? 0);
  let best: { s: T; hit: number; frac: number } | null = null;
  for (const s of services) {
    const w = [...new Set(words(s.label))];
    const hit = w.filter((x) => inText.has(x)).length;
    if (!hit) continue;
    const frac = hit / w.length;
    if (!best || hit > best.hit || (hit === best.hit && (frac > best.frac || (frac === best.frac && (pref(s) > pref(best.s) || (pref(s) === pref(best.s) && s.label.length < best.s.label.length)))))) best = { s, hit, frac };
  }
  if (best) return best.s;
  // Sem nada no nome: a lista de opções da descrição ("Hidratação | Nutrição | Reconstrução: …" é o Ritual de Tratamento). Só a parte "a | b | c" antes
  // dos dois pontos; descrição em texto corrido cita "volume", "textura"… de qualquer serviço (20/10: Alinhamento no lugar do Método).
  let byDesc: { s: T; hit: number } | null = null;
  for (const s of services) {
    const opcoes = s.description?.includes(" | ") ? s.description.split(":")[0] : "";
    const hit = [...new Set(words(opcoes))].filter((x) => x.length >= 6 && !DESC_STOP.has(x) && !nomes.has(x) && inText.has(x)).length;
    if (hit && (!byDesc || hit > byDesc.hit || (hit === byDesc.hit && (pref(s) > pref(byDesc.s) || (pref(s) === pref(byDesc.s) && s.label.length < byDesc.s.label.length))))) byDesc = { s, hit };
  }
  return byDesc?.s ?? null;
}

/** Os próximos `n` dias com a Casa aberta, a partir de hoje (até 3 semanas para frente). */
export function openDays(today: string, casa: BusinessHours, n = FREE_DAYS, span = 21): string[] {
  const out: string[] = [];
  for (let i = 0; i < span && out.length < n; i++) {
    const day = shiftDay(today, i);
    if (windowOf(Date.parse(`${day}T00:00:00Z`), casa)) out.push(day);
  }
  return out;
}

const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dayLabel = (day: string) => `${WD[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
export const hourLabel = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;
export const durationText = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ""}`);
/** "ANA PAULA" → "Ana". */
export const proFirstName = (name: string) => {
  const f = name.trim().split(/\s+/)[0] ?? "";
  return f ? f.charAt(0).toLocaleUpperCase("pt-BR") + f.slice(1).toLocaleLowerCase("pt-BR") : "Profissional";
};

export type DayFree = { day: string; pros: { id?: string; name: string; starts: number[] }[] };
/** Uma opção escolhida para a linha (a profissional pelo nome de tela e, quando veio, pelo id). */
export type Picked = { day: string; name: string; start: number; proId?: string };
/** Opção da linha com o id que a IA devolve ("h3"). */
export type FreeOption = Picked & { id: string };

/**
 * Escolhe até `max` opções espalhadas. Em cada dia, por profissional, um horário de manhã e um de tarde, alternando (uma de manhã, a
 * outra de tarde) para variar; depois vai dia a dia pegando uma de cada, para cobrir vários dias em vez de lotar o primeiro.
 * `rotate`: sem profissional preferida, a ordem delas gira a cada dia (todas aparecem); com preferida, ela vem sempre primeiro.
 */
export function pickOptions(days: DayFree[], max = MAX_OPTIONS, rotate = false): Picked[] {
  const perDay = days.map((d, di) => {
    const n = d.pros.length, pros = rotate && n ? d.pros.map((_, j) => d.pros[(j + di) % n]) : d.pros;
    const first: Picked[] = [], rest: Picked[] = [];
    pros.forEach((p, j) => {
      const am = p.starts.find((s) => s < 720), pm = p.starts.find((s) => s >= 720);
      const [a, b] = j % 2 === 0 ? [am, pm] : [pm, am];
      const one = a ?? b, two = a != null ? b : one != null ? p.starts.find((s) => s >= one + 120) : undefined;
      if (one != null) first.push({ day: d.day, name: p.name, start: one, proId: p.id });
      if (two != null) rest.push({ day: d.day, name: p.name, start: two, proId: p.id });
    });
    return [...first, ...rest];
  });
  const out: Picked[] = [];
  for (let k = 0; out.length < max && perDay.some((c) => c.length > k); k++) {
    for (const c of perDay) if (c[k] && out.length < max) out.push(c[k]);
  }
  return out;
}

/**
 * A linha que vai para a IA: "Horários livres (Manutenção Método Fiaes, 4 h): ter 21/10 Thaise 9h (h1), 13h (h2) · qua 22/10 Thaise 9h (h3)".
 * Cada opção ganha um id curto (h1…h8) que a IA devolve em `horario`; o servidor guarda o que cada id quer dizer (`options`).
 * Com a janela pedida (`window`): só as opções dentro dela ("… para ter 20/10 à tarde: …"); sem nada nela, as mais próximas avisando.
 * Sem nenhum: diz isso (só aí a IA responde que vai verificar a agenda).
 */
export function formatFreeHours(i: { serviceLabel: string; durationMin: number; days: DayFree[]; max?: number; rotate?: boolean; window?: SlotWindow | null;
  /** Regra "A IA oferece só com" valendo: o serviço é só com ela(s) ("só com Thaise"). */
  onlyWith?: string | null }): { line: string; options: FreeOption[];
  /** A janela pedida sem nada livre ("sáb 17/10 à tarde"): as opções são as mais próximas (a garantia do servidor diz isso à cliente). */
  fora: string | null } {
  // Nome do serviço como a tela mostra ("MANUTENÇÃO PROTESE CAPILAR" → "Manutenção Protese Capilar").
  const head = `Horários livres (${displayName(i.serviceLabel.trim())}, ${durationText(i.durationMin)}${i.onlyWith ? `; só com ${i.onlyWith}` : ""})`;
  const w = i.window ?? null;
  const inside = w ? pickInWindow(i.days, w, i.max ?? MAX_IN_WINDOW) : [];
  // As mais próximas: a partir do dia pedido (se houver alguma livre dali em diante), senão de todos os dias.
  const from = w?.days.length ? i.days.filter((d) => d.day >= w.days[0]) : [];
  const near = inside.length ? [] : pickOptions(from.some((d) => d.pros.some((p) => p.starts.length)) ? from : i.days, i.max ?? MAX_OPTIONS, i.rotate);
  if (!inside.length && !near.length) return { line: `${head}: nenhum nos próximos ${FREE_DAYS} dias de funcionamento na agenda do CRM.`, options: [], fora: null };
  const { text, options } = partsOf(inside.length ? inside : near);
  let line = inside.length ? `${head} para ${w!.label}: ${text}`
    : w ? `${head}: nenhum livre ${w.label}; os mais próximos: ${text}` : `${head}: ${text}`;
  if (line.length > MAX_LINE_CHARS) line = `${line.slice(0, MAX_LINE_CHARS - 1)}…`;
  // Linha cortada: só valem os ids que ficaram nela.
  return { line, options: options.filter((o) => line.includes(`(${o.id})`)), fora: !inside.length && w ? w.label : null };
}

/** As opções por dia e profissional, em ordem; os ids (h1, h2…) seguem a ordem em que aparecem na linha. */
function partsOf(picked: Picked[]): { text: string; options: FreeOption[] } {
  const byDay = new Map<string, Map<string, Picked[]>>();
  for (const o of picked) {
    const d = byDay.get(o.day) ?? new Map<string, Picked[]>();
    d.set(o.name, [...(d.get(o.name) ?? []), o]);
    byDay.set(o.day, d);
  }
  const options: FreeOption[] = [];
  const text = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, pros]) => `${dayLabel(day)} ${[...pros.entries()].map(([n, l]) =>
    `${n} ${[...l].sort((a, b) => a.start - b.start).map((o) => { const id = `h${options.length + 1}`; options.push({ ...o, id }); return `${hourLabel(o.start)} (${id})`; }).join(", ")}`).join("; ")}`).join(" · ");
  return { text, options };
}

/** A sugestão ofereceu horário ("9h", "13h30", "às 14:00")? Só aí a tela mostra "confira antes de enviar". */
export const mentionsTime = (s: string) => /\b\d{1,2}(?:h(?:\d{2})?\b|:\d{2}\b)/i.test(s);

/* ---------- Assunto Método Fiaes, concordância da cliente e o horário que a Casa ofereceu ---------- */

/** A conversa é do Método Fiaes (avaliação do Método, transição, preenchimento, aplicação, manutenção, revisão)? Texto, serviço ou pacote. */
const METODO = /\bmetodo\b|\btransicao\b|\bpreenchimento\b|\baplicacao\b|\bmanutencao\b|\brevisao\b/;
export function metodoTopic(texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && METODO.test(plain(t)));
}
/** Tira as palavras que só dizem "é do Método" (para saber se a cliente citou um serviço de verdade). */
export const withoutMetodoWords = (t: string) => plain(t).replace(/\bmetodo\b|\bfiaes\b/g, " ");

const AGREE = /^(sim|ss+|s|fica sim|fica bom|fica otimo|fica perfeito|sim fica|ficou bom|pode ficar|da sim|da certo|pode|pode ser|pode sim|pode marcar|pode reservar|pode agendar|pode confirmar|fechado|fechou|fecha|quero|quero sim|ok|okay|okk+|blz|beleza|perfeito|otimo|combinado|claro|com certeza|bora|vamos|serve|show|top|isso|isso mesmo|esse|essa|esse mesmo|essa mesmo|marca|marcar|reserva|agenda|agendar|confirmo|confirmado|certo|certinho|correto|ta bom|ta otimo|ta certo|pode ser sim|sim pode ser|melhor|prefiro)\b/;
const NEG = /\b(nao|nem|nunca|outro|outra|depois|ainda)\b|\?/;
/** O que vem antes da concordância sem mudar nada ("Então pode ser 14:30", "Oi, pode marcar!", "Bom dia Confirmado"). */
const LEAD = /^(?:(?:oi+e?|ola|bom dia|boa tarde|boa noite|entao|ah+)\s+)+/;
const HORA = "\\d{1,2}(?:h\\d{0,2}|:\\d{2})(?:hs?)?";
/** A hora sozinha, com ou sem "às" ("As 13:00hs", "16h30 pode ser", "As 13:00 né"). */
const SO_HORA = new RegExp(`^(?:as )?${HORA}(?: (?:mesmo|ne|certo|entao|pode ser|por favor|pfv))*$`);
/** Pergunta que só confirma o combinado ("Então ficamos com 14:30 mesmo?", "Certo! Só para confirmar, 9h?"): o "?" não é dúvida. */
const CONFIRMA = new RegExp(`^(?:(?:ficamos|ficou|vai ser)(?: com| as| a das)? ${HORA}(?: mesmo| ne| certo| entao)*$|.*\\bso (?:pra|para) confirmar\\b.*${HORA}|.*${HORA} (?:mesmo|ne|certo)$)`);
/** Concordam só sozinhas: seguidas de mais texto são pedido ("quero saber…", "agenda pra mim…", "prefiro sábado"). */
const SO_SOZINHO = new Set(["quero", "agenda", "agendar", "marca", "marcar", "reserva", "prefiro", "melhor", "vamos", "bora"]);
const limpa = (t: string) => plain(t).replace(/[^a-z0-9: ]+/g, " ").replace(/\s+/g, " ").trim().replace(LEAD, "");
/**
 * A cliente concordou com o que a Casa ofereceu ("pode ser", "sim", "fechado", "quero", "a das 16h30", "Então pode ser 14:30", "Correto",
 * "As 13:00hs", "Então ficamos com 14:30 mesmo?")? Só mensagens curtas, sem "não", sem pergunta de verdade e sem pedir outra coisa.
 * Recebe as mensagens dela desde a última da Casa.
 */
export function isAgreement(texts: (string | null | undefined)[]): boolean {
  const all = texts.filter((t): t is string => !!t?.trim());
  if (!all.length) return false;
  // A pergunta que só confirma não conta como dúvida.
  const joined = all.map((t) => (CONFIRMA.test(limpa(t)) ? plain(t).replace(/\?/g, " ") : plain(t))).join(" ");
  if (NEG.test(joined) || joined.split(/\s+/).length > 16) return false;
  return all.some((t) => {
    const p = limpa(t);
    if (CONFIRMA.test(p) || SO_HORA.test(p) || /^(a|as|o) (das|de|do) \d{1,2}/.test(p)) return true;
    // Concordância curta: "quero/agenda/marca/prefiro…" só sozinhos ("Bom dia, quero marcar escova" é pedido, não concordância).
    const m = AGREE.exec(p);
    if (!m) return false;
    const tail = p.slice(m[0].length).trim();
    return SO_SOZINHO.has(m[1]) ? !tail || /^(sim|mesmo|entao)$/.test(tail) : tail.split(" ").filter(Boolean).length <= 4;
  });
}

/** Horários citados ("15h", "16h30", "14:00", "às 9"), com a posição no texto. */
export function hourMentions(text: string): { start: number; at: number }[] {
  const t = plain(text), out: { start: number; at: number }[] = [];
  for (const m of t.matchAll(/\b(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?![\d/])|\bas (\d{1,2})\b(?![/:\d])/g)) {
    const h = Number(m[1] ?? m[4]), min = Number(m[2] ?? m[3] ?? 0);
    if (h > 23 || min > 59 || (m[4] && (h < 7 || h > 21))) continue;
    out.push({ start: h * 60 + min, at: m.index! });
  }
  return out;
}

/** Dias citados, com a posição: "hoje", "amanhã", dia da semana, "20/10", "dia 20". */
export function dayMentions(text: string, today: string): { day: string; at: number }[] {
  const t = plain(text).replace(ORDINAL_SEMANA, (m) => " ".repeat(m.length)), out: { day: string; at: number }[] = [];
  const re = /\bdepois de amanha\b|\bamanha\b|\bhoje\b|\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)\b|\b(\d{1,2})\/(\d{1,2})\b|\bdia (\d{1,2})\b(?!\/)/g;
  for (const m of t.matchAll(re)) {
    const one = daysIn(m[0], today);
    if (one.length) out.push({ day: one[0], at: m.index! });
  }
  return out;
}

const firstPlain = (name: string) => plain(name.trim().split(/\s+/)[0] ?? "");
/**
 * O horário que a Casa ofereceu na mensagem dela, para a cliente que concordou: dia, hora e profissional. Com mais de um horário,
 * vale o que a cliente citou ("a das 16h30"); sem isso, é ambíguo (a IA pergunta qual). O dia: o citado mais perto antes do horário
 * (senão depois); sem dia na mensagem da Casa, o único dia que a cliente pediu antes. A profissional: o nome mais perto do horário,
 * no mesmo trecho (entre um horário e outro); a que a cliente citou vale mais.
 */
export function offeredSlot(i: { casa: string; client: string[]; before?: string[]; today: string; pros: { id: string; name: string }[] }):
  { status: "ok"; day: string; start: number; proId: string | null } | { status: "ambiguo"; times: number[] } | null {
  const times = hourMentions(i.casa);
  const starts = [...new Set(times.map((x) => x.start))];
  if (!starts.length) return null;
  const said = new Set(i.client.flatMap((c) => hourMentions(c).map((x) => x.start)));
  const picked = starts.filter((s) => said.has(s));
  // Ela respondeu com OUTRA hora (contraproposta: "As 16h" para os 15h da Casa): não é concordância com o que a Casa ofereceu.
  if (said.size && !picked.length) return null;
  const start = picked.length === 1 ? picked[0] : starts.length === 1 ? starts[0] : null;
  if (start == null) return { status: "ambiguo", times: starts };
  const at = times.find((x) => x.start === start)!.at;
  const days = dayMentions(i.casa, i.today);
  const prior = days.filter((d) => d.at < at).at(-1) ?? days.find((d) => d.at > at);
  const asked = parseWindow(i.before ?? [], i.today)?.days ?? [];
  const day = prior?.day ?? (asked.length === 1 ? asked[0] : null);
  if (!day) return null;
  const t = plain(i.casa);
  const names = i.pros.map((p) => ({ id: p.id, key: firstPlain(p.name) })).filter((p) => p.key.length >= 3);
  const byClient = names.filter((p) => i.client.some((c) => new RegExp(`\\b${p.key}\\b`).test(plain(c))));
  let proId: string | null = byClient.length === 1 ? byClient[0].id : null;
  if (!proId) {
    const lo = times.filter((x) => x.at < at).at(-1)?.at ?? -1, hi = times.find((x) => x.at > at)?.at ?? t.length;
    const found = names.flatMap((p) => [...t.matchAll(new RegExp(`\\b${p.key}\\b`, "g"))].map((m) => ({ id: p.id, at: m.index! })));
    const near = found.filter((f) => f.at > lo && f.at < hi).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at));
    const distinct = [...new Set(found.map((f) => f.id))];
    proId = near[0]?.id ?? (distinct.length === 1 ? distinct[0] : null);
  }
  return { status: "ok", day, start, proId };
}
