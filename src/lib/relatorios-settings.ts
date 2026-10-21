/** Configurações › Relatórios (chave `relatorios_config`): liga/desliga o que os Relatórios mostram. */
export type RelatoriosConfig = { ocupacao: boolean };
export const DEFAULT_RELATORIOS_CONFIG: RelatoriosConfig = { ocupacao: true };
export const OCUPACAO_OFF = "A Ocupação está desligada em Configurações › Relatórios.";

/** Lê o que estiver gravado, com o padrão no que faltar ou vier inválido. */
export function readRelatoriosConfig(v: unknown): RelatoriosConfig {
  const r = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof RelatoriosConfig, unknown>>;
  return { ocupacao: typeof r.ocupacao === "boolean" ? r.ocupacao : DEFAULT_RELATORIOS_CONFIG.ocupacao };
}
