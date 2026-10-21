/** Regras da comissão (Fase A): o que se desconta da base ou da comissão. Puro; o padrão é neutro (nada descontado). */
export type DeductMode = "nao" | "antes" | "depois";
export type CommissionRules = {
  cartao: DeductMode;
  antecipacao: DeductMode;
  /** Taxa de antecipação do crédito, em pontos-base (700 = 7%). */
  antecipacaoBp: number;
  custo: DeductMode;
  doisAssistentes: "total" | "metade";
  /** Quanto da comissão das assistentes sai da principal, em pontos-base (10000 = 100%). */
  assistenteSaiDaPrincipalBp: number;
  divida: "agora" | "quitacao";
};
export type ProCommissionRules = Partial<Pick<CommissionRules, "cartao" | "antecipacao" | "custo">>;

export const NEUTRAL_COMMISSION_RULES: CommissionRules = {
  cartao: "nao", antecipacao: "nao", antecipacaoBp: 0, custo: "nao", doisAssistentes: "total", assistenteSaiDaPrincipalBp: 0, divida: "agora",
};

export const DEDUCT_LABEL: Record<DeductMode, string> = {
  nao: "Não descontar", antes: "Descontar antes de calcular", depois: "Descontar da comissão",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const mode = (v: unknown): DeductMode | undefined => (v === "nao" || v === "antes" || v === "depois" ? v : undefined);
const bp = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10000 ? v : undefined);

/** Lê o que está salvo; campo ausente ou inválido vira o neutro. */
export function readCommissionRules(v: unknown): CommissionRules {
  const o = isObj(v) ? v : {};
  const n = NEUTRAL_COMMISSION_RULES;
  return {
    cartao: mode(o.cartao) ?? n.cartao,
    antecipacao: mode(o.antecipacao) ?? n.antecipacao,
    antecipacaoBp: bp(o.antecipacaoBp) ?? n.antecipacaoBp,
    custo: mode(o.custo) ?? n.custo,
    doisAssistentes: o.doisAssistentes === "total" || o.doisAssistentes === "metade" ? o.doisAssistentes : n.doisAssistentes,
    assistenteSaiDaPrincipalBp: bp(o.assistenteSaiDaPrincipalBp) ?? n.assistenteSaiDaPrincipalBp,
    divida: o.divida === "agora" || o.divida === "quitacao" ? o.divida : n.divida,
  };
}

/** Regras próprias da profissional (só os três descontos). Nada válido = null. */
export function readProCommissionRules(v: unknown): ProCommissionRules | null {
  if (!isObj(v)) return null;
  const out: ProCommissionRules = {};
  for (const k of ["cartao", "antecipacao", "custo"] as const) { const m = mode(v[k]); if (m) out[k] = m; }
  return Object.keys(out).length ? out : null;
}

export const effectiveRules = (casa: CommissionRules, pro: ProCommissionRules | null): CommissionRules => ({ ...casa, ...(pro ?? {}) });
