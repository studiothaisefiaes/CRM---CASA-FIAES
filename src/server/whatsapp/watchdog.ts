import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels } from "../db/schema";
import { emit } from "../domain/events";
import { whatsapp } from "./evolution";

/** Tempo preso sem conexão (reconectando, rede caída) até avisar a gestão. */
export const STUCK_MINUTES = 5;
const badSince = new Map<string, number>();

/**
 * Worker, a cada minuto: confere na Evolution se cada número "conectado" está mesmo aberto.
 * Falha silenciosa que pegamos em 09/10: o número ficou mais de 1 h reconectando e o painel dizia "conectado".
 */
export async function checkConnections(now = new Date()) {
  const rows = await db.select().from(channels).where(inArray(channels.status, ["conectado", "erro"]));
  const result: { name: string; state: string }[] = [];
  for (const c of rows) {
    let state: string;
    try { state = await whatsapp().state(c.instanceName); } catch { state = "sem_resposta"; }
    result.push({ name: c.name, state });
    if (state === "conectado") {
      badSince.delete(c.id);
      if (c.status === "erro") { await db.update(channels).set({ status: "conectado" }).where(eq(channels.id, c.id)); await emit("canal_atualizado", { instance: c.instanceName, status: "conectado" }); }
      continue;
    }
    if (!badSince.has(c.id)) badSince.set(c.id, now.getTime());
    const minutes = (now.getTime() - badSince.get(c.id)!) / 60_000;
    if (minutes >= STUCK_MINUTES && c.status === "conectado") {
      await db.update(channels).set({ status: "erro" }).where(eq(channels.id, c.id));
      await db.insert(alerts).values({
        audience: "gestao", type: "whatsapp_sem_conexao", severity: "urgente",
        message: `O WhatsApp "${c.name}" está sem conexão há ${Math.round(minutes)} min: mensagens novas não estão chegando. Confira a internet do servidor ou leia o QR code de novo em Configurações › WhatsApp.`,
        dedupeKey: `sem_conexao:${c.id}:${new Date(badSince.get(c.id)!).toISOString().slice(0, 16)}`,
      }).onConflictDoNothing();
      await emit("canal_atualizado", { instance: c.instanceName, status: "erro" });
    }
  }
  return result;
}
