/** Resumo do dia no WhatsApp (Fase B, item 16): tipos e limites, seguros para a tela. A regra de envio está em src/server/domain/summary-whatsapp.ts. */
export const SUMMARY_SOURCE = "resumo_dia:";

export type SummaryDestino = "gestao" | "escolhidas";
export type SummaryWhatsapp = {
  enabled: boolean;
  /** "gestao": as pessoas da Gestão que têm número em `numeros`; "escolhidas": as de `numeros`, todas com "Ver números de toda a equipe". */
  destino: SummaryDestino;
  /** Hora de Salvador (0 a 23) em que o resumo sai. */
  hora: number;
  maxPessoas: number;
  /** true: só manda se a Casa abre naquele dia (semana + Dias especiais). */
  soDiasAbertos: boolean;
  /** O WhatsApp de cada pessoa (a tabela de usuários não guarda telefone). */
  numeros: { userId: string; phone: string }[];
  /** A linha de abertura da mensagem; {data} vira o dia (ex.: terça-feira, 20/10). O corpo do resumo é gerado. */
  titulo: string;
};

export const SUMMARY_TITULO_SUGERIDO = "*Resumo do dia* ({data})";
export const renderSummaryTitulo = (titulo: string, data: string): string => titulo.replaceAll("{data}", data).replace(/ \(\)/g, "").trim();

export const SUMMARY_WHATSAPP_DEFAULTS: SummaryWhatsapp = { enabled: false, destino: "gestao", hora: 19, maxPessoas: 3, soDiasAbertos: true, numeros: [], titulo: SUMMARY_TITULO_SUGERIDO };
export const SUMMARY_WHATSAPP_LIMITS = { hora: { min: 0, max: 23 }, maxPessoas: { min: 1, max: 10 } } as const;

/** Dia (AAAA-MM-DD) de Salvador (UTC−3, sem horário de verão). */
export const bahiaDay = (now: Date): string => new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
