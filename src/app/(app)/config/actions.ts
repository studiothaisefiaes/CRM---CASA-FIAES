"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import * as cfg from "@/server/domain/config";
import type { AutomationInput } from "@/server/rules/types";
import * as sources from "@/server/domain/sources";
import * as msg from "@/server/domain/messaging-settings";
import { env } from "@/server/env";
import { userErrorMessage } from "@/server/user-error";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
/** Erro para a tela: as regras do zod (todas) e o texto do domínio; SQL, rede e bugs vão para o log e viram "Não deu certo. Tente de novo." */
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : userErrorMessage(e, "config") });
async function run<T>(fn: (uid: string) => Promise<T>, path: string): Promise<R<T>> {
  try { const u = await assertUser("gestor"); const data = await fn(u.id); revalidatePath(path); return { ok: true, data }; } catch (e) { return fail(e); }
}

export const updateStageAction = async (id: string, v: Parameters<typeof cfg.updateStage>[1]) => run((u) => cfg.updateStage(id, v, u), "/config/etapas");
export const saveHoursAction = async (v: unknown) => run((u) => cfg.saveBusinessHours(v, u), "/config/etapas");
export const moveStageAction = async (id: string, dir: -1 | 1) => run((u) => cfg.moveStage(id, dir, u), "/config/etapas");
export const saveAutomationAction = async (id: string | null, v: AutomationInput) => run((u) => cfg.saveAutomation(id, v, u), "/config/automacoes");
export const toggleAutomationAction = async (id: string, on: boolean) => run((u) => cfg.toggleAutomation(id, on, u), "/config/automacoes");
export const restoreAutomationAction = async (id: string, v: number) => run((u) => cfg.restoreAutomation(id, v, u), "/config/automacoes");
export const deleteAutomationAction = async (id: string) => run((u) => cfg.deleteAutomation(id, u), "/config/automacoes");
export const automationDetailsAction = async (id: string) => run(() => cfg.automationDetails(id).then((d) => JSON.parse(JSON.stringify(d)) as Awaited<ReturnType<typeof cfg.automationDetails>>), "/config/automacoes");
export const previewAutomationAction = async (v: AutomationInput) => run(() => cfg.previewAutomation(v), "/config/automacoes");
export const addListItemAction = async (kind: (typeof cfg.listKinds)[number], label: string, body: string | null) => run((u) => cfg.addListItem(kind, label, body, u), "/config/listas");
export const updateListItemAction = async (id: string, label: string, body: string | null, active: boolean) => run((u) => cfg.updateListItem(id, label, body, active, u), "/config/listas");
export const createChannelAction = async (name: string) => run((u) => cfg.createChannel(name, u).then((c) => ({ id: c.id })), "/config/whatsapp");
export const channelQrAction = async (id: string) => run(() => cfg.channelQr(id), "/config/whatsapp");
export const channelStateAction = async (id: string) => run(() => cfg.channelState(id), "/config/whatsapp");
export const disconnectChannelAction = async (id: string, remove: boolean) => run((u) => cfg.disconnectChannel(id, remove, u), "/config/whatsapp");
export const inviteMemberAction = async (v: { name: string; email: string; role: "gestor" | "atendente" }) =>
  run(async (u) => `${env().APP_URL}/convite/${await cfg.inviteMember(v, u)}`, "/config/equipe");
export const setMemberAction = async (id: string, patch: { role?: "gestor" | "atendente"; active?: boolean }) => run((u) => cfg.setMember(id, patch, u), "/config/equipe");
export const createSourceAction = async (v: Parameters<typeof sources.createSource>[0]) => run((u) => sources.createSource(v, u), "/config/origens");
export const setSourceActiveAction = async (id: string, active: boolean) => run((u) => sources.setSourceActive(id, active, u), "/config/origens");

/* ---------- Mensagens automáticas, teto, retenção e ciclo (texto de erro fixo: nada de e.message cru) ---------- */
async function runSafe<T>(fn: (uid: string) => Promise<T>, path: string, fallback: string): Promise<R<T>> {
  try { const u = await assertUser("gestor"); const data = await fn(u.id); revalidatePath(path); return { ok: true, data }; } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? fallback };
    if (e instanceof Error && /sessão expirou|só a gestão|não encontrad/i.test(e.message)) return { ok: false, error: e.message };
    console.error("[config]", fallback, e);
    return { ok: false, error: fallback };
  }
}
export const saveAutoReplyAction = async (v: unknown) => runSafe((u) => msg.saveAutoReply(v, u), "/config/mensagens", "Não deu para salvar a resposta fora do horário. Tente de novo.");
export const saveSendCapAction = async (v: unknown) => runSafe((u) => msg.saveSendCap(v, u), "/config/whatsapp", "Não deu para salvar o limite por hora. Tente de novo.");
export const saveMediaRetentionAction = async (v: unknown) => runSafe((u) => msg.saveMediaRetention(v, u), "/config/whatsapp", "Não deu para salvar o prazo de guarda das mídias. Tente de novo.");
export const saveServiceCycleDaysAction = async (id: string, v: unknown) => runSafe((u) => msg.saveServiceCycleDays(id, v, u), "/config/listas", "Não deu para salvar o lembrete de retorno. Tente de novo.");
