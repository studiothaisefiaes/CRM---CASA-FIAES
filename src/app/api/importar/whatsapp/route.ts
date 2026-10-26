import type { NextRequest } from "next/server";
import { onClientHost } from "@/lib/client-host";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { crossSite, SESSION_EXPIRED_TEXT } from "@/server/auth/route-user";
import { findSessionUser } from "@/server/auth/sessions-store";
import { userErrorMessage } from "@/server/user-error";
import { discardUpload, previewWhatsappImport, stashUpload, ZAP_MAX_BYTES } from "@/server/domain/whatsapp-import";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const TOO_BIG = "O arquivo passa de 50 MB. Exporte sem mídia ou envie só o .txt.";

/**
 * Upload do "Exportar conversa" do WhatsApp (.zip ou .txt, até 50 MB) e a prévia. Rota e não Server Action: as actions param em 70 MB e este upload tem limite e conferência próprios.
 * Fica fora do proxy (matcher exclui api/importar), então confere aqui sessão, permissão e origem. Só gestão (Configurações do sistema)
 * ou quem mexe na ficha da cliente. Nada é gravado na conversa: o arquivo fica numa pasta temporária até Importar (ou 2 h).
 */
export async function POST(req: NextRequest) {
  if (onClientHost(req.headers)) return new Response(null, { status: 404 }); // o domínio dos links da cliente só serve /c
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return json({ ok: false, error: SESSION_EXPIRED_TEXT }, 401);
  if (!can(user.perms, "config.sistema") && !can(user.perms, "contatos.importar")) return json({ ok: false, error: "Sem permissão para trazer conversas." }, 403);
  if (crossSite(req)) return json({ ok: false, error: "Pedido de outro site." }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > ZAP_MAX_BYTES + 1024 * 1024) return json({ ok: false, error: TOO_BIG }, 413);
  let token: string | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File) || !f.size) return json({ ok: false, error: "Escolha o arquivo .zip ou .txt da conversa." }, 400);
    if (f.size > ZAP_MAX_BYTES) return json({ ok: false, error: TOO_BIG }, 413);
    if (!/\.(zip|txt)$/i.test(f.name)) return json({ ok: false, error: "Envie o .zip ou o .txt que o WhatsApp gerou em \"Exportar conversa\"." }, 400);
    const contactId = String(form.get("contactId") ?? "");
    token = await stashUpload(user.id, f.name, new Uint8Array(await f.arrayBuffer()));
    const preview = await previewWhatsappImport(token, user.id, { fixedContactId: isUuid(contactId) ? contactId : null });
    return json({ ok: true, data: preview });
  } catch (e) {
    if (token) await discardUpload(token);
    return json({ ok: false, error: userErrorMessage(e, "importar-whatsapp") }, 400);
  }
}
