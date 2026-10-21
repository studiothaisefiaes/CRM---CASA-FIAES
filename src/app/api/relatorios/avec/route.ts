import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { canSeeAvecReports } from "@/lib/permissions";
import { readXlsx } from "@/server/domain/avec/xlsx";
import { applyAvecFiles, type AvecFileInput } from "@/server/domain/avec/apply";
import { emptySummary } from "@/server/domain/avec/context";
import { checkUpload, MAX_TOTAL_BYTES, type AvecUploadFile, type AvecUploadResult } from "@/components/relatorios-avec/format";

export const maxDuration = 300;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * "Enviar relatórios do Avec": recebe vários .xlsx (campo `files`), lê cada um, saneia, guarda e aplica os importadores
 * (applyAvecFiles: transação por arquivo, idempotente). Um arquivo com problema volta com `error` e não para os outros.
 */
export async function POST(req: NextRequest) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return json({ error: "Sua sessão expirou. Entre de novo." }, 401);
  if (!canSeeAvecReports(user.perms)) return json({ error: "Você não tem permissão para isso." }, 403);
  // Mesma checagem das Server Actions: envio vindo de outro site (Origin diferente do endereço do CRM) é recusado.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && (() => { try { return new URL(origin).host !== host; } catch { return true; } })()) return json({ error: "Envio recusado: abra o CRM pelo endereço de sempre." }, 403);
  // Folga de 1 MB para o envelope do multipart; acima disso nem lê.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_TOTAL_BYTES + 1024 * 1024) return json({ error: checkUpload([{ name: "x.xlsx", size: MAX_TOTAL_BYTES + 1 }]) }, 413);

  let files: File[];
  try { files = (await req.formData()).getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f); }
  catch { return json({ error: "Não deu para ler o envio. Tente de novo." }, 400); }
  const invalid = checkUpload(files.map((f) => ({ name: f.name, size: f.size })));
  if (invalid) return json({ error: invalid }, 400);

  const inputs: AvecFileInput[] = [];
  const unreadable: AvecUploadFile[] = [];
  for (const f of files) {
    try { inputs.push({ fileName: f.name, rows: await readXlsx(new Uint8Array(await f.arrayBuffer())), userId: user.id }); }
    catch {
      unreadable.push({ fileName: f.name, reportId: null, title: "", rowCount: 0, newReport: false, removedColumns: [], summary: emptySummary(),
        error: "Não deu para abrir: o arquivo não parece um .xlsx do Avec. Exporte de novo e tente outra vez." });
    }
  }
  const batch = inputs.length ? await applyAvecFiles(inputs) : { files: [], summary: emptySummary(), funil: undefined };
  const result: AvecUploadResult = {
    summary: batch.summary,
    files: [
      ...batch.files.map(({ fileName, reportId, title, rowCount, newReport, removedColumns, summary, error }) => ({ fileName, reportId, title, rowCount, newReport, removedColumns, summary, error })),
      ...unreadable,
    ],
    funil: batch.funil,
  };
  return json(result);
}
