import { notFound } from "next/navigation";
import { periodLabel } from "@/components/relatorios-avec/format";
import { loadAvecPrint, PRINT_MAX_ROWS } from "./load";

export const metadata = { title: "Relatório do Avec" };
export const dynamic = "force-dynamic";

const TZ = "America/Bahia";

/**
 * Tabela de um relatório do Avec para o Chromium do servidor imprimir em PDF (A4 deitado). Como /imprimir/relatorio: sem cookie,
 * só abre com o token de uso único de quem pediu, e só para quem vê e exporta relatórios. A tabela já vem saneada.
 */
export default async function ImprimirAvec({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const data = await loadAvecPrint(typeof sp.t === "string" ? sp.t : null, typeof sp.id === "string" ? sp.id : null);
  if (!data) notFound();
  const { user, table: t, total, cut } = data;
  // Muitas colunas: letra menor para caber na largura da folha.
  const size = t.columns.length > 14 ? "6.5pt" : t.columns.length > 9 ? "7.5pt" : "8.5pt";
  return (
    <main className="print-avec" style={{ fontSize: size }}>
      <style>{`
        @page { size: A4 landscape; margin: 10mm 10mm 14mm; }
        html, body { background: #fff !important; }
        .print-avec { font-family: var(--font-inter), system-ui, sans-serif; color: #121212; line-height: 1.35; }
        .print-avec header { border-bottom: 1px solid #121212; padding-bottom: 3mm; margin-bottom: 4mm; }
        .brand { font-size: 11pt; font-weight: 600; margin: 0 0 2mm; } .brand em { color: #7a5524; }
        h1 { font-size: 18pt; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 1mm; }
        .meta { color: #5c5c5c; font-size: 8.5pt; margin: .5mm 0; } .note { color: #7a5524; font-size: 8.5pt; margin: 1.5mm 0 0; }
        table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
        thead { display: table-header-group; } tr { break-inside: avoid; }
        th { text-align: left; font-size: .92em; text-transform: uppercase; letter-spacing: .04em; color: #6f6a62; font-weight: 600; padding: 1.2mm 1.4mm; border-bottom: 1px solid #d3cfc7; vertical-align: bottom; }
        td { padding: 1mm 1.4mm; border-bottom: 1px solid #ebe8e2; vertical-align: top; overflow-wrap: anywhere; }
        .muted { color: #6f6a62; }
        nextjs-portal { display: none !important; }
      `}</style>
      <header>
        <p className="brand">Casa <em>Fiaes</em> · Relatório do Avec</p>
        <h1>{t.title}</h1>
        <p className="meta">Período: {periodLabel(t.dateFrom, t.dateTo)} · {total.toLocaleString("pt-BR")} {total === 1 ? "linha" : "linhas"} · arquivo “{t.fileName}”</p>
        <p className="meta">Gerado em {new Date().toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" })} por {user.name}</p>
        {cut > 0 && <p className="note">O PDF mostra as primeiras {PRINT_MAX_ROWS.toLocaleString("pt-BR")} linhas ({cut.toLocaleString("pt-BR")} ficaram de fora). Para a tabela inteira, use Baixar Excel.</p>}
      </header>
      {t.rows.length === 0 ? <p className="muted">Relatório sem linhas.</p> : (
        <table>
          <thead><tr>{t.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>{t.rows.map((r, i) => <tr key={i}>{t.columns.map((_, j) => <td key={j}>{r[j] ?? ""}</td>)}</tr>)}</tbody>
        </table>
      )}
    </main>
  );
}
