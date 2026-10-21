import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditLog, contactNotes, deals, libraryFiles, messages, outbox, settings, teams, users } from "../db/schema";
import { isOpen } from "@/lib/business-hours";
import {
  menuStep, menuTrail, welcomePathOf, welcomeSubmenuSource, welcomeText, WELCOME_MAX_OPTIONS, WELCOME_MIN_OPTIONS, WELCOME_REPLY_SOURCE, WELCOME_SOURCE,
  type MenuOption, type WelcomeConfig,
} from "@/lib/welcome-menu-flow";
import { getBusinessHours } from "./hours";
import { enqueueAutomated } from "./outbox";
import { addTag, TAG_MAX } from "./tags";
import { UserFacingError } from "./errors";
import { funcaoLigada } from "./funcoes";
import { canReceiveConversation } from "./team-scope";
import { listLibrary } from "./library";

export { WELCOME_MAX_OPTIONS, WELCOME_REPLY_SOURCE, WELCOME_SOURCE, welcomeText, type MenuOption, type WelcomeConfig };
export const WELCOME_SETTING = "menu_boas_vindas";
/** Depois disso a resposta não conta mais como escolha do menu. */
export const WELCOME_REPLY_WINDOW_MS = 24 * 3_600_000;
const REPLY_MAX = 1000;
const INTRO_MAX = 400;

const labelSchema = z.string().trim().min(1, "Escreva o nome da opção.").max(40, "Opção com no máximo 40 caracteres.");
const replySchema = z.object({
  text: z.string().trim().max(REPLY_MAX, `A resposta passou de ${REPLY_MAX.toLocaleString("pt-BR")} caracteres.`).nullish(),
  fileId: z.string().uuid("Escolha o arquivo de novo na Biblioteca.").nullish(),
}).nullish();
const passToSchema = z.union([z.object({ team: z.string().uuid("Escolha o setor de novo.") }), z.object({ user: z.string().uuid("Escolha a pessoa de novo.") })]).nullish();
const baseOption = { label: labelSchema, tag: z.string().trim().max(TAG_MAX).nullish(), reply: replySchema, passTo: passToSchema };
const replyFilled = (o: { label: string; reply?: { text?: string | null; fileId?: string | null } | null }, ctx: z.RefinementCtx) => {
  if (o.reply && !o.reply.text && !o.reply.fileId) ctx.addIssue({ code: "custom", message: `Escreva a resposta ou escolha um arquivo da opção “${o.label}”.`, path: ["reply"] });
};
/** Opção de dentro do submenu: não abre outro menu (no máximo 2 níveis). */
const leafSchema = z.object({ ...baseOption, submenu: z.unknown().optional() }).superRefine((o, ctx) => {
  if (o.submenu != null) ctx.addIssue({ code: "custom", message: "O menu tem no máximo 2 níveis.", path: ["submenu"] });
  replyFilled(o, ctx);
});
const submenuSchema = z.object({
  intro: z.string().trim().min(1, "Escreva a saudação do submenu.").max(INTRO_MAX, `A saudação do submenu passou de ${INTRO_MAX} caracteres.`),
  options: z.array(leafSchema).min(WELCOME_MIN_OPTIONS, `O submenu precisa de ${WELCOME_MIN_OPTIONS} a ${WELCOME_MAX_OPTIONS} opções.`).max(WELCOME_MAX_OPTIONS, `O submenu precisa de ${WELCOME_MIN_OPTIONS} a ${WELCOME_MAX_OPTIONS} opções.`),
});
const optionSchema = z.object({ ...baseOption, submenu: submenuSchema.nullish() }).superRefine(replyFilled);
export const welcomeSchema = z.object({
  enabled: z.boolean(),
  intro: z.string().trim().max(INTRO_MAX, `A saudação passou de ${INTRO_MAX} caracteres.`),
  options: z.array(optionSchema).max(WELCOME_MAX_OPTIONS, `No máximo ${WELCOME_MAX_OPTIONS} opções.`),
}).refine((v) => !v.enabled || (v.intro.length >= 3 && v.options.length >= WELCOME_MIN_OPTIONS), { message: "Para ligar, escreva a saudação e pelo menos 2 opções.", path: ["options"] });

type ParsedOption = z.infer<typeof leafSchema> | z.infer<typeof optionSchema>;
/** Grava sempre no formato inteiro (o antigo `{ label, tag }` é lido do mesmo jeito). */
const clean = (o: ParsedOption, deep: boolean): MenuOption => {
  const text = o.reply?.text || null, fileId = o.reply?.fileId || null;
  const sub = deep ? (o as z.infer<typeof optionSchema>).submenu : null;
  return {
    label: o.label, tag: o.tag || null,
    reply: text || fileId ? { text, fileId } : null,
    passTo: o.passTo ?? null,
    submenu: sub ? { intro: sub.intro, options: sub.options.map((x) => clean(x, false)) } : null,
  };
};

/** Setor ativo, pessoa que abre as Conversas e arquivo ainda na Biblioteca: o que o menu promete precisa existir ao salvar. */
async function assertTargets(options: MenuOption[]): Promise<void> {
  const all = options.flatMap((o) => [o, ...(o.submenu?.options ?? [])]);
  const teamIds = [...new Set(all.flatMap((o) => (o.passTo && "team" in o.passTo ? [o.passTo.team] : [])))];
  const userIds = [...new Set(all.flatMap((o) => (o.passTo && "user" in o.passTo ? [o.passTo.user] : [])))];
  const fileIds = [...new Set(all.flatMap((o) => (o.reply?.fileId ? [o.reply.fileId] : [])))];
  const [ts, us, fs] = await Promise.all([
    teamIds.length ? db.select({ id: teams.id, active: teams.active }).from(teams).where(inArray(teams.id, teamIds)) : [],
    userIds.length ? db.select({ id: users.id }).from(users).where(and(inArray(users.id, userIds), eq(users.active, true), canReceiveConversation())) : [],
    fileIds.length ? db.select({ id: libraryFiles.id }).from(libraryFiles).where(and(inArray(libraryFiles.id, fileIds), isNull(libraryFiles.deletedAt))) : [],
  ]);
  for (const o of all) {
    if (o.passTo && "team" in o.passTo) {
      const team = ts.find((t) => t.id === (o.passTo as { team: string }).team);
      if (!team) throw new UserFacingError(`A opção “${o.label}” passa para um setor que não existe mais. Escolha outro setor.`);
      if (!team.active) throw new UserFacingError(`A opção “${o.label}” passa para um setor desativado. Escolha outro setor.`);
    }
    if (o.passTo && "user" in o.passTo && !us.some((u) => u.id === (o.passTo as { user: string }).user))
      throw new UserFacingError(`A opção “${o.label}” passa para alguém que não está mais na equipe ou não abre as Conversas.`);
    if (o.reply?.fileId && !fs.some((f) => f.id === o.reply!.fileId)) throw new UserFacingError(`O arquivo da opção “${o.label}” saiu da Biblioteca. Escolha outro.`);
  }
}

export async function getWelcomeMenu(): Promise<WelcomeConfig> {
  const [r] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, WELCOME_SETTING));
  const v = (r?.value ?? {}) as Partial<WelcomeConfig>;
  return { enabled: v.enabled === true, intro: v.intro ?? "", options: Array.isArray(v.options) ? v.options : [] };
}
/** O que a tela oferece para "Passar para" e "Responder": setores ativos, quem abre as Conversas e os arquivos da Biblioteca. */
export async function welcomeMenuChoices(): Promise<{ teams: { id: string; name: string }[]; people: { id: string; name: string }[]; files: { id: string; name: string }[]; setoresLigada: boolean }> {
  const [ts, people, files, setoresLigada] = await Promise.all([
    db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.active, true)).orderBy(asc(teams.position), asc(teams.createdAt)),
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), canReceiveConversation())).orderBy(asc(users.name)),
    listLibrary().then((l) => l.map((f) => ({ id: f.id, name: f.name }))),
    funcaoLigada("setores"),
  ]);
  return { teams: ts, people, files, setoresLigada };
}

/** Salva (e liga/desliga). A confirmação "isto envia mensagens reais" é da tela; aqui fica a auditoria. */
export async function saveWelcomeMenu(input: unknown, userId: string): Promise<void> {
  const parsed = welcomeSchema.parse(input);
  const v: WelcomeConfig = { enabled: parsed.enabled, intro: parsed.intro, options: parsed.options.map((o) => clean(o, true)) };
  await assertTargets(v.options);
  const before = await getWelcomeMenu();
  await db.insert(settings).values({ key: WELCOME_SETTING, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: v.enabled !== before.enabled ? (v.enabled ? "ligou" : "desligou") : "editou", entity: "settings", entityId: WELCOME_SETTING, data: v as unknown as Record<string, unknown> });
}

/**
 * Número que escreve pela primeira vez na vida (o contato não tem nenhuma mensagem antes) com a Casa aberta: o menu entra na fila de envio.
 * Desligado por padrão. Com a Casa fechada, quem responde é a "resposta fora do horário" (nunca os dois).
 */
export async function maybeWelcomeMenu(dealId: string, at: Date, now = new Date()): Promise<boolean> {
  const cfg = await getWelcomeMenu();
  if (!cfg.enabled || cfg.options.length < 2) return false;
  if (!isOpen(now.getTime(), await getBusinessHours())) return false;
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  if (!d) return false;
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from messages where contact_id = ${d.contactId}`)).rows as { n: number }[];
  if (n !== 1) return false;
  await enqueueAutomated({ dealId, kind: "text", text: welcomeText(cfg), source: WELCOME_SOURCE, at });
  return true;
}

/**
 * A cliente respondeu ao menu (ou ao submenu) antes de alguém da equipe escrever. Para a opção escolhida, nesta ordem: etiqueta, nota para
 * quem atender, resposta (texto e/ou arquivo da Biblioteca, cada um um item na fila), passar para (setor ou pessoa) e submenu.
 * Frase que não é escolha ("tenho 2 filhas") não faz nada: a equipe atende. Uma escolha por menu: depois dela, o resto é conversa.
 * Pausa e consentimento valem na hora de sair da fila (processItem); etiqueta, nota e passar para são internas e valem sempre.
 */
export async function maybeWelcomeChoice(dealId: string, body: string | null | undefined, at: Date): Promise<{ option: number; path: number[] } | null> {
  const text = body?.trim();
  if (!text || text.length > 40) return null;
  const cfg = await getWelcomeMenu();
  if (!cfg.enabled) return null;
  const src = sql<string | null>`${outbox.options}->>'source'`;
  const [menu] = await db.select({ sentAt: outbox.sentAt, source: src }).from(outbox)
    .where(and(eq(outbox.dealId, dealId), eq(outbox.status, "sent"), sql`starts_with(coalesce(${src}, ''), ${WELCOME_SOURCE})`, sql`${src} <> ${WELCOME_REPLY_SOURCE}`))
    .orderBy(desc(outbox.sentAt)).limit(1);
  const path = welcomePathOf(menu?.source);
  if (!menu?.sentAt || !path || at.getTime() - menu.sentAt.getTime() > WELCOME_REPLY_WINDOW_MS) return null;
  // Alguém da equipe já escreveu depois do menu (pelo CRM ou pelo celular): a conversa já é com a pessoa.
  const [human] = await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.dealId, dealId), eq(messages.direction, "out"), or(isNotNull(messages.sentByUserId), eq(messages.fromPhone, true)), gt(messages.createdAt, menu.sentAt))).limit(1);
  if (human) return null;
  // Já escolheu neste menu: "2" depois disso é só mensagem.
  const [chosen] = await db.select({ id: contactNotes.id }).from(contactNotes)
    .where(and(eq(contactNotes.dealId, dealId), eq(contactNotes.source, "menu"), gte(contactNotes.createdAt, menu.sentAt))).limit(1);
  if (chosen) return null;
  const step = menuStep(cfg, path, text);
  if (step.kind === "nao_entendi") return null;
  const option = step.kind === "escolheu" ? step.option : cfg.options[step.path[0]];
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  if (!d || !option) return null;

  if (option.tag?.trim()) await addTag(d.contactId, option.tag.trim(), null);
  const trail = menuTrail(cfg, step.path).map((t) => `${t.n}. ${t.label}`).join(" › ");
  await db.insert(contactNotes).values({ contactId: d.contactId, dealId, authorName: "Menu de boas-vindas", source: "menu", body: `Escolheu no menu: ${trail}`, createdAt: at });
  // Um milissegundo entre os itens: a fila sai na ordem de chegada (texto, arquivo, submenu).
  let t = at.getTime();
  const replyText = option.reply?.text?.trim();
  if (replyText) await enqueueAutomated({ dealId, kind: "text", text: replyText, source: WELCOME_REPLY_SOURCE, at: new Date(t++) });
  if (option.reply?.fileId) {
    try { await enqueueAutomated({ dealId, kind: "media", fileId: option.reply.fileId, text: "", source: WELCOME_REPLY_SOURCE, at: new Date(t++) }); }
    catch (e) { console.error("[menu de boas-vindas] arquivo da resposta não entrou na fila", dealId, e instanceof Error ? e.message : e); }
  }
  // Passar para: nunca derruba o resto. Setores desligado (ou setor desativado depois de salvar): fica só a nota.
  if (option.passTo) {
    try {
      if ("team" in option.passTo) {
        if (await funcaoLigada("setores")) { const { passToTeam } = await import("./teams"); await passToTeam(dealId, option.passTo.team, null, at); }
      } else { const { transferDeal } = await import("./assign"); await transferDeal(dealId, option.passTo.user, null); }
    } catch (e) { console.error("[menu de boas-vindas] não passou a conversa", dealId, e instanceof Error ? e.message : e); }
  }
  if (step.kind === "submenu") await enqueueAutomated({ dealId, kind: "text", text: step.text, source: welcomeSubmenuSource(step.path[0]), at: new Date(t++) });
  return { option: step.path[step.path.length - 1] + 1, path: step.path };
}
