import { notFound } from "next/navigation";
import { consumePrintToken } from "@/server/reports/print-token";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { loadTranscript } from "@/server/queries/transcript";
import { stamp, transcriptLine } from "@/lib/transcript";

export const metadata = { title: "Conversa" };
export const dynamic = "force-dynamic";

/** Página que o Chromium do servidor imprime em PDF (A4). Sem cookie: token de uso único (5 min) de quem pediu, com Contatos e Exportar. */
export default async function ImprimirConversa({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await consumePrintToken(typeof sp.t === "string" ? sp.t : null);
  if (!user || !can(user.perms, "contatos.ver") || !can(user.perms, "relatorios.exportar")) notFound();
  const id = typeof sp.contato === "string" ? sp.contato : "";
  if (!isUuid(id)) notFound();
  const withNotes = sp.notas === "1";
  const t = await loadTranscript(id, { notes: withNotes });
  if (!t) notFound();
  return (
    <main style={{ fontFamily: "Arial, sans-serif", fontSize: 11, lineHeight: 1.5, color: "#121212", background: "#fff", padding: "14mm" }}>
      <h1 style={{ fontSize: 16, margin: 0 }}>Conversa de {t.clientName} ({t.phone}) com a Casa Fiaes</h1>
      <p style={{ color: "#6f6a62", margin: "4px 0 12px" }}>Gerado em {stamp(new Date())} por {user.name}{withNotes ? " · inclui notas internas (só a equipe via)" : ""}{t.truncated ? " · só os 20.000 primeiros registros" : ""}</p>
      {t.lines.length === 0 ? <p>Nenhuma mensagem registrada.</p> : (
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {t.lines.map((l, i) => <li key={i} style={{ padding: "2px 0", borderBottom: "1px solid #eee", background: l.direction === "nota" ? "#fbf4e6" : undefined }}>{transcriptLine(l, t.clientName)}</li>)}
        </ol>
      )}
    </main>
  );
}
