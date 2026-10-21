/** Variáveis das respostas prontas (e da mensagem em massa). Puro: servidor e navegador. {nome} é o nome antigo de {primeiro_nome}. */
export type ReplyVars = {
  primeiroNome: string | null; dataHorario: string | null; profissional: string | null;
  /** Serviço do horário marcado (ou do lead). */ servico?: string | null;
  /** Primeiro nome de quem está enviando. */ meuNome?: string | null;
};

/** Botões de variável ao escrever uma resposta pronta (na ordem em que aparecem). */
export const REPLY_VAR_HELP: { token: string; label: string; button: string }[] = [
  { token: "{primeiro_nome}", button: "Primeiro nome", label: "primeiro nome da cliente" },
  { token: "{saudacao}", button: "Saudação", label: "Bom dia, Boa tarde ou Boa noite (hora de Salvador)" },
  { token: "{data_horario}", button: "Data e horário", label: "dia e hora do próximo horário (ex.: qui 22/10 às 15:00)" },
  { token: "{profissional}", button: "Profissional", label: "quem faz o serviço no próximo horário" },
  { token: "{servico}", button: "Serviço", label: "o serviço do próximo horário" },
  { token: "{meu_nome}", button: "Meu nome", label: "o seu primeiro nome (de quem envia)" },
];
type Key = "nome" | "primeiro_nome" | "data_horario" | "profissional" | "saudacao" | "servico" | "meu_nome";
const LABEL: Record<Key, string> = { nome: "nome", primeiro_nome: "primeiro nome", data_horario: "data e horário", profissional: "profissional", saudacao: "saudação", servico: "serviço", meu_nome: "seu nome" };
const VAR = /\{(nome|primeiro_nome|data_horario|profissional|saudacao|servico|meu_nome)\}/g;
const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3 fixo

export function greetingAt(ms: number): string {
  const h = new Date(ms - OFFSET_MS).getUTCHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/**
 * Troca as variáveis pelo valor. Nome sem valor some sem deixar vírgula sobrando ("Oi, {primeiro_nome}!" → "Oi!").
 * Data/horário, profissional, serviço e meu nome sem valor FICAM no texto e voltam em `missing`: o campo pede o valor e não deixa enviar com elas.
 * Chave desconhecida ({preco}) fica como está. Quebras de linha são mantidas.
 */
export function renderReply(body: string | null | undefined, vars: ReplyVars, nowMs = Date.now()): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = (body ?? "").replace(VAR, (all, key: Key) => {
    if (key === "nome" || key === "primeiro_nome") return vars.primeiroNome?.trim() ?? "";
    if (key === "saudacao") return greetingAt(nowMs);
    const v = key === "data_horario" ? vars.dataHorario : key === "profissional" ? vars.profissional : key === "servico" ? vars.servico : vars.meuNome;
    if (v?.trim()) return v.trim();
    missing.add(LABEL[key]);
    return all;
  }).replace(/,\s*([!?.])/g, "$1").replace(/[ \t]{2,}/g, " ");
  return { text, missing: [...missing] };
}

/** Variáveis que ainda estão no texto na hora de enviar (a pessoa colou ou não trocou). */
export function missingVars(text: string): string[] {
  return pendingVars(text).map((p) => p.label);
}

/** As variáveis que ficaram no texto, uma vez cada: viram campos para preencher acima do campo da conversa. */
export function pendingVars(text: string): { key: string; label: string }[] {
  const seen = new Set<string>();
  return [...text.matchAll(VAR)].map((m) => m[1] as Key).filter((k) => (seen.has(k) ? false : (seen.add(k), true))).map((key) => ({ key, label: LABEL[key] }));
}

/** Troca todas as ocorrências de {key} pelo valor digitado. Valor vazio não troca nada. */
export function fillVar(text: string, key: string, value: string): string {
  const v = value.trim();
  return v ? text.split(`{${key}}`).join(v) : text;
}

/** Palavras que o atalho escreve sem acento (o atalho é digitado depois da barra). */
const ACCENT: Record<string, string> = {
  pos: "pós", pre: "pré", avaliacao: "avaliação", endereco: "endereço", aniversario: "aniversário", horario: "horário", horarios: "horários",
  confirmacao: "confirmação", localizacao: "localização", promocao: "promoção", servico: "serviço", servicos: "serviços", preco: "preço",
  precos: "preços", manutencao: "manutenção", informacoes: "informações", informacao: "informação", duvida: "dúvida", duvidas: "dúvidas",
  orcamento: "orçamento", remarcacao: "remarcação", protese: "prótese",
  apos: "após", nao: "não", voce: "você", sessao: "sessão", sessoes: "sessões",
};
/** Atalhos de duas palavras que são uma palavra composta (o hífen fica) ou que pedem uma preposição. */
const PHRASES: Record<string, string> = { "pos atendimento": "pós-atendimento", "boas vindas": "boas-vindas", "fotos cabelo": "fotos do cabelo" };

/**
 * Nome legível da resposta pronta (P12, 17/10): o cadastro guarda o atalho ("pos-atendimento"), que aparecia cru nos chips do Retomar.
 * Hífen e sublinhado viram espaço, as palavras ganham acento e a primeira letra vira maiúscula ("Pós-atendimento"). Nome que a equipe
 * já escreveu como nome (com espaço ou maiúscula) fica como está.
 */
export function replyTitle(label: string): string {
  const raw = label.trim();
  if (!raw || /\s/.test(raw) || /[A-ZÀ-Ú]/.test(raw)) return raw;
  const words = raw.toLowerCase().split(/[-_]+/).filter(Boolean);
  const plain = words.join(" ");
  const text = PHRASES[plain] ?? words.map((w) => ACCENT[w] ?? w).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
