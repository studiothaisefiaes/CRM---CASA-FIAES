import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { findSessionUser } from "@/server/auth/sessions-store";
import { db } from "@/server/db";
import { fiscalDocuments } from "@/server/db/schema";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
const noDecl = (xml: string) => xml.replace(/^\s*<\?xml[^>]*\?>/, "");
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Nota fiscal da comanda (pede `nota.ver`); o id é de fiscal_documents. (/api/notas é a anotação da ficha: um nome para cada coisa.)
 * - `?formato=xml`: a DPS assinada que o CRM enviou e a resposta do governo (o XML da NFS-e, ou o JSON da recusa em CDATA), num arquivo.
 * - `?formato=pdf`: 501. A API do DANFSe no ADN foi suspensa em 15/07/2026 (NT 008); a pessoa abre a nota no nfse.gov.br pela chave.
 *   Gerar o PDF no CRM fica para depois (o cupom da NFC-e também: a consulta é pelo QR Code ou no portal da SEFAZ-BA).
 * - NFC-e (Task 13): autorizada, o arquivo é o nfeProc (`nfce-{n}.xml`); antes disso, o pacote com a NFC-e enviada e a resposta.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/notas-fiscais/[id]">) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return text("não autorizado", 401);
  if (!can(user.perms, "nota.ver")) return text("sem permissão", 403);
  const { id } = await ctx.params;
  if (!isUuid(id)) return text("não encontrado", 404);
  const [d] = await db.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id));
  if (!d) return text("não encontrado", 404);
  const formato = req.nextUrl.searchParams.get("formato") ?? "xml";
  const nfce = d.kind === "nfce";
  if (formato === "pdf") {
    if (!d.accessKey) return text("A nota ainda não tem chave de acesso.", 404);
    return text(nfce ? `Consulte a NFC-e pelo QR Code ou no portal da SEFAZ-BA com a chave ${d.accessKey}.` : `Abra a nota no nfse.gov.br com a chave ${d.accessKey}.`, 501);
  }
  if (formato !== "xml") return text("Formato inválido: use xml ou pdf.", 400);
  const resp = d.responseBody ?? "";
  const file = { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${d.kind === "nfce" ? "nfce" : "nfse"}-${d.number}.xml"`, "cache-control": "no-store" };
  // NFC-e autorizada: o arquivo é o próprio nfeProc (a nota assinada + o protocolo), o que vale como a nota.
  if (nfce && resp.startsWith("<nfeProc")) return new Response(`<?xml version="1.0" encoding="UTF-8"?>${resp}`, { headers: file });
  const resposta = resp.trim().startsWith("<") ? noDecl(resp) : resp ? cdata(resp) : "";
  const enviado = nfce ? "nfe" : "dps";
  const xml = `<?xml version="1.0" encoding="UTF-8"?><notaFiscal numero="${d.number}" situacao="${attr(d.status)}"${d.accessKey ? ` chave="${attr(d.accessKey)}"` : ""}>`
    + `<${enviado}>${noDecl(d.requestXml ?? "")}</${enviado}><resposta>${resposta}</resposta></notaFiscal>`;
  return new Response(xml, { headers: file });
}
