import type { AvecSummary } from "@/server/domain/avec/context";
import type { FunnelSyncResult } from "@/server/domain/avec/funnel-sync";

/**
 * Textos e regras da tela Relatórios do Avec, sem dependência de servidor (a tela de envio usa no navegador; as rotas, no servidor).
 */

/** "2026-10-01" → "01/10/2026". */
export const brDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

/** Período do relatório: "01/10 a 14/10/2026" (mesmo ano), "03/12/2025 a 14/10/2026" ou "Sem data". */
export function periodLabel(from: string | null, to: string | null): string {
  if (!from && !to) return "Sem data";
  if (!from || !to || from === to) return brDate(from ?? to);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${brDate(from).slice(0, 5)} a ${brDate(to)}`;
  return `${brDate(from)} a ${brDate(to)}`;
}

/** Nome do arquivo para baixar: "Avec - Reservas - 01-10 a 14-10-2026.xlsx" (sem / \ : * ? " < > |). */
export function reportFileName(title: string, from: string | null, to: string | null, ext: "xlsx" | "pdf"): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const period = from || to ? ` - ${periodLabel(from, to).replace(/\//g, "-")}` : "";
  return `Avec - ${clean(title) || "Relatório"}${period}.${ext}`;
}

/** Cabeçalho de download: nome em ASCII (navegadores antigos) e o original com acento em UTF-8. */
export function contentDisposition(name: string): string {
  const ascii = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Agrupa por tipo (título, em ordem alfabética); dentro do grupo, o período mais novo primeiro e, sem data, o envio mais novo. */
export function groupReports<T extends { title: string; dateTo: string | null; importedAt: string }>(list: T[]): { title: string; items: T[] }[] {
  const by = new Map<string, T[]>();
  for (const r of list) by.set(r.title, [...(by.get(r.title) ?? []), r]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([title, items]) => ({
      title,
      items: [...items].sort((a, b) => (b.dateTo ?? "").localeCompare(a.dateTo ?? "") || b.importedAt.localeCompare(a.importedAt)),
    }));
}

const LABELS: [keyof AvecSummary, string, string][] = [
  ["profissionais", "profissional", "profissionais"],
  ["servicos", "serviço", "serviços"],
  ["contatosNovos", "cliente nova", "clientes novas"],
  ["contatosCompletados", "cadastro completado", "cadastros completados"],
  ["agendamentos", "horário na agenda", "horários na agenda"],
  ["bloqueios", "bloqueio de agenda", "bloqueios de agenda"],
  ["pacotes", "pacote de cliente", "pacotes de clientes"],
  ["usosPacote", "sessão de pacote usada", "sessões de pacote usadas"],
  ["itensVenda", "item vendido", "itens vendidos"],
  ["pagamentos", "pagamento", "pagamentos"],
  ["produtos", "produto criado ou completado", "produtos criados ou completados"],
  ["saldosEstoque", "saldo de estoque acertado pelo Avec", "saldos de estoque acertados pelo Avec"],
  ["produtosIgnorados", "produto ignorado: Produtos e estoque está desligado em Configurações › Estoque.", "produtos ignorados: Produtos e estoque está desligado em Configurações › Estoque."],
  ["semBaixa", "reserva sem desfecho no Avec", "reservas sem desfecho no Avec"],
  ["fichas", "resposta de ficha", "respostas de fichas"],
  ["fichasIgnoradas", "linha de ficha ignorada (sem data ou pergunta que a Casa não tem)", "linhas de ficha ignoradas (sem data ou pergunta que a Casa não tem)"],
  ["saldosFidelidade", "saldo de fidelidade", "saldos de fidelidade"],
  ["fidelidadeDesligada", "arquivo de fidelidade não importado (função Fidelidade desligada)", "arquivos de fidelidade não importados (função Fidelidade desligada)"],
  ["fichasDesligada", "arquivo de fichas não importado (função Fichas desligada)", "arquivos de fichas não importados (função Fichas desligada)"],
];

/** O que entrou, só o que não é zero: [{ n: 3, label: "clientes novas" }, …]. */
export function summaryLines(s: Partial<AvecSummary> | Record<string, number>): { key: keyof AvecSummary; n: number; label: string }[] {
  const src = s as Partial<Record<keyof AvecSummary, number>>;
  return LABELS.flatMap(([key, one, many]) => {
    const n = src[key] ?? 0;
    return n > 0 ? [{ key, n, label: n === 1 ? one : many }] : [];
  });
}

/** O que a importação mudou no funil, em uma frase (null quando nada mudou). */
export function funnelLine(f: FunnelSyncResult | null | undefined): string | null {
  if (!f) return null;
  const n = (v: number, one: string, many: string) => (v ? `${v} ${v === 1 ? one : many}` : null);
  const parts = [
    n(f.agendados, "foi para Agendado", "foram para Agendado"),
    n(f.datasAtualizadas, "teve a data do horário atualizada", "tiveram a data do horário atualizada"),
    n(f.naCasa ?? 0, "foi para Na Casa", "foram para Na Casa"),
    n(f.atendidas, "foi para Atendida", "foram para Atendida"),
    n(f.aguardando, "foi para Aguardando cliente (faltou ou cancelou)", "foram para Aguardando cliente (faltaram ou cancelaram)"),
    n(f.cartoesNovos, "cartão novo em Agendado", "cartões novos em Agendado"),
  ].filter(Boolean);
  return parts.length ? `Nas etapas: ${parts.join(", ")}.` : null;
}

/* ───────────── Envio de arquivos ───────────── */

/** O que a rota de envio devolve para a tela (por arquivo e o total). */
export type AvecUploadFile = {
  fileName: string; reportId: string | null; /** Tipo do relatório ("Reservas"…); vazio se nem deu para abrir. */ title: string; rowCount: number;
  /** false: o mesmo relatório já estava guardado (nada novo). */ newReport: boolean; removedColumns: string[]; summary: AvecSummary; error?: string;
};
export type AvecUploadResult = { files: AvecUploadFile[]; summary: AvecSummary; funil?: FunnelSyncResult };

/** O servidor aceita até 20 MB por envio; os limites ficam abaixo disso, com folga. Mais arquivos: enviar em partes. */
export const MAX_FILES = 40;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 18 * 1024 * 1024;
const mb = (b: number) => Math.round(b / (1024 * 1024));

/** Confere a escolha antes de enviar (na tela e de novo no servidor). null = tudo certo. */
export function checkUpload(files: { name: string; size: number }[]): string | null {
  if (!files.length) return "Escolha pelo menos um arquivo .xlsx.";
  if (files.length > MAX_FILES) return `No máximo ${MAX_FILES} arquivos por vez. Envie o resto em seguida.`;
  const wrong = files.find((f) => !/\.xlsx$/i.test(f.name));
  if (wrong) return `“${wrong.name}” não é .xlsx. Exporte do Avec em Excel (.xlsx).`;
  const big = files.find((f) => f.size > MAX_FILE_BYTES);
  if (big) return `“${big.name}” passa de ${mb(MAX_FILE_BYTES)} MB. Exporte um período menor no Avec.`;
  if (files.reduce((t, f) => t + f.size, 0) > MAX_TOTAL_BYTES) return `Os arquivos juntos passam de ${mb(MAX_TOTAL_BYTES)} MB. Envie em partes.`;
  return null;
}
