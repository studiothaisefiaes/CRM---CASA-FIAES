/** Configurações › Financeiro (chave `financeiro_config`): liga/desliga e os números de regra de Contas a pagar e do Resultado. */
export type FinanceiroConfig = { contasAPagar: boolean; resultado: boolean; venceEmDias: number; repetirMaxMeses: number };
export const DEFAULT_FINANCEIRO_CONFIG: FinanceiroConfig = { contasAPagar: true, resultado: true, venceEmDias: 7, repetirMaxMeses: 24 };
export const VENCE_EM_DIAS_LIMITS = { min: 0, max: 60 } as const;
export const REPETIR_MAX_MESES_LIMITS = { min: 1, max: 60 } as const;
export const CONTAS_A_PAGAR_OFF = "Contas a pagar está desligado em Configurações › Financeiro.";

const intIn = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
export const isVenceEmDias = (v: unknown): v is number => intIn(v, VENCE_EM_DIAS_LIMITS.min, VENCE_EM_DIAS_LIMITS.max);
export const isRepetirMaxMeses = (v: unknown): v is number => intIn(v, REPETIR_MAX_MESES_LIMITS.min, REPETIR_MAX_MESES_LIMITS.max);

/** Lê o que estiver gravado, com o padrão no que faltar ou vier inválido. */
export function readFinanceiroConfig(v: unknown): FinanceiroConfig {
  const r = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof FinanceiroConfig, unknown>>;
  const d = DEFAULT_FINANCEIRO_CONFIG;
  return {
    contasAPagar: typeof r.contasAPagar === "boolean" ? r.contasAPagar : d.contasAPagar,
    resultado: typeof r.resultado === "boolean" ? r.resultado : d.resultado,
    venceEmDias: isVenceEmDias(r.venceEmDias) ? r.venceEmDias : d.venceEmDias,
    repetirMaxMeses: isRepetirMaxMeses(r.repetirMaxMeses) ? r.repetirMaxMeses : d.repetirMaxMeses,
  };
}
