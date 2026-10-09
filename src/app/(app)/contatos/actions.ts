"use server";
import { revalidatePath } from "next/cache";
import { assertUser } from "@/server/auth/session";
import { importClients, type ImportReport } from "@/server/domain/import";
import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";

export async function importClientsAction(form: FormData): Promise<{ ok: true; report: ImportReport } | { ok: false; error: string }> {
  try {
    const user = await assertUser("gestor");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Escolha um arquivo .csv." };
    if (file.size > 15 * 1024 * 1024) return { ok: false, error: "Arquivo grande demais (máximo 15 MB)." };
    const buf = Buffer.from(await file.arrayBuffer());
    let text = buf.toString("utf8");
    if (text.includes("�")) text = new TextDecoder("latin1").decode(buf); // Excel antigo salva em Latin-1
    const report = await importClients(text);
    if (report.missingPhoneColumn) return { ok: false, error: "Não achei a coluna de telefone. Use um cabeçalho como \"Telefone\" ou \"Celular\"." };
    await db.insert(auditLog).values({ userId: user.id, action: "importou", entity: "contacts", data: { ...report, invalid: report.invalid.length } });
    revalidatePath("/contatos");
    return { ok: true, report };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Falha na importação." }; }
}
