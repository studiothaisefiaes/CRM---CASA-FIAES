import { NextResponse, type NextRequest } from "next/server";
import { onClientHost } from "@/lib/client-host";
import { env } from "@/server/env";
import { allow } from "@/server/auth/rate-limit";
import { checkSecret } from "@/server/whatsapp/webhook";
import { importChatguruRecord, type ChatguruPayload } from "@/server/domain/chatguru-import";

/**
 * Recebe a ficha de um chat do ChatGuru (diálogo com a ação "CRM → Post para URL", rodado em cada chat por `dialog_execute`).
 * O ChatGuru não manda cabeçalho próprio: o segredo vai no link (?token=). Sem CHATGURU_IMPORT_SECRET a rota nem existe.
 */
export async function POST(req: NextRequest) {
  if (onClientHost(req.headers)) return new Response(null, { status: 404 }); // o domínio dos links da cliente só serve /c
  const secret = env().CHATGURU_IMPORT_SECRET;
  if (!secret) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  if (!checkSecret(req.nextUrl.searchParams.get("token"), secret)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  if (!allow("importar:chatguru", 600, 60_000)) return NextResponse.json({ error: "muitas requisições" }, { status: 429, headers: { "retry-after": "30" } });
  let payload: ChatguruPayload;
  try {
    const type = req.headers.get("content-type") ?? "";
    payload = type.includes("json") ? await req.json() : (Object.fromEntries(await req.formData()) as ChatguruPayload);
  } catch { return NextResponse.json({ error: "corpo inválido" }, { status: 400 }); }
  try {
    const r = await importChatguruRecord(payload);
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  } catch (e) {
    console.error("[importar chatguru] falhou", e);
    return NextResponse.json({ ok: false, error: "indisponível" }, { status: 503 });
  }
}
