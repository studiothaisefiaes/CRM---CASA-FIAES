"use server";
import { revalidatePath } from "next/cache";
import * as distribution from "@/server/domain/distribution";
import * as profiles from "@/server/domain/profiles";
import { createContadorLink, revokeContadorLink } from "@/server/domain/contador-link";
import type { Perm } from "@/lib/permissions";
import { z } from "zod";
import { setSuggestedReturnSetting } from "@/server/domain/suggested-return";
import { setStrictScope } from "@/server/domain/deal-scope";
import { assertAnyPerm, assertPerm } from "@/server/auth/session";
import * as cfg from "@/server/domain/config";
import type { AutomationInput } from "@/server/rules/types";
import * as sources from "@/server/domain/sources";
import * as msg from "@/server/domain/messaging-settings";
import * as pros from "@/server/domain/professionals";
import * as tagAdmin from "@/server/domain/tags";
import * as stageAdmin from "@/server/domain/stage-admin";
import * as autoMsg from "@/server/domain/auto-message-settings";
import { saveAgendaSettings } from "@/server/domain/agenda/mode";
import { acceptSuggestions } from "@/server/domain/agenda/who-does-what";
import { saveRepetirConfig } from "@/server/domain/agenda/recurrence";
import { env } from "@/server/env";
import { userErrorMessage } from "@/server/user-error";
import { PAYOUT_PERIODS } from "@/lib/payout-period";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
/** Erro para a tela: as regras do zod (todas) e o texto do domínio; SQL, rede e bugs vão para o log e viram "Não deu certo. Tente de novo." */
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : userErrorMessage(e, "config") });
type ConfigPerm = Extract<Perm, "config.diaadia" | "config.sistema" | "equipe.gerir" | "servicos.editar">;
/** Lote 4: cada action escolhe a permissão (dia a dia, sistema ou equipe). Sem padrão, para nenhuma ficar com a errada. */
const DIA = "config.diaadia" as const, SIS = "config.sistema" as const, EQ = "equipe.gerir" as const;
/** Serviço (preço, cadastro e quem faz): o mesmo "Mudar serviços e preços" da aba Serviços, não o dia a dia (revisão de segurança 17/10, M2). */
const SERV = "servicos.editar" as const;
const listPerm = (kind: string | null | undefined): ConfigPerm => (kind === "service" ? SERV : DIA);
async function run<T>(fn: (uid: string) => Promise<T>, path: string, perm: ConfigPerm): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath(path); return { ok: true, data }; } catch (e) { return fail(e); }
}

export const updateStageAction = async (id: string, v: Parameters<typeof cfg.updateStage>[1]) => run((u) => cfg.updateStage(id, v, u), "/config/etapas", SIS);
export const saveHoursAction = async (v: unknown) => run((u) => cfg.saveBusinessHours(v, u), "/config/etapas", SIS);
export const moveStageAction = async (id: string, dir: -1 | 1) => run((u) => cfg.moveStage(id, dir, u), "/config/etapas", SIS);
/** `confirmouEnvio`: a tela mostrou o aviso de envio real (SendConfirmDialog) e a pessoa confirmou; sem ele, ligar regra que envia é recusado. */
export const saveAutomationAction = async (id: string | null, v: AutomationInput, opts?: { confirmouEnvio?: boolean }) =>
  run((u) => cfg.saveAutomation(id, v, u, { confirmouEnvio: opts?.confirmouEnvio === true }), "/config/automacoes", SIS);
export const toggleAutomationAction = async (id: string, on: boolean, opts?: { confirmouEnvio?: boolean }) =>
  run((u) => cfg.toggleAutomation(id, on, u, { confirmouEnvio: opts?.confirmouEnvio === true }), "/config/automacoes", SIS);
export const restoreAutomationAction = async (id: string, v: number) => run((u) => cfg.restoreAutomation(id, v, u), "/config/automacoes", SIS);
export const deleteAutomationAction = async (id: string) => run((u) => cfg.deleteAutomation(id, u), "/config/automacoes", SIS);
export const automationDetailsAction = async (id: string) => run(() => cfg.automationDetails(id).then((d) => JSON.parse(JSON.stringify(d)) as Awaited<ReturnType<typeof cfg.automationDetails>>), "/config/automacoes", SIS);
export const previewAutomationAction = async (v: AutomationInput) => run(() => cfg.previewAutomation(v), "/config/automacoes", SIS);
export const addListItemAction = async (kind: (typeof cfg.listKinds)[number], label: string, body: string | null) => run((u) => cfg.addListItem(kind, label, body, u), "/config/listas", listPerm(kind));
export async function updateListItemAction(id: string, label: string, body: string | null, active: boolean): Promise<R> {
  try {
    await assertAnyPerm(DIA, SERV);
    const u = await assertPerm(listPerm(await cfg.listItemKind(z.string().uuid().parse(id))));
    await cfg.updateListItem(id, label, body, active, u.id);
    revalidatePath("/config/listas");
    return { ok: true };
  } catch (e) { return fail(e); }
}
export const setKeywordBoostAction = async (id: string, boost: boolean) => run((u) => cfg.setKeywordBoost(id, boost, u), "/config/listas", DIA);
export const createChannelAction = async (name: string) => run((u) => cfg.createChannel(name, u).then((c) => ({ id: c.id })), "/config/whatsapp", SIS);
export const channelQrAction = async (id: string) => run(() => cfg.channelQr(id), "/config/whatsapp", SIS);
export const channelStateAction = async (id: string) => run(() => cfg.channelState(id), "/config/whatsapp", SIS);
export const disconnectChannelAction = async (id: string, remove: boolean) => run((u) => cfg.disconnectChannel(id, remove, u), "/config/whatsapp", SIS);
export const inviteMemberAction = async (v: { name: string; email: string; profileId: string }) =>
  run(async (u) => `${env().APP_URL}/convite/${await profiles.inviteWithProfile(v, u)}`, "/config/equipe", EQ);
/** Link do contador (26/10): o endereço volta UMA vez (no banco, só o hash). Uso único, 7 dias, perfil Contador. */
export const createContadorLinkAction = async () =>
  run(async (u) => { const l = await createContadorLink(u); return { id: l.id, url: `${env().APP_URL}/convite/${l.token}`, expiresAt: l.expiresAt.toISOString() }; }, "/config/equipe", EQ);
export const revokeContadorLinkAction = async (id: string) => run((u) => revokeContadorLink(id, u), "/config/equipe", EQ);
export const setMemberProfileAction = async (id: string, profileId: string) => run((u) => profiles.setMemberProfile(id, profileId, u), "/config/equipe", EQ);
export const setMemberActiveAction = async (id: string, active: boolean) => run((u) => profiles.setMemberActive(id, active, u), "/config/equipe", EQ);
export const saveProfileAction = async (v: { id?: string; name: string; permissions: string[] }) => run((u) => profiles.saveProfile(v, u), "/config/equipe", EQ);
export const duplicateProfileAction = async (id: string) => run((u) => profiles.duplicateProfile(id, u), "/config/equipe", EQ);
export const deleteProfileAction = async (id: string) => run((u) => profiles.deleteProfile(id, u), "/config/equipe", EQ);
export const saveDistributionAction = async (v: { enabled: boolean; limit: number }) => run((u) => distribution.saveDistributionSettings(v, u), "/config/distribuicao", SIS);
export const setPriorityLevelAction = async (userId: string, level: number) => run((u) => distribution.setPriorityLevel(userId, level, u), "/config/distribuicao", DIA);
export const createSourceAction = async (v: Parameters<typeof sources.createSource>[0]) => run((u) => sources.createSource(v, u), "/config/origens", DIA);
export const setSourceActiveAction = async (id: string, active: boolean) => run((u) => sources.setSourceActive(id, active, u), "/config/origens", DIA);

/* ---------- Mensagens automáticas, teto, retenção e ciclo (texto de erro fixo: nada de e.message cru) ---------- */
async function runSafe<T>(fn: (uid: string) => Promise<T>, path: string, fallback: string, perm: ConfigPerm): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath(path); return { ok: true, data }; } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? fallback };
    if (e instanceof Error && /sessão expirou|não tem permissão|não encontrad/i.test(e.message)) return { ok: false, error: e.message };
    console.error("[config]", fallback, e);
    return { ok: false, error: fallback };
  }
}
export const saveAutoReplyAction = async (v: unknown) => runSafe((u) => msg.saveAutoReply(v, u), "/config/mensagens", "Não deu para salvar a resposta fora do horário. Tente de novo.", SIS);
export const saveSendCapAction = async (v: unknown) => runSafe((u) => msg.saveSendCap(v, u), "/config/whatsapp", "Não deu para salvar o limite por hora. Tente de novo.", SIS);
export const saveMediaRetentionAction = async (v: unknown) => runSafe((u) => msg.saveMediaRetention(v, u), "/config/whatsapp", "Não deu para salvar o prazo de guarda das mídias. Tente de novo.", SIS);
export const saveServiceCycleDaysAction = async (id: string, v: unknown) => runSafe((u) => msg.saveServiceCycleDays(id, v, u), "/config/listas", "Não deu para salvar o lembrete de retorno. Tente de novo.", DIA);

/* Profissionais (quem faz cada serviço; escolhida ao Agendar). */
const proSchema = z.object({ name: z.string().max(200), fullName: z.string().max(300).nullish(), role: z.string().max(200).nullish(), serviceIds: z.array(z.string().uuid()).max(100) });
const proPatch = z.object({ name: z.string().max(200).optional(), fullName: z.string().max(300).nullish(), role: z.string().max(200).nullish(), serviceIds: z.array(z.string().uuid()).max(100).optional(), active: z.boolean().optional(), force: z.boolean().optional(), assistantOf: z.string().uuid().nullish(), bond: z.enum(["parceira", "clt", "outro"]).nullish(), cnpj: z.string().max(30).nullish(), legalName: z.string().max(300).nullish(), payoutPeriod: z.enum(PAYOUT_PERIODS).optional() });
/** Dados da profissional: dia a dia. Os serviços que ela faz (quem faz o quê) pedem também "Mudar serviços e preços". */
export const createProfessionalAction = async (v: z.input<typeof proSchema>) => run(async (u) => {
  const p = proSchema.parse(v);
  if (p.serviceIds.length) await assertPerm(SERV);
  return pros.createProfessional(p, u);
}, "/config/profissionais", DIA);
export const updateProfessionalAction = async (id: string, v: z.input<typeof proPatch>) => run(async (u) => {
  const p = proPatch.parse(v);
  if (p.serviceIds !== undefined) await assertPerm(SERV);
  if (p.payoutPeriod !== undefined) await assertPerm("comissao.pagar"); // período do repasse: quem paga a comissão (Fase A)
  return pros.updateProfessional(z.string().uuid().parse(id), p, u);
}, "/config/profissionais", DIA);
/* Lote 6A: horário de trabalho (null = igual ao da Casa; o domínio valida), cor e ordem, quem faz o quê e as sugestões do Avec. */
const appearance = z.object({ color: z.string().max(40).nullish(), agendaPosition: z.number().int().nullish() });
const pairs = z.object({ professionalId: z.string().uuid().nullish(), pairs: z.array(z.object({ professionalId: z.string().uuid(), serviceId: z.string().uuid() })).max(5000).optional() });
export const setWorkHoursAction = async (id: string, hours: unknown) => run((u) => pros.setWorkHours(z.string().uuid().parse(id), hours, u), "/config/profissionais", DIA);
export const setAppearanceAction = async (id: string, v: z.input<typeof appearance>) => run((u) => pros.setAppearance(z.string().uuid().parse(id), appearance.parse(v), u), "/config/profissionais", DIA);
export const setProfessionalServiceAction = async (professionalId: string, serviceId: string, on: boolean) =>
  run((u) => pros.setProfessionalService(z.string().uuid().parse(professionalId), z.string().uuid().parse(serviceId), z.boolean().parse(on), u), "/config/profissionais", SERV);
export const acceptSuggestionsAction = async (v: z.input<typeof pairs>) => run((u) => acceptSuggestions(pairs.parse(v), u), "/config/profissionais", SERV);

/* Agenda (Lote 6A): modo (consulta, dupla, só CRM) e passo. O domínio valida os valores. Configuração do sistema (Lote 4). */
const agendaSettings = z.object({ mode: z.enum(["consulta", "dupla", "so_crm"]), passoMin: z.number().int() });
export const saveAgendaSettingsAction = async (v: z.input<typeof agendaSettings>) => run((u) => saveAgendaSettings(agendaSettings.parse(v), u), "/config/agenda", SIS);
/* Repetir horário (Fase C, item 23a): os limites da Casa. Limite da agenda é configuração do sistema; o domínio confere a função e as faixas. */
const repetirSettings = z.object({ maxSemanas: z.number().int(), maxVezes: z.number().int() }).strict();
export const saveRepetirConfigAction = async (v: z.input<typeof repetirSettings>) => run((u) => saveRepetirConfig(repetirSettings.parse(v), u), "/config/agenda", SIS);

/* Acesso direto (sem convite): a gestão cria e-mail e senha e passa para a pessoa. */
export const createMemberAction = async (v: { name: string; email: string; password: string; profileId: string }) =>
  run((u) => profiles.createMember(v, u).then((m) => ({ id: m.id, email: m.email })), "/config/equipe", EQ);
/** Pede a senha de quem está trocando (revisão de segurança 17/10, M3). */
export const resetMemberPasswordAction = async (id: string, password: string, currentPassword: string) =>
  run((u) => profiles.resetMemberPassword(z.string().uuid().parse(id), password, u, z.string().max(200).parse(currentPassword ?? "")), "/config/equipe", EQ);
export const setMemberSignatureAction = async (id: string, signature: string) =>
  run((u) => profiles.setMemberSignature(z.string().uuid().parse(id), signature, u), "/config/equipe", EQ);

/* Etiquetas (dia a dia). */
export const renameTagAction = async (id: string, name: string) => run((u) => tagAdmin.renameTag(z.string().uuid().parse(id), name, u), "/config/etiquetas", DIA);
export const setTagColorAction = async (id: string, color: string | null) => run((u) => tagAdmin.setTagColor(z.string().uuid().parse(id), color, u), "/config/etiquetas", DIA);
export const mergeTagsAction = async (fromId: string, intoId: string) =>
  run((u) => tagAdmin.mergeTags(z.string().uuid().parse(fromId), z.string().uuid().parse(intoId), u), "/config/etiquetas", DIA);

/* Etapas: criar, apagar e quem vê (sistema). */
export const createStageAction = async (v: z.input<typeof stageAdmin.stageCreateSchema>) => run((u) => stageAdmin.createStage(v, u), "/config/etapas", SIS);
export const deleteStageAction = async (id: string) => run((u) => stageAdmin.deleteStage(z.string().uuid().parse(id), u), "/config/etapas", SIS);
export const setStageProfilesAction = async (id: string, profileIds: string[] | null) => run((u) => stageAdmin.setStageProfiles(z.string().uuid().parse(id), profileIds, u), "/config/etapas", SIS);
export const setStageAttemptDaysAction = async (id: string, days: number[] | null) =>
  run((u) => stageAdmin.setStageAttemptDays(z.string().uuid().parse(id), days, u), "/config/etapas", SIS);

export const saveAutoMessageAction = async (kind: string, v: unknown) =>
  runSafe((u) => autoMsg.saveAutoMessage(z.enum(autoMsg.AUTO_MESSAGE_KINDS).parse(kind), v, u), "/config/mensagens", "Não deu para salvar a mensagem automática. Tente de novo.", SIS);

/** "Só consulta": o texto vira resposta pronta (/auto-…) e a mensagem automática fica desligada. */
export const saveAutoMessageAsReplyAction = async (kind: string, text: string) =>
  runSafe((u) => autoMsg.saveAutoMessageAsReply(z.enum(autoMsg.AUTO_MESSAGE_KINDS).parse(kind), z.string().parse(text), u), "/config/mensagens", "Não deu para deixar como resposta pronta. Tente de novo.", SIS);

/** "Atendente só mexe nas próprias conversas e nas sem dono" (Perfis; nasce desligada). Quem gere a equipe liga e desliga. */
export const setStrictScopeAction = async (on: boolean) => run((u) => setStrictScope(z.boolean().parse(on), u), "/config/equipe/perfis", EQ);

/** Liga e desliga o Retorno sugerido automático (Lote 2; nasce desligado). */
export const setSuggestedReturnAction = async (on: boolean) => run((u) => setSuggestedReturnSetting(z.boolean().parse(on), u), "/config/automacoes", SIS);
