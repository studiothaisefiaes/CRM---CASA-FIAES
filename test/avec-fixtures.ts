import { applyAvecFile, type AvecFileInput } from "@/server/domain/avec/apply";
import { buildXlsx, readXlsx } from "@/server/domain/avec/xlsx";

/**
 * Planilhas SINTÉTICAS do Avec (nomes e telefones inventados) com os cabeçalhos dos relatórios reais. Os arquivos de verdade têm dados de
 * clientes e nunca entram no repositório.
 */
type Cell = string | number | null;
export const AVEC_H = {
  /** "Reservas" (f18900ac): filtrado pela Data Reserva; traz todos os status. */
  reservas: ["Data Cadastro Reserva", "Data Reserva", "Hora", "Cliente", "Celular", "Data Cadastro Cliente", "E-mail", "Profissional", "Serviço", "Origem", "Status", "Observação", "Data Comanda", "Número", "Quem Cadastrou"],
  /** "Reservas (quem cadastrou)" (1903eedc): filtrado pela data de CADASTRO. */
  reservasCadastro: ["Data Cadastro", "Data Reserva", "Hora", "Cliente", "Profissional", "Serviço", "Status", "Quem Cadastrou"],
  /** "Cancelamentos" (e8aa4978): nunca traz a hora da reserva. */
  cancelamentos: ["Data", "Cliente", "Telefone", "Profissional", "Serviço", "Valor total", "Obs", "Responsável Cancelamento", "Cancelamento", "Responsavel", "Data Cadastro"],
  espera: ["Data", "Cliente", "Telefone", "Profissional", "Serviço", "Obs", "Responsavel", "Responsavel última atualização", "Data Cadastro", "Última atualização"],
  itens: ["Data", "Comanda", "Item", "Tipo", "Categoria", "Profissional", "Assistente 1", "Assistente 2", "Comissão (%)", "Cliente", "Email", "Telefone", "Celular", "Valor", "Desconto", "Qtd.", "Custo", "Comissão", "Líquido", "UA"],
  pagamentos: ["Data Comanda", "Comanda", "Cliente", "CPF", "Valor", "Forma de Pagamento", "Detalhe", "Data Pagamento", "Caixa", "Abertura"],
};

export const avecSheet = async (fileName: string, rows: Cell[][]): Promise<AvecFileInput> => ({ fileName, rows: await readXlsx(await buildXlsx(rows)) });

/** Uma linha do "Reservas": dia "dd/mm/aaaa", hora, cliente, celular, profissional, serviço e status. */
export const reserva = (o: { dia: string; hora: string; cliente: string; celular?: number | null; pro?: string; servico?: string; status?: string }): Cell[] =>
  ["10/10/2026 10:00", o.dia, o.hora, o.cliente, o.celular ?? null, "", "", o.pro ?? "MAIARA", o.servico ?? "Corte", "Interno", o.status ?? "Agendado", "", "", "", "Recepção"];
export const cancelamento = (o: { dia: string; cliente: string; celular?: number | null; pro?: string; servico?: string }): Cell[] =>
  [o.dia, o.cliente, o.celular ?? null, o.pro ?? "MAIARA", o.servico ?? "Corte", 100, "", "Recepção", "2026-10-10 10:00:00", "Recepção", "2026-10-01 10:00:00"];
export const item = (o: { dia: string; comanda: number; cliente: string; celular?: number | null; servico?: string; pro?: string; valor?: number }): Cell[] =>
  [o.dia, o.comanda, o.servico ?? "Corte", "Serviço", "Cabelo", o.pro ?? "MAIARA", "", "", 40, o.cliente, "", "", o.celular ?? null, o.valor ?? 100, 0, 1, 0, 40, 60, ""];
export const pagamento = (o: { dia: string; comanda: number; cliente: string; valor?: number }): Cell[] =>
  [o.dia, o.comanda, o.cliente, "", o.valor ?? 100, "Pix", "", o.dia, "Caixa", `${o.dia} 08:00:00`];

export const importa = async (name: string, header: string[], rows: Cell[][], opts: { now?: Date } = {}) =>
  applyAvecFile({ ...(await avecSheet(name, [header, ...rows])), now: opts.now } as AvecFileInput);
