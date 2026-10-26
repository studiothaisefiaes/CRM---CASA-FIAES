/**
 * Pós-processamento do texto da IA, antes de gravar ou mostrar (sugestão de resposta e "Escrever com IA"). Módulo puro.
 * A avaliação com 30 conversas reais (17/10) mostrou erros que a instrução sozinha não segura:
 * - artigo antes do nome de profissional ("a Thaise", "com a Maiara", "do Gilvan") e "Método Fiaes" sem "®";
 * - promessa de retorno com prazo ("já te retorno", "em instantes te respondo");
 * - duas perguntas no fim;
 * - às vezes, texto embaralhado (o chamador pede de novo uma vez: `pareceIlegivel`).
 * Cada regra só mexe no trecho que casa; o resto do texto fica igual.
 */

import type { ProposedSlot } from "@/lib/proposed-slot";
import { hourLabel, hourMentions, mentionsTime, parseWindow, PERIOD_RANGE, proFirstName } from "./horarios";

const L = "\\p{L}\\p{N}";
/** Primeira letra no mesmo caso da original ("Da" → "De", "da" → "de"). */
const sameCase = (orig: string, word: string) => (orig[0] === orig[0].toLocaleUpperCase("pt-BR") ? word[0].toLocaleUpperCase("pt-BR") + word.slice(1) : word);

/* ---------- Nome de profissional sem artigo e "Método Fiaes®" ---------- */

/** Palavras que nunca entram como nome (evita "a Casa" → "Casa"). */
const NAO_NOME = new Set(["casa", "fiaes", "equipe", "recepcao", "recepção", "gerente", "gestao", "gestão", "admin", "teste", "sistema", "salao", "salão", "profissional"]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Os primeiros nomes que levam a regra (das profissionais ativas e da equipe, src/server/ai/suggest.ts → `CasaData.nomes`), mais Thaise
 * sempre. Só palavra com letra maiúscula no começo é nome ("a Cati"), então "a cati" minúsculo não muda.
 */
function nomesRe(nomes: string[]): string {
  const ok = [...new Set(nomes.map((n) => n.trim().split(/\s+/)[0] ?? "").filter((n) => /^\p{L}{3,}$/u.test(n) && !NAO_NOME.has(n.toLocaleLowerCase("pt-BR")))
    .map((n) => n.charAt(0).toLocaleUpperCase("pt-BR") + n.slice(1).toLocaleLowerCase("pt-BR")))].filter((n) => !/^Tha[ií]se$/.test(n));
  return `(Tha[ií]se|${ok.map(escape).sort((a, b) => b.length - a.length).join("|") || "(?!)"})`;
}
/** Preposição + artigo → só a preposição (ordem importa: as contrações antes do artigo sozinho). `null` = mantém a preposição escrita. */
const ARTIGOS: [string, string | null][] = [
  ["[Cc]om (?:a|o)", "com"],
  ["[Dd](?:a|o)", "de"],
  ["[Nn](?:a|o)", "em"],
  ["[Pp]el(?:a|o)", "por"],
  ["(?:[Pp]ara|[Pp]ra) (?:a|o)", null],
  ["[AaOo]", ""],
  // Por último: "à Thaise" vira "a Thaise" (preposição), que não pode cair na regra do artigo sozinho.
  ["[Àà]|[Aa]o", "a"],
];

/**
 * Nunca artigo antes do nome de profissional ou da equipe (pedido do dono): "com a Maiara" → "com Maiara", "da Cati" → "de Cati",
 * "pela Fabiana" → "por Fabiana", "na Thaise" → "em Thaise", "o Jackson" → "Jackson", "do Gilvan" → "de Gilvan", "à/ao" → "a".
 * Maiúscula do início de frase fica ("Da Thaise" → "De Thaise", "A Thaise" → "Thaise").
 */
export function semArtigoNosNomes(t: string, nomes: string[] = []): string {
  const N = nomesRe(nomes);
  let out = t;
  for (const [prep, troca] of ARTIGOS) {
    out = out.replace(new RegExp(`(?<![${L}])(${prep})\\s+${N}(?![${L}])`, "gu"), (_m, art: string, nome: string) => {
      if (troca === null) return `${art.split(" ")[0]} ${nome}`;
      if (troca === "") return nome;
      return `${sameCase(art, troca)} ${nome}`;
    });
  }
  return out;
}
/** Só Thaise (compatível com a v3). */
export const semArtigoNaThaise = (t: string) => semArtigoNosNomes(t);

/** "Método Fiaes" sempre com "®", sem duplicar ("Metodo fiaes" → "Método Fiaes®"; "Método Fiaes ®" → "Método Fiaes®"). */
export function metodoComMarca(t: string): string {
  return t.replace(new RegExp(`(?<![${L}])(m[ée]todo)\\s+fiaes(?![${L}])(\\s*(?:®|\\(r\\)))?`, "giu"), (_m, metodo: string) => `${sameCase(metodo, "método")} Fiaes®`);
}

/* ---------- Promessa de retorno com prazo ---------- */

/** Prazos ditos à cliente ("já", "em instantes", "ainda hoje"…). */
const PRAZO = "(?:j[aá](?:\\s+j[aá])?|logo(?:\\s+mais)?|rapidinho|ainda\\s+hoje|hoje\\s+ainda|até\\s+amanh[aã]|em\\s+(?:instantes|breve|seguida|poucos\\s+minutos|alguns\\s+minutos|\\d+\\s*min(?:utos)?))";
/** Verbos de "volto a falar com você". */
const RETORNO = "(?:retorno|retornar|respondo|dou\\s+(?:um\\s+)?retorno|trago\\s+(?:a\\s+)?resposta)";
const AVISO = "(?:aviso|falo|digo|confirmo|chamo)";
/** Começo e fim de palavra (o \\b do JavaScript não entende acento). */
const B = "(?<![\\p{L}])", E = "(?![\\p{L}])";
/**
 * Os padrões de promessa (testados em pos.test.ts). Casam só o pedaço da promessa (com o prazo junto), nunca a frase inteira:
 * - "te retorno", "te respondo", "te dou um retorno" (com ou sem prazo: é sempre promessa de voltar);
 * - "te aviso/falo/confirmo…" só com prazo ("já te aviso", "te confirmo ainda hoje"); "já te mando a localização" NÃO é promessa;
 * - "te passo as opções / a próxima data disponível / os horários disponíveis" (voltar com a resposta);
 * - "retorno/volto/respondo" com prazo e sem "te" ("retorno em instantes", "volto já"), nunca "o retorno já está incluso";
 * - "ela vai te retornar", "a gente te retorna";
 * - "Assim que eu tiver as opções, te envio por aqui" (a frase inteira é a promessa).
 */
export const PROMESSAS: RegExp[] = [
  new RegExp(`${B}(?:(?:eu|a gente)\\s+)?(?:${PRAZO}\\s+)?(?:te|lhe)\\s+${RETORNO}(?:\\s+${PRAZO})?${E}`, "iu"),
  new RegExp(`${B}(?:(?:eu|a gente)\\s+)?${PRAZO}\\s+(?:te|lhe)\\s+${AVISO}${E}`, "iu"),
  new RegExp(`${B}(?:(?:eu|a gente)\\s+)?(?:te|lhe)\\s+${AVISO}\\s+${PRAZO}${E}`, "iu"),
  new RegExp(`${B}(?:(?:eu|a gente)\\s+)?(?:${PRAZO}\\s+)?(?:te|lhe)\\s+(?:passo|mando|envio|trago)\\s+(?:as?|os?)\\s+(?:op[cç][oõ]es|hor[aá]rios?\\s+(?:livres|dispon[ií]veis)|datas?\\s+dispon[ií]ve(?:l|is)|pr[oó]xim[ao]s?\\s+(?:datas?|hor[aá]rios?)(?:\\s+dispon[ií]ve(?:l|is))?)${E}`, "iu"),
  new RegExp(`${B}(?<!(?:o|um|seu|sua|do|no|de|da|meu|ao)\\s)(?:(?:eu|a gente)\\s+)?(?:${PRAZO}\\s+)?(?:retorno|volto|respondo)\\s+(?:com\\s+voc[eê]\\s+|para\\s+voc[eê]\\s+|pra\\s+voc[eê]\\s+)?${PRAZO}${E}`, "iu"),
  new RegExp(`${B}(?:${PRAZO}\\s+)?(?:ela|ele|a\\s+gente|a\\s+equipe|n[oó]s)\\s+(?:(?:vai|vamos|v[aã]o|j[aá])\\s+)?(?:te|lhe)\\s+(?:retornar|retorna|responder|responde)(?:\\s+${PRAZO})?${E}`, "iu"),
  new RegExp(`${B}(?:assim que|logo que|tão logo)\\s+(?:(?:eu|a gente)\\s+)?(?:tiver|tivermos|souber|conferir|confirmar|verificar|ver|receber|falar)[^.!?;]{0,60}?,\\s*(?:(?:eu|a gente)\\s+)?(?:te|lhe)\\s+(?:envio|passo|mando|aviso|falo|digo|confirmo|chamo|retorno|respondo)${E}`, "iu"),
];
const SEM_PROMESSA = "vou ver isso para você";
/** A frase já diz o que vai fazer ("vou verificar", "vou conferir com a equipe"). */
const DIZ_O_QUE_FAZ = /(?<![\p{L}])(?:(?:vou|vamos|irei)\s+\p{L}{2,}|(?:estou|estamos)\s+\p{L}+ndo)/iu;

const SUBORDINADA = /^\s*(?:assim que|quando|logo que|depois que|tão logo|após|apos|se)(?![\p{L}])/iu;
/** Uma frase: "… vou verificar e já te retorno com as opções." → "… vou verificar."; "Já te retorno!" → "Vou ver isso para você!". */
function semPromessaNaFrase(s: string): string {
  let out = s;
  for (let guard = 0; guard < 4; guard++) {
    const m = PROMESSAS.map((re) => re.exec(out)).filter((x): x is RegExpExecArray => !!x).sort((a, b) => a.index - b.index)[0];
    if (!m) break;
    // O pedaço da promessa vai até o fim da oração (vírgula, ponto, ponto e vírgula) ou da frase.
    const after = out.slice(m.index + m[0].length);
    const stop = after.search(/[,;.!?…]|\s+[-–—]\s|\s*\p{Extended_Pictographic}/u);
    // Sem pontuação até o fim: fica só o emoji/espaço do final ("… e já te passo os horários 💛" → "… 💛").
    const tail = stop < 0 ? after.match(/[\s\p{Extended_Pictographic}\uFE0F\u200D]*$/u)?.[0] ?? "" : after.slice(stop);
    // O que vem antes, sem o "e"/"," que ligava a promessa.
    const lead = out.match(/^\s*/u)?.[0] ?? "";
    let head = out.slice(0, m.index).replace(/(?:\s*,)?\s*(?:\be|então|aí|e\s+a[ií])\s*$/iu, "").replace(/[\s,]+$/u, "");
    // Nada antes, ou só "assim que eu tiver a resposta": a frase vira "Vou ver isso para você".
    if (!head.trim() || SUBORDINADA.test(head)) head = `${lead}${SEM_PROMESSA[0].toLocaleUpperCase("pt-BR")}${SEM_PROMESSA.slice(1)}`;
    else if (!DIZ_O_QUE_FAZ.test(head)) head = `${head}, ${SEM_PROMESSA}`;
    out = `${head}${tail}`;
  }
  return out;
}

const SO_TROCA = new RegExp(`^\\s*${SEM_PROMESSA[0].toLocaleUpperCase("pt-BR")}${SEM_PROMESSA.slice(1)}([.!…]?)([\\s\\p{Extended_Pictographic}\\uFE0F\\u200D]*)$`, "u");

/**
 * Tira toda promessa de retorno com prazo; o texto que não casa com nenhum padrão volta igual. A frase que virou só "Vou ver isso para você"
 * sai quando uma frase anterior já diz o que a Casa vai fazer ("Vou verificar a agenda. Assim que eu tiver, te aviso 💛" → "Vou verificar a agenda. 💛").
 */
export function semPromessaDeRetorno(t: string): string {
  if (!PROMESSAS.some((re) => re.test(t))) return t;
  const out: string[] = [];
  for (const f of frases(t)) {
    if (!PROMESSAS.some((re) => re.test(f))) { out.push(f); continue; }
    const g = semPromessaNaFrase(f);
    const so = SO_TROCA.exec(g);
    if (so && DIZ_O_QUE_FAZ.test(out.join(""))) { if (so[2].trim()) out.push(` ${so[2].trim()}`); continue; }
    out.push(g);
  }
  return out.join("");
}

/* ---------- "Vou verificar" ---------- */

/** Adiar a resposta: "vou verificar", "vamos conferir", "deixa eu ver", "vou dar uma olhada", "vou falar com…", "já te retorno". */
const VERIFICAR = new RegExp(`${B}(?:vou|vamos|irei|iremos|deixa\\s+eu|deixe\\s+eu|deixa-me|deixe-me|preciso|vou\\s+precisar|vou\\s+s[oó])\\s+(?:dar\\s+uma\\s+olhada|verificar|conferir|checar|consultar|olhar|ver|perguntar|falar\\s+com)${E}`, "iu");
/**
 * A frase adia a resposta ("vou verificar" e equivalentes)? Os 3 padrões da avaliação real de 17/10: "…então vou verificar e te aviso",
 * "Vou verificar a agenda das 12h de hoje com a equipe", "Vou verificar com Gilvan se consigo…". Com horários livres na mão, é proibido.
 */
export function vaiVerificar(t: string): boolean {
  return VERIFICAR.test(t) || /(?<![\p{L}])(?:j[aá]\s+te|te|j[aá])\s+retorno(?![\p{L}])/iu.test(t);
}

/* ---------- Uma pergunta só ---------- */

/** Quebra em frases, guardando o espaço/quebra de linha do começo de cada uma (juntar devolve o texto). */
export function frases(t: string): string[] {
  return t.split(/(?<=[.!?…])(?=\s)|(?<=\n)/u).filter((x) => x.length);
}
const isQuestion = (f: string) => /\?[\s\p{Extended_Pictographic}️‍)"'”]*$/u.test(f);
/** "Tudo bem?" do cumprimento é o jeito da Casa, não pergunta de conduzir: fica. */
const CUMPRIMENTO = /^(?:(?:oi+|ol[aá]|bom dia|boa tarde|boa noite)[^?]{0,25}[,!.]?\s*)?(?:tudo bem|tudo bom|tudo certo|tudo certinho|tudo tranquilo|como vai|como voc[eê] est[aá]|como est[aá])(?:\s+(?:com voc[eê]|contigo))?[^?]{0,20}\?/iu;

/**
 * No máximo UMA pergunta: com 2 ou mais frases que terminam em "?", fica só a última; as anteriores saem (o "Tudo bem?" do cumprimento fica).
 * O mais simples e seguro: tirar a pergunta anterior em vez de reescrever (reescrever pode mudar o sentido).
 */
export function umaPerguntaSo(t: string): string {
  const parts = frases(t);
  const qs = parts.map((f, i) => ({ f, i })).filter(({ f }) => isQuestion(f) && !CUMPRIMENTO.test(f.trim()));
  if (qs.length < 2) return t;
  const drop = new Set(qs.slice(0, -1).map((q) => q.i));
  const kept = parts.filter((_, i) => !drop.has(i));
  // A primeira frase que ficou não começa com espaço solto; quebras de linha duplas viram uma linha em branco só.
  return kept.join("").replace(/^[ \t]+/, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
}

/* ---------- Horário concreto garantido (pedido do dono, 17/10) ---------- */

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const minDe = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const nomeRe = (nome: string) => new RegExp(`(?<![\\p{L}])${escape(nome)}(?![\\p{L}])`, "iu");

/** "com Gilvan"; Thaise é sempre "com nossa Diretora Técnica, Thaise Fiaes" (regra do dono). */
const comQuem = (name: string | null) => {
  if (!name) return "";
  const n = proFirstName(name);
  return /^tha[ií]se$/i.test(n) ? " com nossa Diretora Técnica, Thaise Fiaes" : ` com ${n}`;
};

/** A proposta no padrão da Casa: "Tenho terça, 21/10, às 15h com Gilvan. Posso reservar pra você?" (sem emoji, sem prazo, uma pergunta). */
export function propostaTexto(s: ProposedSlot, fora?: string | null): string {
  const dia = `${DIAS[new Date(`${s.day}T12:00:00Z`).getUTCDay()]}, ${s.day.slice(8, 10)}/${s.day.slice(5, 7)}`;
  const quando = `${dia}, às ${hourLabel(minDe(s.time))}${comQuem(s.professionalName)}`;
  return fora ? `Para ${fora} não tenho horário livre; o mais próximo é ${quando}. Posso reservar pra você?` : `Tenho ${quando}. Posso reservar pra você?`;
}

/**
 * O primeiro horário compatível: das opções (já só do serviço, da regra "só com" e sem assistente), vai estreitando pela profissional
 * citada (pela cliente; senão no texto da IA), pelo dia e período pedidos e pela hora pedida; cada filtro só vale se sobrar alguma.
 */
export function escolherOpcao(opcoes: ProposedSlot[], textosCliente: string[], hoje: string, textoIa = ""): ProposedSlot | null {
  let c = opcoes;
  const narrow = (f: (o: ProposedSlot) => boolean) => { const n = c.filter(f); if (n.length) c = n; };
  const cliente = textosCliente.join("\n");
  const citada = (t: string) => (o: ProposedSlot) => !!o.professionalName && nomeRe(proFirstName(o.professionalName)).test(t);
  if (c.some(citada(cliente))) narrow(citada(cliente)); else narrow(citada(textoIa));
  const w = parseWindow(textosCliente, hoje);
  if (w?.days.length) narrow((o) => w.days.includes(o.day));
  if (w?.period) { const [a, b] = PERIOD_RANGE[w.period]; narrow((o) => minDe(o.time) >= a && minDe(o.time) < b); }
  const horas = new Set(textosCliente.flatMap((t) => hourMentions(t).map((h) => h.start)));
  if (horas.size) narrow((o) => horas.has(minDe(o.time)));
  return c[0] ?? null;
}

/** Pergunta de agenda (dia, período, horário): a proposta concreta responde melhor. */
const PERGUNTA_AGENDA = /(?<![\p{L}])(?:dia|dias|data|hor[aá]rio|hor[aá]rios|per[ií]odo|manh[aã]|tarde|noite|agenda|marcar|agendar|reservar|semana|quando)(?![\p{L}])/iu;
/** Frases que uma proposta de horário logo depois contradiria. */
const CONTRADIZ = /(?<![\p{L}])(?:n[aã]o\s+(?:consigo|tenho|temos|h[aá])(?![\p{L}])[^.!?]{0,40}hor[aá]rio|agenda[^.!?]{0,30}(?:fechada|cheia|lotada)|vou\s+(?:encaminhar|passar)(?![\p{L}]))/iu;
const OFERTA = /(?<![\p{L}])(?:tenho|temos|consigo|conseguimos|posso\s+(?:te\s+)?(?:encaixar|oferecer)|encaix\p{L}*)(?![\p{L}])/iu;
const FAIXA = /(?<![\p{L}])das\s+\d{1,2}h.*(?<![\p{L}])[aà]s\s+\d{1,2}h/iu;

export type GarantiaInput = {
  /** As opções da linha "Horários livres" (h1…h8). */
  opcoes: ProposedSlot[];
  /** A cliente pediu horário de verdade (horarios.ts → `pediuHorario`) ou o combinado não vale mais (ocupado/regra). */
  pediu: boolean;
  /** As mensagens da cliente que esperam resposta. */
  textosCliente: string[];
  /** Hoje em Salvador (AAAA-MM-DD). */
  hoje: string;
  /** A janela pedida sem nada livre ("sáb 17/10 à tarde"): a proposta diz isso e oferece o mais próximo. */
  fora?: string | null;
  /** Nomes de cadastro das assistentes (`professionals.assistant_of`): frase que cita alguma sai. */
  assistentes?: string[];
};

/**
 * Garante o horário concreto (avaliação real de 17/10: 3 "vou verificar" com horários livres na mão). Com pedido e opções:
 * - as frases de "vou verificar" (e as que citam assistente) saem;
 * - se não sobrar hora nenhuma no texto, as outras perguntas saem (o "Tudo bem?" do cumprimento fica) e entra, no fim, a proposta do
 *   primeiro horário compatível, que vira o `horario` da sugestão (o botão "Marcar este horário");
 * - se a IA já citou uma hora (mesmo fora da lista, como uma confirmação), o texto fica (só a frase de adiar sai).
 * Troca determinística, sem segunda chamada: custo zero e sempre cumpre.
 */
export function garantirHorario(t: string, i: GarantiaInput): { texto: string; horario: ProposedSlot | null; trocou: boolean } {
  const igual = { texto: t, horario: null, trocou: false };
  if (!i.pediu || !i.opcoes.length) return igual;
  const assist = [...new Set((i.assistentes ?? []).map(proFirstName).filter((n) => n.length >= 3))];
  // Hora inventada: oferecida sem ser de uma opção da lista nem pedida pela cliente (a confirmação do que ela disse fica). Faixa "das 9h às 18h" não conta.
  const validas = new Set([...i.opcoes.map((o) => minDe(o.time)), ...i.textosCliente.flatMap((c) => hourMentions(c).map((h) => h.start))]);
  // Só a hora OFERECIDA ("tenho", "consigo te encaixar") conta; informação com hora ("seu horário é às 10h", "dura 4h") fica.
  const inventada = (f: string) => { const hs = hourMentions(f); return hs.length > 0 && OFERTA.test(f) && !FAIXA.test(f) && !hs.some((h) => validas.has(h.start)); };
  const ruim = (f: string) => vaiVerificar(f) || assist.some((n) => nomeRe(n).test(f)) || inventada(f);
  const parts = frases(t);
  const resto = parts.filter((f) => !ruim(f));
  // O que FICA já diz que não há horário ou passa para a equipe ("não consigo confirmar agora", "vou encaminhar para a equipe"):
  // acrescentar "Tenho … Posso reservar?" contradiz a própria mensagem (avaliação de coerência, 20/10). Fica como está.
  if (!mentionsTime(t) && CONTRADIZ.test(resto.join(""))) return igual;
  if (resto.length === parts.length && mentionsTime(t)) return igual;
  if (mentionsTime(resto.join(""))) return { texto: resto.join("").trim(), horario: null, trocou: true };
  // A IA não adiou e conduz outro passo com uma pergunta que não é de agenda ("me envia as fotos?"): a pergunta dela fica (20/10).
  const adiou = resto.length < parts.length;
  if (!adiou && parts.some((f) => isQuestion(f) && !CUMPRIMENTO.test(f.trim())) && !parts.some((f) => isQuestion(f) && PERGUNTA_AGENDA.test(f))) return igual;
  const opcao = escolherOpcao(i.opcoes, i.textosCliente, i.hoje, t);
  if (!opcao) return igual;
  // Ela pediu dia(s) e nenhuma opção cai neles, sem a linha dizer "nenhum livre <no período>": oferecer outro dia contradiz o pedido dela.
  // Se a IA adiou ou inventou hora (a frase saiu), a proposta entra dizendo com carinho que naquele dia não há horário.
  const w = parseWindow(i.textosCliente, i.hoje);
  const foraDoPedido = !!w?.days.length && !w.days.includes(opcao.day) && !i.fora;
  if (foraDoPedido && !adiou) return igual;
  const fora = i.fora ?? (foraDoPedido ? w!.label : null);
  const fica = resto.filter((f) => !isQuestion(f) || CUMPRIMENTO.test(f.trim())).join("").trim();
  return { texto: `${fica ? `${fica} ` : ""}${propostaTexto(opcao, fora)}`, horario: opcao, trocou: true };
}

/* ---------- Sem cumprimento no meio da conversa ---------- */

/** "Oii, Fulana! Tudo bem?", "Bom dia, querida!", "Olá! Tudo certinho?" no começo da mensagem. */
const SAUDACAO = new RegExp(String.raw`^\s*(?:(?:[Oo]i+e?|[Oo]l[aá]|[Bb]om dia|[Bb]oa tarde|[Bb]oa noite)(?:\s*,?\s*(?:querida|minha flor|amore|meu bem|minha linda|(?!Tudo\b)\p{Lu}\p{Ll}+))?\s*[!,.]*\s*`
  + String.raw`(?:[Tt]udo (?:bem|bom|certo|certinho)(?:\s+(?:com voc[eê]|contigo))?\s*[?!.]*\s*\p{Extended_Pictographic}?\s*)?)`, "u");
/**
 * Tira o cumprimento do começo (a conversa está em andamento: a IA cumprimentava de novo no meio, avaliação de coerência 20/10).
 * Só o começo; o resto fica igual. Se sobrar quase nada (a mensagem era só o cumprimento), volta o texto original.
 */
export function semCumprimento(t: string): string {
  const m = SAUDACAO.exec(t);
  if (!m || !m[0].trim()) return t;
  const rest = t.slice(m[0].length).trim();
  if (rest.length < 12) return t;
  return rest.charAt(0).toLocaleUpperCase("pt-BR") + rest.slice(1);
}

/* ---------- Texto embaralhado ---------- */

const VOGAL = /[aeiouyáéíóúâêôãõàü]/i;
const PT = new Set("a o e é de da do das dos que para pra com um uma você voce te seu sua no na nos nas em por mais muito bem tudo oi oii olá ola sim não nao já ja vou se ela ele isso esse essa como ou quer pode posso aqui hoje amanhã horário horario fico que bom".split(" "));
const EN = new Set("the and you your to of is are for with we i it this that be have will can our please thanks thank hello hi".split(" "));

/**
 * O texto parece embaralhado? (heurística, testada): JSON no lugar da mensagem, caractere de erro, letra repetida sem fim,
 * a mesma palavra várias vezes seguidas, muitas palavras sem vogal, outra escrita (não latina) ou outro idioma (inglês).
 */
export function pareceIlegivel(t: string): boolean {
  const s = t.trim();
  if (!s) return false; // vazio é outro caso (descartado na gravação)
  if (/^[[{]/.test(s) || /"(?:sugestao|resumo|precisa_humano|motivo|horario)"\s*:/.test(s)) return true;
  if ((s.match(/�/g) ?? []).length >= 2) return true;
  // Acento quebrado (UTF-8 lido como outra tabela: "Ă s", "vocĂŞ", "đź’›", "Ã©") e texto sem acento nenhum ("avaliacao e com Thaise, que esta fora"):
  // o Sonnet 5.5 devolveu assim 3 de 160 vezes na avaliação de 20/10. Pede de novo.
  // "Ă", "đ" e "â€" não existem em português; "Ã" só em palavra maiúscula ("NÃO").
  if (/Ă|đ|â€|Ã(?![A-ZÀ-Ý])/u.test(s)) return true;
  if ((s.toLocaleLowerCase("pt-BR").match(/(?<![\p{L}])(?:voce|nao|entao|avaliacao|horario|manutencao|esta|sera|ate|ja|amanha|metodo)(?![\p{L}])/gu) ?? []).length >= 2
    && !/[áéíóúâêôãõç]/i.test(s)) return true;
  if (/([^\s\p{Extended_Pictographic}])\1{9,}/u.test(s)) return true;
  if (/(?<![\p{L}])(\p{L}{2,})(?:\s+\1(?![\p{L}])){3,}/iu.test(s)) return true;
  const letters = s.match(/\p{L}/gu) ?? [];
  const latin = s.match(/[A-Za-zÀ-ÿ]/g) ?? [];
  if (letters.length >= 10 && latin.length / letters.length < 0.8) return true;
  const words = (s.toLocaleLowerCase("pt-BR").match(/\p{L}+/gu) ?? []);
  if (words.length >= 4) {
    const semVogal = words.filter((w) => w.length >= 4 && !VOGAL.test(w) && !/^k+$/.test(w)).length;
    if (semVogal / words.length > 0.25) return true;
  }
  if (words.length >= 8) {
    const pt = words.filter((w) => PT.has(w)).length / words.length;
    const en = words.filter((w) => EN.has(w)).length / words.length;
    if (pt < 0.08 && en > 0.15) return true;
  }
  return false;
}

/* ---------- Mensagem de robô / propaganda de empresa ---------- */

const plainTxt = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Sinais de mensagem automática de empresa (cobrança, protocolo, propaganda), com o peso. Teste em pos.test.ts. */
const ROBO: [RegExp, number][] = [
  [/linha digitavel|codigo de barras|mensagem automatica|nao responda (a )?esta|faturas? em aberto|segunda via/, 2],
  [/\bboleto\b/, 1], [/\bprotocolo\b/, 1], [/\bfaturas?\b/, 1], [/\bcompensacao\b/, 1], [/\bdias uteis\b/, 1], [/\baguarde um momento\b/, 1],
  [/\b[a-z]+ agradece\b/, 1], [/\bdigite\b|\bopcao \d\b|\bresponda com\b/, 1], [/\bcobranca\b|\bvencimento\b|\bpagamento\b/, 1],
  [/https?:\/\/\S+/, 1], [/\bassistente virtual\b|\batendimento (virtual|automatico)\b|\bsac\b/, 1],
  [/\boferta\b|\bpromocao\b|\bdesconto exclusivo\b/, 1], [/\bclique (aqui|no link)\b|\bdescadastr|\bsair da lista\b/, 2],
];
/**
 * A última leva de mensagens "da cliente" parece robô ou propaganda de empresa (caso 1 da avaliação de 17/10: cobrança da Claro)?
 * Soma os sinais; precisa de 3 ou mais (cliente de verdade que fala de boleto ou protocolo, sozinho, não conta).
 */
export function pareceRobo(texts: (string | null | undefined)[]): boolean {
  const t = plainTxt(texts.filter(Boolean).join("\n"));
  return ROBO.reduce((n, [re, w]) => n + (re.test(t) ? w : 0), 0) >= 3;
}

/* ---------- Material indicado pela IA (24/10, o vídeo do Método Fiaes) ---------- */

// Tolerante de propósito: colchete simples, sem fechar (resposta cortada) ou atalho com espaço também saem. A marca NUNCA pode chegar à cliente.
const MATERIAL_RE = /[ \t]*\[\[?\s*material\s*:\s*\/?\s*([^\]\n]*?)\s*(?:\]\]?|(?=\n|$))[ \t]*/giu;
/**
 * Tira a marca `[[material:/atalho]]` do texto (a IA põe numa linha separada; em qualquer lugar ela sai) e devolve o atalho em minúsculas
 * (espaço vira hífen, como no atalho da resposta pronta). Mais de uma marca: vale a primeira, todas saem. Quem confere se o atalho existe,
 * está ativo e é universal com foto/vídeo e "A IA indica quando…" é o servidor (suggest.ts); marca inválida é só ignorada.
 * Roda ANTES do resto do acabamento (a marca não pode virar "texto embaralhado").
 */
export function separarMaterial(t: string): { texto: string; material: string | null } {
  let material: string | null = null, achou = false;
  const out = t.replace(MATERIAL_RE, (_m, a: string) => {
    achou = true;
    const atalho = a.trim().replace(/\s+/g, "-").toLocaleLowerCase("pt-BR");
    if (atalho) material ??= atalho;
    return " ";
  });
  if (!achou) return { texto: t, material: null };
  return { texto: out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), material };
}

/* ---------- Tudo junto ---------- */

/**
 * Tom maduro (20/10, o dono: "juvenil"): mesmo com a regra no bloco fixo, o Sonnet espelha o tom da conversa ("Oii", "Kkkk", "amore", 🤭).
 * "Oii"/"Oiee" → "Oi", "Simmm" → "Sim", "Kkkk," no começo sai, "amore"/"amor" de chamamento → "querida", 🤭 e 😅 saem. O resto fica como está.
 */
export function semJuvenil(t: string): string {
  return t
    .replace(/(^|[^\p{L}])([Oo])i{2,}e*(?![\p{L}])/gu, "$1$2i")
    .replace(/(^|[^\p{L}])([Ss])i+m{2,}(?![\p{L}])/gu, "$1$2im")
    .replace(/(^|[.!?]\s+)[Kk]{2,}[,!.]?\s*(\p{L})/gu, (_m, a: string, l: string) => `${a}${l.toLocaleUpperCase("pt-BR")}`)
    .replace(/,\s*amore?(?=[!,.?\s]|$)/giu, ", querida")
    .replace(/(^|[^\p{L}])amore(?![\p{L}])/giu, "$1querida")
    .replace(/\s*[🤭😅]+/gu, "");
}

/** O que a atendente vê: nome sem artigo, Método com ®, sem promessa de retorno, uma pergunta só e sem o jeito juvenil. */
/**
 * "Antes de falarmos do valor, me conta…" numa mensagem que JÁ deu o valor (20/10, print do dono: "O investimento é de R$ 7.000,00… Antes de
 * falarmos do valor, me conta: você já trabalha com alongamento?"). Com "R$" na mensagem, a abertura sai e a pergunta continua.
 */
const ANTES_DO_VALOR = /\b[Aa]ntes de (?:falarmos|falar|conversarmos|conversar|entrarmos|entrar|irmos|ir)(?: mais)? (?:do|de|no|sobre o|sobre os|nos|dos) (?:valor(?:es)?|investimentos?|pre[çc]os?|or[çc]amentos?)(?: [^,.:;!?]{0,40})?[,:]\s*/g;
export function semAntesDoValor(t: string): string {
  if (!/R\$\s?\d/.test(t)) return t;
  return t.replace(ANTES_DO_VALOR, "").replace(/(^|[.!?]\s+)([a-zà-ú])/g, (_m, a: string, b: string) => a + b.toLocaleUpperCase("pt-BR"));
}

/**
 * Escape de JSON que veio literal no texto ("manuten\\u00e7\\u00e3o", "\\ud83d\\udc9b"; Sonnet 5.5, 2 de 160 na avaliação de 20/10): vira o caractere.
 * Escape cortado no fim ("\\u00") sai.
 */
export function semEscapes(t: string): string {
  if (!t.includes("\\u")) return t;
  return t.replace(/(?:\\u[0-9a-fA-F]{4})+/g, (m) => String.fromCharCode(...m.split("\\u").filter(Boolean).map((h) => parseInt(h, 16))))
    .replace(/\\u[0-9a-fA-F]{0,3}$/, "").replace(/\\n/g, "\n");
}

export function posProcessar(t: string, nomes: string[] = []): string {
  const out = umaPerguntaSo(semPromessaDeRetorno(metodoComMarca(semAntesDoValor(semJuvenil(semArtigoNosNomes(semEscapes(t), nomes))))));
  return out === t ? t : out.replace(/ {2,}/g, " ").replace(/ +([,.!?])/g, "$1").trim();
}
