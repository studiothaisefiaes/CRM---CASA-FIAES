import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../../db";
import { auditLog, lists, settings } from "../../db/schema";
import { UserFacingError } from "../errors";
import { normalizePhone } from "../phone";
import { DEFAULT_REMINDER_TEXT, DEFAULT_RESCHEDULED_TEXT, effectiveText, LEGACY_REMINDER_TEXTS, LEGACY_RESCHEDULED_TEXTS } from "@/lib/reminder-d1";

/**
 * Texto modelo do link (seção 9.4.10), editável em Configurações › Página da cliente. 21/10: no mesmo desenho do lembrete (data e hora
 * cada uma na sua linha, só elas em negrito).
 */
export const DEFAULT_LINK_TEXT = [
  "Olá, {primeiro_nome}! 💛", "", "Seu horário na Casa Fiaes:", "", "📅 *{data}*", "⏰ às *{hora}*", "✨ {servicos}", "",
  "Para confirmar ou remarcar, é só tocar aqui: {link}",
].join("\n");
/** O modelo de antes: salvo sem mudança, vale o de hoje. */
const LEGACY_LINK_TEXTS = ["Oi, {primeiro_nome}! Seu horário na Casa Fiaes: {data} às {hora} ({servicos}). Para confirmar ou remarcar, é só tocar aqui: {link}"];
export { DEFAULT_REMINDER_TEXT, DEFAULT_RESCHEDULED_TEXT, LINK_SUFFIX } from "@/lib/reminder-d1";

/** `mapa` (Fase B): o link do mapa que vai na confirmação da véspera; vazio = a busca do endereço no Maps. */
export type CasaInfo = { endereco: string | null; whatsapp: string | null; mapa: string | null; latitude: number | null; longitude: number | null };
export type ClientLinkSettings = { cancelarAteHoras: number; texto: string };
export type LembreteD1 = { enabled: boolean; comLink: boolean; texto: string; textoRemarcado: string };
export type OnlineBooking = { enabled: boolean; antecedenciaMin: number; diasAFrente: number; servicos: string[]; profissionais: string[] };

type Q = Tx | typeof db;
const read = async (q: Q, key: string) => (await q.select({ value: settings.value }).from(settings).where(eq(settings.key, key)))[0]?.value as Record<string, unknown> | undefined;
const write = async (key: string, value: unknown, userId: string, action = "editou") => {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action, entity: "settings", entityId: key, data: value as Record<string, unknown> });
};

const textSchema = z.string().trim().min(10, "Escreva o texto (pelo menos 10 caracteres).").max(600, "Use até 600 caracteres.");
export const casaInfoSchema = z.object({
  endereco: z.string().trim().max(200, "Use até 200 caracteres no endereço.").nullable().transform((s) => s || null),
  whatsapp: z.string().trim().max(30).nullable().transform((s, ctx) => {
    if (!s) return null;
    const p = normalizePhone(s);
    if (!p) { ctx.addIssue({ code: "custom", message: "WhatsApp inválido. Use DDD + número." }); return z.NEVER; }
    return p;
  }),
  mapa: z.string().trim().max(300, "Use até 300 caracteres no link do mapa.").nullish().transform((s) => s || null)
    .refine((s) => !s || /^https:\/\/\S+$/.test(s), "O link do mapa começa com https://"),
  /** Pino da Casa ("Como chegar" na conversa). Os dois juntos ou nenhum. */
  latitude: z.number().min(-90, "Latitude de -90 a 90.").max(90, "Latitude de -90 a 90.").nullish().transform((n) => n ?? null),
  longitude: z.number().min(-180, "Longitude de -180 a 180.").max(180, "Longitude de -180 a 180.").nullish().transform((n) => n ?? null),
}).refine((v) => (v.latitude === null) === (v.longitude === null), { message: "Preencha latitude e longitude juntas, ou deixe as duas vazias.", path: ["latitude"] });
export const clientLinkSchema = z.object({ cancelarAteHoras: z.number().int().min(0, "Use de 0 a 168 horas.").max(168, "Use de 0 a 168 horas."), texto: textSchema });
export const lembreteSchema = z.object({ enabled: z.boolean(), comLink: z.boolean(), texto: textSchema, textoRemarcado: textSchema });
export const onlineSchema = z.object({
  enabled: z.boolean(), antecedenciaMin: z.number().int().min(0).max(1440), diasAFrente: z.number().int().min(1).max(90),
  servicos: z.array(z.string().uuid()).max(200), profissionais: z.array(z.string().uuid()).max(100),
});

/** Endereço e WhatsApp da Casa na página da cliente. Sem endereço, a página não mostra "Como chegar". */
export async function getCasaInfo(q: Q = db): Promise<CasaInfo> {
  const v = await read(q, "casa_info");
  const str = (x: unknown) => (typeof x === "string" && x ? x : null);
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const lat = num(v?.latitude), lng = num(v?.longitude);
  const pin = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return { endereco: str(v?.endereco), whatsapp: str(v?.whatsapp), mapa: str(v?.mapa), latitude: pin ? lat : null, longitude: pin ? lng : null };
}
export async function getClientLinkSettings(q: Q = db): Promise<ClientLinkSettings> {
  const v = await read(q, "cliente_link");
  const h = Number(v?.cancelarAteHoras);
  return { cancelarAteHoras: v?.cancelarAteHoras != null && Number.isInteger(h) && h >= 0 && h <= 168 ? h : 24, texto: effectiveText(v?.texto, DEFAULT_LINK_TEXT, LEGACY_LINK_TEXTS) };
}
export async function getLembreteD1(q: Q = db): Promise<LembreteD1> {
  const v = await read(q, "lembrete_d1");
  // Texto salvo igual a um padrão antigo (a tela salva o texto inteiro, mesmo sem mudança) vale o padrão de hoje; o personalizado fica.
  return { enabled: v?.enabled === true, comLink: v?.comLink === true, texto: effectiveText(v?.texto, DEFAULT_REMINDER_TEXT, LEGACY_REMINDER_TEXTS),
    textoRemarcado: effectiveText(v?.textoRemarcado, DEFAULT_RESCHEDULED_TEXT, LEGACY_RESCHEDULED_TEXTS) };
}
export async function getOnlineBooking(q: Q = db): Promise<OnlineBooking> {
  const p = onlineSchema.safeParse(await read(q, "agendamento_online"));
  return p.success ? p.data : { enabled: false, antecedenciaMin: 60, diasAFrente: 40, servicos: [], profissionais: [] };
}

export async function saveCasaInfo(input: unknown, userId: string) { await write("casa_info", casaInfoSchema.parse(input), userId); }
export async function saveClientLinkSettings(input: unknown, userId: string) { await write("cliente_link", clientLinkSchema.parse(input), userId); }
/** Ligar o agendamento online abre a página /agendar para qualquer pessoa: fica registrado quem ligou. */
export async function saveOnlineBooking(input: unknown, userId: string) {
  const v = onlineSchema.parse(input);
  // 18/10 (QA r58, I-5): ligado sem serviço publicava uma página vazia. Sem duração o serviço não aparece no site, então não conta.
  if (v.enabled) {
    if (!v.servicos.length) throw new UserFacingError("Escolha ao menos um serviço.");
    const ok = await db.select({ id: lists.id }).from(lists)
      .where(and(inArray(lists.id, v.servicos), eq(lists.kind, "service"), eq(lists.active, true), isNotNull(lists.durationMin))).limit(1);
    if (!ok.length) throw new UserFacingError("Escolha ao menos um serviço com duração.");
  }
  const before = await getOnlineBooking();
  await write("agendamento_online", v, userId, v.enabled !== before.enabled ? (v.enabled ? "ligou" : "desligou") : "editou");
}
