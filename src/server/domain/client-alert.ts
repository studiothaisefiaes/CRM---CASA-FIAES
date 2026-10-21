import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { auditLog, settings } from "../db/schema";
import { assertFuncao, getFuncoes } from "./funcoes";
import { NO_IMAGE_USE_MAX, NO_IMAGE_USE_TEXT, type ClientAlertConfig } from "@/lib/client-alert";

type Q = Tx | typeof db;
const KEY = "aviso_cliente";

/** Configurações › Aviso da cliente: onde o aviso salta e o texto de quem não autorizou uso de imagem (padrão = o sugerido). */
export type ClientAlertSettings = { noHorario: boolean; naComanda: boolean; textoSemUsoImagem: string };
export const CLIENT_ALERT_DEFAULTS: ClientAlertSettings = { noHorario: true, naComanda: true, textoSemUsoImagem: NO_IMAGE_USE_TEXT };

const patchSchema = z.object({
  noHorario: z.boolean().optional(),
  naComanda: z.boolean().optional(),
  /** Vazio = "Usar o texto sugerido". */
  textoSemUsoImagem: z.string().trim().max(NO_IMAGE_USE_MAX, `Use até ${NO_IMAGE_USE_MAX} caracteres.`).optional(),
}).strict();
export type ClientAlertPatch = z.input<typeof patchSchema>;

/** Valor ausente ou que não é verdadeiro/falso/texto → o padrão. */
export async function getClientAlertConfig(q: Q = db): Promise<ClientAlertSettings> {
  const raw = (await q.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)))[0]?.value;
  const v: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const texto = typeof v.textoSemUsoImagem === "string" ? v.textoSemUsoImagem.trim() : "";
  return {
    noHorario: typeof v.noHorario === "boolean" ? v.noHorario : CLIENT_ALERT_DEFAULTS.noHorario,
    naComanda: typeof v.naComanda === "boolean" ? v.naComanda : CLIENT_ALERT_DEFAULTS.naComanda,
    textoSemUsoImagem: texto || NO_IMAGE_USE_TEXT,
  };
}

/** Muda só o que veio; texto vazio volta ao sugerido. Função `aviso_salta`. */
export async function saveClientAlertConfig(patch: ClientAlertPatch, userId: string): Promise<ClientAlertSettings> {
  await assertFuncao("aviso_salta");
  const clean = patchSchema.parse(patch);
  return db.transaction(async (tx) => {
    const now = await getClientAlertConfig(tx);
    const texto = clean.textoSemUsoImagem !== undefined ? clean.textoSemUsoImagem.replace(/\s+/g, " ") : now.textoSemUsoImagem;
    const value = {
      noHorario: clean.noHorario ?? now.noHorario, naComanda: clean.naComanda ?? now.naComanda,
      textoSemUsoImagem: texto === NO_IMAGE_USE_TEXT ? "" : texto,
    };
    await tx.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: KEY, data: value });
    return getClientAlertConfig(tx);
  });
}

/** O que a tela precisa para o aviso saltar no horário ou na comanda: ligado (função + configuração do lugar) e o texto da linha do uso de imagem. */
export async function clientAlertFor(where: "horario" | "comanda", q: Q = db): Promise<ClientAlertConfig> {
  const [f, c] = await Promise.all([getFuncoes(q), getClientAlertConfig(q)]);
  return { on: f.aviso_salta && (where === "horario" ? c.noHorario : c.naComanda), text: c.textoSemUsoImagem };
}
