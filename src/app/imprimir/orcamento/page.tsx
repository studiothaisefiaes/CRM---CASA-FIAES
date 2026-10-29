import { readFile } from "node:fs/promises";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { contacts, deals } from "@/server/db/schema";
import { consumePrintToken } from "@/server/reports/print-token";
import { ensureMedia } from "@/server/whatsapp/media";
import { sniffMime } from "@/server/security/sniff";
import { getCasaInfo } from "@/server/domain/client-link/settings";
import { can } from "@/lib/permissions";
import { brl, decodeOrcamento, totalCents } from "@/lib/orcamento";

export const metadata = { title: "Orçamento" };
export const dynamic = "force-dynamic";

const INK = "#1b1813", MUTED = "#6f6a62", GOLD = "#8a6a2f", LINE = "#e7e1d6", PAPER = "#faf7f1";
const day = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", year: "numeric" });

/** A foto da conversa embutida no PDF (o Chromium não tem a sessão para abrir /api/media). */
async function photo(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const f = await ensureMedia(id).catch(() => null);
  if (!f) return null;
  const data = await readFile(f.file).catch(() => null);
  if (!data) return null;
  const mime = sniffMime(data.subarray(0, 4096));
  return mime?.startsWith("image/") ? `data:${mime};base64,${data.toString("base64")}` : null;
}

/** Página que o Chromium do servidor imprime em PDF (A4): o orçamento do Método com as fotos de antes e depois. Token de uso único de quem pediu. */
export default async function ImprimirOrcamento({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await consumePrintToken(typeof sp.t === "string" ? sp.t : null);
  if (!user || !can(user.perms, "atendimento.ver")) notFound();
  const o = typeof sp.d === "string" ? decodeOrcamento(sp.d) : null;
  if (!o) notFound();
  const [d] = await db.select({ name: contacts.name }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, o.dealId));
  if (!d) notFound();
  const [antes, depois, casa] = await Promise.all([photo(o.antesId), photo(o.depoisId), getCasaInfo()]);
  const hoje = new Date();
  const ate = new Date(hoje.getTime() + o.validadeDias * 86_400_000);
  const nome = d.name?.trim().split(/\s+/)[0] ?? null;
  const fotos = [["Antes", antes], ["Depois", depois]].filter(([, src]) => src) as [string, string][];
  return (
    <main style={{ fontFamily: "Arial, Helvetica, sans-serif", color: INK, background: "#fff", padding: "16mm 16mm 12mm", fontSize: 12, lineHeight: 1.5 }}>
      <style>{"@page { size: A4; margin: 0 } * { box-sizing: border-box } html, body { background: #fff !important }"}</style>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1px solid ${LINE}`, paddingBottom: 10 }}>
        <div>
          <div style={{ fontSize: 22, letterSpacing: 0.5 }}>Casa <span style={{ color: GOLD }}>Fiaes</span></div>
          <div style={{ color: MUTED, fontSize: 11 }}>Método Fiaes®</div>
        </div>
        <div style={{ textAlign: "right", color: MUTED, fontSize: 11 }}>Orçamento · {day(hoje)}</div>
      </header>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: "18px 0 4px" }}>{nome ? `${nome}, este é o seu projeto` : "O seu projeto"}</h1>
      <p style={{ color: MUTED, margin: 0 }}>Feito sob medida a partir da avaliação do seu cabelo.</p>
      {fotos.length > 0 && (
        <section style={{ display: "grid", gridTemplateColumns: fotos.length === 2 ? "1fr 1fr" : "1fr", gap: 10, marginTop: 16 }}>
          {fotos.map(([label, src]) => (
            <figure key={label} style={{ margin: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={label} style={{ width: "100%", height: fotos.length === 2 ? 300 : 380, objectFit: "cover", borderRadius: 8, display: "block" }} />
              <figcaption style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>{label}</figcaption>
            </figure>
          ))}
        </section>
      )}
      <section style={{ marginTop: 18, background: PAPER, borderRadius: 8, padding: "12px 14px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {o.itens.map((i, k) => (
              <tr key={k} style={{ borderBottom: `1px solid ${LINE}` }}>
                <td style={{ padding: "7px 0" }}>{i.nome}</td>
                <td style={{ padding: "7px 0", textAlign: "right", whiteSpace: "nowrap" }}>{brl(i.valorCents)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ padding: "10px 0 2px", fontWeight: 700, fontSize: 14 }}>Total</td>
              <td style={{ padding: "10px 0 2px", textAlign: "right", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}>{brl(totalCents(o))}</td>
            </tr>
          </tbody>
        </table>
      </section>
      {o.obs?.trim() && <p style={{ marginTop: 14, whiteSpace: "pre-wrap" }}>{o.obs.trim()}</p>}
      <p style={{ marginTop: 14, color: MUTED, fontSize: 11 }}>Valores válidos por {o.validadeDias} {o.validadeDias === 1 ? "dia" : "dias"} (até {day(ate)}). O valor final é confirmado na avaliação.</p>
      <footer style={{ marginTop: 22, borderTop: `1px solid ${LINE}`, paddingTop: 8, color: MUTED, fontSize: 10 }}>
        Casa Fiaes{casa.endereco ? ` · ${casa.endereco}` : ""}
      </footer>
    </main>
  );
}
