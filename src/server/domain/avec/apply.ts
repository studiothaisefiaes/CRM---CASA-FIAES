import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { avecReports } from "../../db/schema";
import { UserFacingError } from "../errors";
import { colOf, detectFormat, periodColumn, type AvecRole } from "./formats";
import { dateIso } from "./normalize";
import { sanitizeTable } from "./sanitize";
import { emptySummary, ImportCtx, type AvecSummary } from "./context";
import { applyClientEvidence, importContacts } from "./import-contacts";
import { derivePricesFromSales, importProfessionals, importServices } from "./import-catalog";
import { assignDayVisitsTx } from "../agenda/visits";
import { instantOf } from "@/lib/agenda";
import { importBlocks, importCancellations, importReservations, importUnclosed } from "./import-agenda";
import { importFichas } from "./import-fichas";
import { importLoyaltyBalances } from "./import-fidelidade";
import { importProducts } from "./import-products";
import { importPackageUses, importPackages, importPayments, importSalesItems } from "./import-sales";
import { closeFromAvecSales } from "./sales-close";
import { emptyFunnelSync, syncFunnelFromAgenda, type FunnelSyncResult } from "./funnel-sync";
import { refreshContactStats, type RefreshResult } from "../contact-stats";
import { absorbCrmPlaceholders, dbNow, pairAvecTwins } from "../agenda/twins";

/**
 * Aplica um relatório do Avec: saneia (tira CPF, RG, endereço, banco) ANTES de gravar qualquer coisa, guarda a tabela saneada em
 * `avec_reports` (o mesmo conteúdo não é guardado 2x) e roda os importadores do formato, tudo numa transação por arquivo.
 * Idempotente: importar de novo não cria nada. No fim do lote, marca os gêmeos do CRM (6B) e move o funil de quem conversou nos últimos 30 dias
 * (1C, `syncFunnelFromAgenda`). Não envia nada no WhatsApp. Por fim refaz a visão por contato (`contact_stats`) da ficha e da lista de Contatos.
 */

export type { AvecSummary } from "./context";
export type AvecFileInput = { fileName: string; rows: string[][]; userId?: string | null; /** O relógio da importação (testes e script). */ now?: Date };
export type AvecFileResult = {
  fileName: string; reportId: string | null; signature: string; title: string; roles: AvecRole[];
  /** Linhas de dados (sem o cabeçalho). */ rowCount: number;
  /** false quando o mesmo relatório (mesmo formato e conteúdo) já estava guardado. */ newReport: boolean;
  /** Colunas que saíram por serem dados pessoais. */ removedColumns: string[];
  summary: AvecSummary; error?: string;
};
export type AvecBatchResult = { files: AvecFileResult[]; summary: AvecSummary; funil?: FunnelSyncResult };

const IMPORTERS: [AvecRole, (ctx: ImportCtx) => Promise<void>][] = [
  ["profissionais", importProfessionals], ["servicos", importServices], ["contatos", importContacts],
  ["agendamentos", importReservations], ["cancelamentos", importCancellations], ["sem_baixa", importUnclosed], ["bloqueios", importBlocks],
  ["pacotes", importPackages], ["usos_pacote", importPackageUses], ["itens", importSalesItems], ["pagamentos", importPayments], ["fichas", importFichas], ["fidelidade", importLoyaltyBalances],
  ["produtos", async (ctx) => { await importProducts(ctx); }],
];

function withoutColumn(columns: string[], rows: string[][], name: string) {
  const drop = colOf(columns, name);
  if (drop < 0) return { columns, rows };
  return { columns: columns.filter((_, i) => i !== drop), rows: rows.map((r) => r.filter((_, i) => i !== drop)) };
}

function period(columns: string[], rows: string[][]) {
  const ix = periodColumn(columns);
  if (ix < 0) return { dateFrom: null, dateTo: null };
  const days = rows.map((r) => dateIso(r[ix])).filter((d): d is string => !!d).sort();
  return { dateFrom: days[0] ?? null, dateTo: days[days.length - 1] ?? null };
}

export async function applyAvecFile(input: AvecFileInput): Promise<AvecFileResult> {
  const [header, ...data] = input.rows;
  if (!header?.some((h) => h.trim())) throw new UserFacingError(`"${input.fileName}" está vazio ou sem cabeçalho na 1ª linha.`);
  const head = header.map((h) => h.trim());
  const format = detectFormat(head);
  const clean = sanitizeTable(head, data);
  // Respostas das fichas são dado da cliente: o relatório guardado (tela, Excel, PDF) fica sem a coluna Valor. O hash e a importação usam a tabela inteira.
  const stored = format.roles.includes("fichas") ? withoutColumn(clean.columns, clean.rows, "valor") : clean;
  const hash = createHash("sha256").update(JSON.stringify([clean.columns, clean.rows])).digest("hex");

  return db.transaction(async (tx) => {
    const inserted = await tx.insert(avecReports).values({
      signature: format.signature, title: format.title, fileName: input.fileName, fileHash: hash, columns: stored.columns, rows: stored.rows,
      rowCount: clean.rows.length, ...period(clean.columns, clean.rows), importedBy: input.userId ?? null,
    }).onConflictDoNothing().returning({ id: avecReports.id });
    const reportId = inserted[0]?.id
      ?? (await tx.select({ id: avecReports.id }).from(avecReports).where(and(eq(avecReports.signature, format.signature), eq(avecReports.fileHash, hash))))[0]?.id ?? null;

    const ctx = new ImportCtx(tx, clean.columns, clean.rows, format.roles, { now: input.now, reportId, signature: format.signature, newReport: !!inserted[0], userId: input.userId });
    for (const [role, run] of IMPORTERS) if (format.roles.includes(role)) await run(ctx);
    // 17/10: a reserva já entra com a visita da cliente no dia (antes só nascia no job do lembrete; a comanda e o Chegou dependem dela).
    if (format.roles.includes("agendamentos") || format.roles.includes("cancelamentos")) {
      const p = period(clean.columns, clean.rows);
      await assignDayVisitsTx(tx, p.dateFrom && p.dateTo ? { from: instantOf(p.dateFrom, 0), to: instantOf(p.dateTo, 1440) } : {});
    }
    // 17/10: comanda ou pagamento do Avec dá baixa no horário da cliente no dia (mexido no CRM: só anota).
    if (ctx.salesDays.length) await closeFromAvecSales(tx, ctx.salesDays, ctx.now);
    await applyClientEvidence(ctx);
    await ctx.cleanImageUseNames();
    await ctx.cleanCompleteProfileNames();
    if (format.roles.includes("itens")) await derivePricesFromSales(ctx);

    if (inserted[0]) await tx.update(avecReports).set({ applied: ctx.summary }).where(eq(avecReports.id, inserted[0].id));
    return {
      fileName: input.fileName, reportId, signature: format.signature, title: format.title, roles: format.roles, rowCount: clean.rows.length,
      newReport: !!inserted[0], removedColumns: clean.removed, summary: ctx.summary,
    };
  });
}

/**
 * Ordem num lote: profissionais e serviços primeiro, depois listas de contatos, depois agenda/pacotes/vendas e, por último,
 * cancelamentos e uso de pacotes (que procuram a reserva e o pacote já gravados: antes deles, o cancelamento sem hora viraria
 * um horário à parte e o uso ficaria sem pacote).
 */
export function batchOrder(roles: AvecRole[]): number {
  if (roles.includes("profissionais") || roles.includes("servicos")) return 0;
  if (roles.length === 1 && roles[0] === "contatos") return 1;
  if (roles.includes("cancelamentos") || roles.includes("usos_pacote") || roles.includes("sem_baixa")) return 3; // procuram a reserva já gravada
  if (roles.includes("fichas")) return 3; // procuram a cliente (e a visita do dia) já gravadas
  return 2;
}

export function addSummary(a: AvecSummary, b: AvecSummary): AvecSummary {
  const out = { ...a };
  for (const k of Object.keys(out) as (keyof AvecSummary)[]) out[k] += b[k];
  return out;
}

/** Vários relatórios de uma vez, na ordem certa. Um arquivo com problema não impede os outros (o erro volta no resultado dele). */
export async function applyAvecFiles(files: AvecFileInput[], opts: { now?: Date } = {}): Promise<AvecBatchResult & { funil: FunnelSyncResult; visao: RefreshResult | null }> {
  const startedAt = await dbNow();
  const ordered = files
    .map((f, i) => ({ f, i, order: f.rows[0] ? batchOrder(detectFormat(f.rows[0].map((h) => h.trim())).roles) : 2 }))
    .sort((a, b) => a.order - b.order || a.i - b.i);
  const results: AvecFileResult[] = [];
  let summary = emptySummary();
  for (const { f } of ordered) {
    try {
      const r = await applyAvecFile({ ...f, now: f.now ?? opts.now });
      results.push(r);
      summary = addSummary(summary, r.summary);
    } catch (e) {
      const header = f.rows[0]?.map((h) => h.trim()) ?? [];
      const fmt = detectFormat(header);
      results.push({
        fileName: f.fileName, reportId: null, signature: fmt.signature, title: fmt.title, roles: fmt.roles, rowCount: Math.max(0, f.rows.length - 1),
        newReport: false, removedColumns: [], summary: emptySummary(), error: e instanceof UserFacingError ? e.message : `Não foi possível importar: ${(e as Error).message}`,
      });
    }
  }
  // 6B: reservas do Avec que acabaram de entrar e já existem no CRM viram gêmeas (antes do funil, que ignora gêmeas). Falhar aqui não desfaz a importação.
  await db.transaction((tx) => pairAvecTwins(tx, { from: startedAt })).catch((e) => console.error("[avec → gêmeos]", e));
  // 17/10: o "Atendimento" do lead se junta à visita do Avec da mesma cliente no dia. Falhar aqui não desfaz a importação.
  await db.transaction((tx) => absorbCrmPlaceholders(tx, { now: opts.now ?? new Date() })).catch((e) => console.error("[avec → Atendimento da conversa]", e));
  // A agenda que entrou move o funil (decisão 4: só de quem conversou nos últimos 30 dias). Falhar aqui não desfaz a importação.
  const funil = await syncFunnelFromAgenda({ now: opts.now }).catch((e) => ({ ...emptyFunnelSync(), erros: [e instanceof Error ? e.message : String(e)] }));
  // Lote 2: a visão por contato (visitas, ritmo, preferências) é refeita com o que entrou. Falhar aqui não desfaz a importação (roda de novo à noite).
  const visao = await refreshContactStats({ now: opts.now }).catch((e) => { console.error("[visão por contato]", e); return null; });
  return { files: results, summary, funil, visao };
}
