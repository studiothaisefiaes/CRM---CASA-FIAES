/** Configurações › Estoque (chave `estoque_config`): liga/desliga Produtos e estoque e os padrões fiscais de um produto novo. */
export type EstoqueConfig = { ligado: boolean; cfopPadrao: string; csosnPadrao: string; unidadePadrao: string };
export const DEFAULT_ESTOQUE_CONFIG: EstoqueConfig = { ligado: true, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" };
export const ESTOQUE_OFF = "Produtos e estoque está desligado em Configurações › Estoque.";

export const isCfop = (v: unknown): v is string => typeof v === "string" && /^[0-9]{4}$/.test(v);
export const isCsosn = (v: unknown): v is string => typeof v === "string" && /^[0-9]{3}$/.test(v);
export const isUnidade = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z]{1,6}$/.test(v);

/** Lê o que estiver gravado, com o padrão no que faltar ou vier inválido. */
export function readEstoqueConfig(v: unknown): EstoqueConfig {
  const r = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof EstoqueConfig, unknown>>;
  const d = DEFAULT_ESTOQUE_CONFIG;
  return {
    ligado: typeof r.ligado === "boolean" ? r.ligado : d.ligado,
    cfopPadrao: isCfop(r.cfopPadrao) ? r.cfopPadrao : d.cfopPadrao,
    csosnPadrao: isCsosn(r.csosnPadrao) ? r.csosnPadrao : d.csosnPadrao,
    unidadePadrao: isUnidade(r.unidadePadrao) ? r.unidadePadrao.toUpperCase() : d.unidadePadrao,
  };
}
