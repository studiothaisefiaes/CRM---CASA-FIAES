import { and, eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { db } from "../db";
import { contacts, messages } from "../db/schema";
import { ensureMedia } from "../whatsapp/media";
import { UserFacingError } from "./errors";
import { assertFuncaoLigada, funcaoParam, funcaoTexto } from "./funcoes";
import { sendFromCrm, sendMediaFromCrm } from "./send";
import { stripSignature } from "@/lib/signature";
import { deals } from "../db/schema";

/** Padrão do número de destinos (o valor que vale está em Configurações › Recursos › Encaminhar mensagem, `max_destinos`). */
export const FORWARD_MAX = 10;
const KINDS = ["text", "image", "video", "audio", "document"] as const;
const GONE: Record<string, string> = { image: "Essa foto", video: "Esse vídeo", audio: "Esse áudio", document: "Esse documento" };
const WHEN = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia", hourCycle: "h23" });
const when = (d: Date) => WHEN.format(d).replace(", ", " às ").replace(/^(\d\d\/\d\d) (\d)/, "$1 $2");

/**
 * Encaminha uma mensagem (texto, foto, vídeo, áudio ou documento) para até `max_destinos` conversas.
 * Para conversa de Equipe vai com o cabeçalho "Encaminhada da conversa com {nome}, {data}:"; para cliente vai só o conteúdo,
 * sem nome nem telefone de origem. Um destino que falha não impede os outros. A permissão e o escopo são conferidos pela action.
 */
export async function forwardMessage(messageId: string, toDealIds: string[], userId: string): Promise<{ sent: number; failed: { dealId: string; error: string }[] }> {
  await assertFuncaoLigada("encaminhar");
  const max = await funcaoParam("encaminhar", "max_destinos");
  const targets = [...new Set(toDealIds)];
  if (!targets.length) throw new UserFacingError("Escolha para quem encaminhar.");
  if (targets.length > max) throw new UserFacingError(`Dá para encaminhar para até ${max} conversas de uma vez.`);
  const [row] = await db.select({ m: messages, name: contacts.name, phone: contacts.phoneE164 }).from(messages).innerJoin(contacts, eq(contacts.id, messages.contactId)).where(eq(messages.id, messageId));
  if (!row) throw new UserFacingError("Mensagem não encontrada.");
  const m = row.m;
  if (m.deletedAt || !(KINDS as readonly string[]).includes(m.kind)) throw new UserFacingError("Essa mensagem não pode ser encaminhada.");
  const text = m.direction === "out" ? stripSignature(m.body).trim() : (m.body ?? "").trim();
  let file: { name: string; mime: string; data: Buffer } | null = null;
  if (m.kind !== "text") {
    const gone = `${GONE[m.kind]} não está mais guardad${m.kind === "image" || m.kind === "audio" ? "a" : "o"} no sistema.`;
    if (m.mediaPurgedAt) throw new UserFacingError(gone);
    const f = await ensureMedia(m.id);
    if (!f) throw new UserFacingError(gone);
    try { file = { name: f.name, mime: f.mime, data: await readFile(f.file) }; } catch { throw new UserFacingError(gone); }
  }
  const nome = row.name?.trim() || row.phone;
  const header = (await funcaoTexto("encaminhar", "cabecalho_equipe")).replaceAll("{nome}", nome).replaceAll("{data}", when(m.createdAt));
  const out = { sent: 0, failed: [] as { dealId: string; error: string }[] };
  for (const dealId of targets) {
    try {
      const [d] = await db.select({ kind: contacts.kind }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(and(eq(deals.id, dealId)));
      if (!d) throw new UserFacingError("Conversa não encontrada.");
      const team = d.kind === "equipe";
      if (!file) await sendFromCrm(dealId, team ? `${header}\n${text}` : text, userId);
      else if (m.kind === "audio") {
        if (team) await sendFromCrm(dealId, header, userId); // áudio não aceita legenda
        await sendMediaFromCrm(dealId, file, null, userId);
      } else {
        // Documento sem legenda própria mostra o nome do arquivo; a legenda da foto/vídeo acompanha.
        const own = m.kind === "document" ? null : text || null;
        await sendMediaFromCrm(dealId, file, team ? [header, own].filter(Boolean).join("\n") : own, userId);
      }
      out.sent++;
    } catch (e) {
      out.failed.push({ dealId, error: e instanceof Error ? e.message : "Não foi possível encaminhar." });
    }
  }
  return out;
}
