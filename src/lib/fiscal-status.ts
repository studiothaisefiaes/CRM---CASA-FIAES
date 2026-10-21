/** Situação da nota fiscal em palavras da tela (Fase D). Um nome para cada coisa. */
export const FISCAL_STATUS_LABEL: Record<string, string> = {
  pendente: "Enviando", autorizada: "Autorizada", rejeitada: "Rejeitada", erro_envio: "Erro no envio", cancelada: "Cancelada",
};
export const fiscalStatusLabel = (s: string) => FISCAL_STATUS_LABEL[s] ?? s;
export const FISCAL_KIND_LABEL: Record<string, string> = { nfse: "NFS-e (serviços)", nfce: "NFC-e (produtos)" };
export const FISCAL_ENV_LABEL: Record<string, string> = { teste: "Teste", producao: "Produção" };
