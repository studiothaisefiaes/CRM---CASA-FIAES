/** Liga/desliga, limites e texto do recibo da Fase A (chave `caixa_recursos`). Padrão = tudo ligado: nada disto manda mensagem à cliente. */
export type RecursoKey = "assistentes" | "taxaCartao" | "comissaoComDescontos" | "divida" | "vales" | "valePelaSangria" | "pagarComissao" | "excecoes";
export const RECURSO_KEYS: RecursoKey[] = ["assistentes", "taxaCartao", "comissaoComDescontos", "divida", "vales", "valePelaSangria", "pagarComissao", "excecoes"];

export const RECURSO_LABEL: Record<RecursoKey, string> = {
  assistentes: "Assistente na comanda",
  taxaCartao: "Taxa do cartão",
  comissaoComDescontos: "Comissão com taxa, antecipação e custo",
  divida: "Dívida da cliente",
  vales: "Vale, bônus e desconto na comissão",
  valePelaSangria: "Sangria vira vale",
  pagarComissao: "Pagar a comissão",
  excecoes: "Página de Exceções",
};

/** O que acontece quando está desligado. */
export const RECURSO_HELP: Record<RecursoKey, string> = {
  assistentes: "Desligado: a comanda não sugere nem aceita assistente, e a comissão ignora as assistentes.",
  taxaCartao: "Desligado: o pagamento novo entra sem taxa, e a comanda não mostra taxa nem líquido.",
  comissaoComDescontos: "Desligado: a comissão não desconta taxa do cartão, antecipação nem custo do serviço.",
  divida: "Desligado: não dá para deixar o que falta como dívida. Quitar uma dívida que já existe continua possível.",
  vales: "Desligado: não dá para lançar vale, bônus nem desconto na comissão. Os já lançados continuam no A pagar.",
  valePelaSangria: "Desligado: a sangria não vira vale e a pergunta some da sangria.",
  pagarComissao: "Desligado: não dá para pagar a comissão. Desfazer um pagamento e ver o recibo continuam.",
  excecoes: "Desligado: a página de Exceções fecha e o Financeiro não mostra \"Ver todas\".",
};

export const RECIBO_TEXTO_SUGERIDO = "Recebi da Casa Fiaes {total} de comissão de {periodo}, conforme o recibo nº {numero}. {profissional}";
export const RECIBO_VARIAVEIS = ["profissional", "numero", "periodo", "total"];
export const RECIBO_TEXTO_MAX = 600;

/** Troca `{nome}` pelo valor; variável desconhecida fica como está. */
export function fillRecibo(texto: string, v: Record<string, string>): string {
  return texto.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(v, k) ? v[k] : m));
}

/**
 * `pagarComissaoDesde` ("AAAA-MM-DD"; vazio = sem corte): comandas e lançamentos antes desta data não entram no A pagar (o que já foi
 * pago fora do CRM não é pago de novo no primeiro recibo).
 */
export type CaixaRecursos = Record<RecursoKey, boolean> & { assistentesMax: number; valeSenhaTentativas: number; valeSenhaJanelaMin: number; reciboTexto: string; pagarComissaoDesde: string | null };

export const CAIXA_RECURSOS_PADRAO: CaixaRecursos = {
  assistentes: true, taxaCartao: true, comissaoComDescontos: true, divida: true, vales: true, valePelaSangria: true, pagarComissao: true, excecoes: true,
  assistentesMax: 20, valeSenhaTentativas: 5, valeSenhaJanelaMin: 10, reciboTexto: RECIBO_TEXTO_SUGERIDO, pagarComissaoDesde: null,
};

/** Data "AAAA-MM-DD" que existe no calendário. */
export const isIsoDay = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export const isIntBetween = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
/** Assistentes por serviço: de 1 a 20 (o teto da agenda). */
export const isAssistentesMax = (v: unknown): v is number => isIntBetween(v, 1, 20);

/** Lê o que estiver gravado; campo ausente ou inválido = padrão; texto vazio = o sugerido. */
export function readCaixaRecursos(v: unknown): CaixaRecursos {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const P = CAIXA_RECURSOS_PADRAO;
  const flags = Object.fromEntries(RECURSO_KEYS.map((k) => [k, typeof r[k] === "boolean" ? r[k] : P[k]])) as Record<RecursoKey, boolean>;
  const texto = typeof r.reciboTexto === "string" ? r.reciboTexto.trim() : "";
  return {
    ...flags,
    assistentesMax: isAssistentesMax(r.assistentesMax) ? r.assistentesMax : P.assistentesMax,
    valeSenhaTentativas: isIntBetween(r.valeSenhaTentativas, 1, 20) ? r.valeSenhaTentativas : P.valeSenhaTentativas,
    valeSenhaJanelaMin: isIntBetween(r.valeSenhaJanelaMin, 1, 120) ? r.valeSenhaJanelaMin : P.valeSenhaJanelaMin,
    reciboTexto: texto && texto.length <= RECIBO_TEXTO_MAX ? texto : P.reciboTexto,
    pagarComissaoDesde: isIsoDay(r.pagarComissaoDesde) ? r.pagarComissaoDesde : null,
  };
}

export const recursoOffMessage = (k: RecursoKey) => `${RECURSO_LABEL[k]} está desligado em Configurações › Caixa.`;
