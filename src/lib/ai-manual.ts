/**
 * Manual da Casa para a IA, no formato de uma skill (pedido do dono, 16/10): seções fixas e curtas, montadas num texto único no
 * bloco fixo (em cache) de toda sugestão. Não usa a API de Agent Skills (custa mais). A gestão edita cada seção em
 * Configurações › Conversas › Sugestão de resposta por IA › O que a IA sabe sobre a Casa. "Serviços e preços" não é escrita
 * aqui: vem da aba Serviços. Módulo puro (tela e servidor).
 */
export const MANUAL_SECTIONS = [
  { key: "casa", title: "A Casa e a equipe", hint: "Endereço, estacionamento, quem é quem (só o primeiro nome) e o que cada uma faz. Entra em “Quem você é”." },
  { key: "fala", title: "Como a Casa fala", hint: "Tom, saudações, emojis usados, frases típicas reais e o que nunca dizer." },
  { key: "regras", title: "Regras da Casa", hint: "Pagamento, sinal, atraso, falta, cancelamento, avaliação e quando passar para alguém da equipe." },
  { key: "pacotes", title: "Pacotes e Método Fiaes®", hint: "Como funciona o método, a manutenção, as sessões e os combos." },
  { key: "perguntas", title: "Perguntas frequentes", hint: "Uma por linha: pergunta → resposta modelo, como a equipe responde de verdade." },
  { key: "cenarios", title: "Cenários", hint: "Situações comuns e o que fazer em cada uma (ex.: cliente em transição, quer luzes, mora fora, já fez o Método)." },
  { key: "objecoes", title: "Objeções", hint: "O que a cliente diz quando hesita (\"tá caro\", \"vou pensar\", \"tenho medo de química\") e como a equipe responde." },
  { key: "exemplos", title: "Exemplos", hint: "De 5 a 8 pares Cliente → Resposta ideal, sem nome nem telefone de cliente." },
] as const;
export type ManualKey = (typeof MANUAL_SECTIONS)[number]["key"];
export type ManualSections = Record<ManualKey, string>;
export const MANUAL_KEYS = MANUAL_SECTIONS.map((s) => s.key) as ManualKey[];
export const emptyManual = (): ManualSections => Object.fromEntries(MANUAL_KEYS.map((k) => [k, ""])) as ManualSections;

/** Teto do manual inteiro (soma das seções): perto de 7.000 tokens (fica no cache), para cada sugestão continuar barata. */
export const AI_MANUAL_MAX = 24_000;
export const MISSING = "[a Casa precisa preencher]";
/** Português fica perto de 3,5 caracteres por token: só para mostrar o tamanho na tela. */
export const approxTokens = (text: string) => Math.round(text.length / 3.5);
export const manualLength = (m: Partial<ManualSections>) => MANUAL_KEYS.reduce((n, k) => n + (m[k]?.trim().length ?? 0), 0);
export const countMissing = (m: Partial<ManualSections>) => MANUAL_KEYS.reduce((n, k) => n + (m[k]?.split(MISSING).length ?? 1) - 1, 0);
