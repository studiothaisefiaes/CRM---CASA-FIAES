import { can } from "./permissions";
/** Chaves do caixa (3.1): sem chave, o caixa é no Avec e o caixa aberto não é exigido (7.9: caixa só de vendas, por enquanto). */
export type CaixaMode = "avec" | "crm";
export const isCaixaMode = (v: unknown): v is CaixaMode => v === "avec" || v === "crm";
export const CAIXA_OFF = "O caixa ainda é no Avec.";
/**
 * Regras do caixa (chave `caixa_regras`). `exigeCaixaAberto` vale no receber (Plano 3). As do fechamento ficam em Caixa › Caixas da equipe:
 * tolerância da diferença (acima dela, a gestão aprova), contagem cega (quem não é gestão não vê o esperado) e a sangria que vai para a auditoria.
 */
export type CaixaRules = {
  exigeCaixaAberto: boolean; toleranciaCents: number; contagemCega: boolean; sangriaGrandeCents: number;
  /**
   * "Cortesia ou desconto acima de X% pede aprovação da gestão" (QA r58, I-11), em pontos-base (2000 = 20%). Null = desligado (o padrão:
   * decisão do dono, todos podem mudar preço, dar desconto e cortesia, sempre com motivo).
   */
  aprovacaoDescontoBp: number | null;
  /** Nota fiscal quando a recepção não escolhe ao receber: "perguntar" (o padrão: a recepção precisa escolher), "nao" ou "sem_cpf". */
  notaPadrao: NotaPadrao;
};
export type NotaPadrao = "perguntar" | "nao" | "sem_cpf";
export type NotaEscolha = "nao" | "sem_cpf" | "com_cpf";
export const NOTA_ESCOLHA_LABEL: Record<NotaEscolha, string> = { nao: "Não emitir", sem_cpf: "Emitir sem CPF", com_cpf: "Emitir com CPF" };
/** Quem gere o caixa sempre vê. Os outros ficam no escuro com a contagem cega ligada ou sem "Ver o dinheiro do caixa" (caixa.dinheiro). */
export const isBlindFor = (rules: CaixaRules, viewer: { perms: readonly string[] }) => !can(viewer.perms, "caixa.gerir") && (rules.contagemCega || !can(viewer.perms, "caixa.dinheiro"));
/** A contagem cega nasce ligada (QA r58, I-1): quem conta não vê o esperado; a migration 0059 liga onde ninguém escolheu. */
export const DEFAULT_CAIXA_RULES: CaixaRules = { exigeCaixaAberto: false, toleranciaCents: 500, contagemCega: true, sangriaGrandeCents: 20000, aprovacaoDescontoBp: null, notaPadrao: "perguntar" };
/** Limite válido: de 1% a 100% (100 a 10.000 pontos-base). */
export const isDiscountLimitBp = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 10000;

/** Lê o que estiver gravado, com o padrão no que faltar ou vier inválido. */
export function readCaixaRules(v: unknown): CaixaRules {
  const r = (v ?? {}) as Partial<Record<keyof CaixaRules, unknown>>;
  const cents = (x: unknown, d: number) => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : d);
  return {
    exigeCaixaAberto: typeof r.exigeCaixaAberto === "boolean" ? r.exigeCaixaAberto : DEFAULT_CAIXA_RULES.exigeCaixaAberto,
    toleranciaCents: cents(r.toleranciaCents, DEFAULT_CAIXA_RULES.toleranciaCents),
    contagemCega: typeof r.contagemCega === "boolean" ? r.contagemCega : DEFAULT_CAIXA_RULES.contagemCega,
    sangriaGrandeCents: cents(r.sangriaGrandeCents, DEFAULT_CAIXA_RULES.sangriaGrandeCents),
    aprovacaoDescontoBp: isDiscountLimitBp(r.aprovacaoDescontoBp) ? r.aprovacaoDescontoBp : null,
    notaPadrao: r.notaPadrao === "nao" || r.notaPadrao === "sem_cpf" || r.notaPadrao === "perguntar" ? r.notaPadrao : DEFAULT_CAIXA_RULES.notaPadrao,
  };
}
