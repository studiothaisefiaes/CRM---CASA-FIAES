import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { profiles, reportFiles, users } from "../db/schema";
import { UserFacingError } from "../domain/errors";
import { issuePrintToken } from "./print-token";
import { previousMonthKey } from "./month-key";
import { chromiumExecutable } from "./chromium";

export type PdfTipo = "periodo" | "mensal" | "equipe";
const LOCK_KEY = 74_210_001; // um PDF de cada vez (Chromium pesa)
const TIMEOUT_MS = 60_000;

/** Endereço interno do próprio app (o Chromium abre a página de impressão por ele, sem passar pelo Caddy). */
export const pdfBaseUrl = () => process.env.PDF_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
export const reportsDir = () => process.env.REPORTS_DIR ?? join(process.cwd(), "data", "relatorios");

/**
 * Gera o PDF abrindo /imprimir/relatorio num Chromium headless, como `userId` (token de uso único; as permissões da pessoa valem).
 * Um de cada vez (cadeado no banco): o segundo pedido recebe "Já tem um PDF sendo gerado". Sem Chromium: "PDF indisponível neste servidor".
 */
export function renderPdf(input: { tipo: PdfTipo; periodo?: string; ref?: string; userId: string }): Promise<Buffer> {
  const params = { tipo: input.tipo, ...(input.periodo ? { periodo: input.periodo } : {}), ...(input.ref ? { ref: input.ref } : {}) };
  return renderPagePdf({ path: "/imprimir/relatorio", params, userId: input.userId });
}

/**
 * O mesmo mecanismo para qualquer página de impressão em /imprimir (ex.: a tabela de um relatório do Avec, em paisagem).
 * A página recebe `?t=<token>` além de `params` e precisa conferir o token e as permissões ela mesma.
 */
export async function renderPagePdf(input: { path: `/imprimir/${string}`; params?: Record<string, string>; userId: string; landscape?: boolean }): Promise<Buffer> {
  const client = await pool.connect();
  let released = false;
  try {
    const { rows } = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [LOCK_KEY]);
    if (!rows[0]?.ok) throw new UserFacingError("Já tem um PDF sendo gerado. Tente de novo em instantes.");
    try {
      const token = await issuePrintToken(input.userId);
      const qs = new URLSearchParams({ ...input.params, t: token });
      let chromium: typeof import("playwright-core").chromium;
      try { ({ chromium } = await import("playwright-core")); } catch { throw new UserFacingError("PDF indisponível neste servidor."); }
      const executablePath = chromiumExecutable(chromium); // falta o Chromium: erro claro com o que falta e onde (QA r66, I-5)
      const browser = await chromium.launch({ headless: true, executablePath }).catch((e) => { console.error("[pdf] chromium", e); throw new UserFacingError("PDF indisponível neste servidor: o Chromium não abriu. Veja o log do worker."); });
      try {
        const page = await browser.newPage({ locale: "pt-BR", timezoneId: "America/Bahia" });
        const res = await page.goto(`${pdfBaseUrl()}${input.path}?${qs}`, { waitUntil: "networkidle", timeout: TIMEOUT_MS });
        if (!res || !res.ok()) throw new Error(`página de impressão respondeu ${res?.status()}`);
        await page.evaluate(() => document.fonts.ready);
        return await page.pdf({
          format: "A4", landscape: !!input.landscape, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate: `<div style="width:100%;font-size:8px;color:#6f6a62;padding:0 14mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif"><span>Casa Fiaes</span><span>página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
        });
      } finally { await browser.close().catch(() => {}); }
    } finally {
      // Se o destravar falhar, a conexão sai do pool (com o cadeado junto) em vez de voltar presa a ele.
      if (!(await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).then(() => true, () => false))) { client.release(true); released = true; }
    }
  } finally { if (!released) client.release(); }
}

/** Quem "assina" o fechamento mensal: a primeira pessoa ativa que vê a equipe, os valores e exporta (a gestão). */
async function monthlyAuthor(): Promise<string | null> {
  const [u] = await db.select({ id: users.id }).from(users).innerJoin(profiles, eq(profiles.id, users.profileId))
    .where(and(eq(users.active, true), sql`${profiles.permissions} @> array['relatorios.equipe','relatorios.exportar','valores.ver']::text[]`))
    .orderBy(users.createdAt).limit(1);
  return u?.id ?? null;
}

/**
 * Worker, todo dia às 06:00: se o fechamento do mês anterior ainda não existe, gera, guarda em data/relatorios/AAAA-MM.pdf
 * e registra em report_files (idempotente: worker parado no dia 1º gera no dia seguinte, sem duplicar).
 */
export async function ensureMonthlyReport(now: Date = new Date(), render: typeof renderPdf = renderPdf): Promise<{ created: string | null }> {
  const key = previousMonthKey(now);
  const [exists] = await db.select({ id: reportFiles.id }).from(reportFiles).where(and(eq(reportFiles.kind, "mensal"), eq(reportFiles.periodKey, key)));
  if (exists) return { created: null };
  const author = await monthlyAuthor();
  if (!author) return { created: null };
  const pdf = await render({ tipo: "mensal", ref: now.toISOString(), userId: author });
  await mkdir(reportsDir(), { recursive: true });
  const file = `${key}.pdf`; // só o nome no banco: a pasta vem de reportsDir() (restaurar em outro lugar continua funcionando)
  await writeFile(join(reportsDir(), file), pdf);
  await db.insert(reportFiles).values({ kind: "mensal", periodKey: key, path: file, bytes: pdf.length }).onConflictDoNothing();
  return { created: key };
}
