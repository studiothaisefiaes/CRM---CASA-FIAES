import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import { activeAutomationFilter } from "../rules/retired";
import { db } from "../db";
import { automations, channels, leadSources, lists, professionals, settings, stages, tags, users } from "../db/schema";
import { notRemovedChannel } from "../whatsapp/channel-removed";
import { getAutoReply } from "../domain/messaging-settings";
import { getAutoMessage } from "../domain/auto-message-settings";
import { getWelcomeMenu } from "../domain/welcome-menu";
import { getAfterVisit } from "../domain/after-visit";
import { getSummaryWhatsapp } from "../domain/summary-whatsapp";
import { getCasaInfo, getClientLinkSettings, getLembreteD1, getOnlineBooking } from "../domain/client-link/settings";
import { getMassSettings } from "../domain/campaigns";
import { getSuggestedReturnSetting } from "../domain/suggested-return";
import { funcaoLigada } from "../domain/funcoes";
import { getDistributionSettings } from "../domain/distribution";
import { getBusinessHours } from "../domain/hours";
import { getAgendaMode, getAgendaRules } from "../domain/agenda/mode";
import { getCaixaMode, getCaixaRules } from "../domain/caixa/mode";
import { getFinanceiroConfig } from "../domain/financeiro/config";
import { getRelatoriosConfig } from "../domain/relatorios-config";
import { getEstoqueConfig } from "../domain/estoque/config";
import { getNfseModo } from "../domain/fiscal/config";
import { sendsMessages } from "../rules/templates";
import { summarizeHours } from "@/lib/hours-summary";
import type { ConfigSnapshot } from "@/lib/config-tabs";
import { getFuncoes, getFuncoesState } from "../domain/funcoes";
import { clientAlertFor } from "../domain/client-alert";
import { listAppointmentLabels } from "../domain/agenda/labels";
import { getRepetirConfig } from "../domain/agenda/recurrence";
import { listQuestions } from "../domain/fichas";
import { funcoesLigadas, FUNCOES } from "@/lib/funcoes";
import { FICHA_FORMS } from "@/lib/fichas";
import { aiSpend, getAiSettings } from "../ai/settings";

/**
 * O estado de cada configuração para o índice de Configurações. Só lê. Cada pedaço é independente: se um falhar, o item fica
 * sem estado (nunca com um inventado) e o resto da tela abre normal.
 */
export async function loadConfigSnapshot(): Promise<ConfigSnapshot> {
  const s: ConfigSnapshot = {};
  const part = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { console.error("[config] estado não lido", e); } };
  const count = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0);
  await Promise.all([
    part(async () => { s.autoReply = (await getAutoReply()).enabled; }),
    part(async () => { s.welcome = (await getAutoMessage("boas_vindas")).enabled; }),
    part(async () => { s.away = (await getAutoMessage("ausencia")).enabled; }),
    part(async () => { s.closing = (await getAutoMessage("encerramento")).enabled; }),
    part(async () => { s.menu = (await getWelcomeMenu()).enabled; }),
    part(async () => { s.reminder = (await getLembreteD1()).enabled; }),
    part(async () => { s.afterVisit = (await getAfterVisit()).mode !== "desligado"; }),
    part(async () => { s.summaryWhatsapp = (await getSummaryWhatsapp()).enabled; }),
    part(async () => { s.library = await funcaoLigada("biblioteca"); }),
    part(async () => { s.mass = (await getMassSettings()).enabled; }),
    part(async () => { s.suggestedReturn = (await getSuggestedReturnSetting()).ativo; }),
    part(async () => { s.distribution = (await getDistributionSettings()).enabled; }),
    part(async () => { const [a, sp] = await Promise.all([getAiSettings(), aiSpend()]); s.ai = { enabled: a.enabled, monthMicros: sp.monthMicros, monthlyLimitUsd: a.monthlyLimitUsd }; }),
    part(async () => { s.marcadores = (await listAppointmentLabels()).length; }),
    part(async () => { const [h, c] = await Promise.all([clientAlertFor("horario"), clientAlertFor("comanda")]); s.avisoCliente = { horario: h.on, comanda: c.on }; }),
    part(async () => { s.fichas = (await Promise.all(FICHA_FORMS.map((f) => listQuestions(f)))).reduce((t, l) => t + l.length, 0); }),
    part(async () => { s.funcoes = { on: funcoesLigadas(await getFuncoesState()), total: FUNCOES.length }; }),
    part(async () => { const [c, f] = await Promise.all([getRepetirConfig(), getFuncoes()]); s.repetir = { ...c, on: f.repetir }; }),
    part(async () => { s.onlineBooking = (await getOnlineBooking()).enabled; }),
    part(async () => {
      const [casa, link] = await Promise.all([getCasaInfo(), getClientLinkSettings()]);
      s.clientPage = { endereco: !!casa.endereco, cancelarAteHoras: link.cancelarAteHoras };
    }),
    part(async () => {
      const rows = await db.select({ enabled: automations.enabled, actions: automations.actions }).from(automations).where(activeAutomationFilter());
      const on = rows.filter((r) => r.enabled);
      s.automations = { on: on.length, total: rows.length, sendingOn: on.filter((r) => sendsMessages(r.actions as { type: string }[])).length };
    }),
    part(async () => {
      const [hours, saved] = await Promise.all([getBusinessHours(), db.select({ key: settings.key }).from(settings).where(eq(settings.key, "business_hours"))]);
      s.hours = { summary: summarizeHours(hours), saved: saved.length > 0 };
    }),
    part(async () => {
      const [r] = await db.select({ active: sql<number>`count(*)::int`, pending: sql<number>`count(*) filter (where ${users.passwordHash} is null)::int` }).from(users).where(eq(users.active, true));
      s.people = { active: Number(r?.active ?? 0), pending: Number(r?.pending ?? 0) };
    }),
    part(async () => {
      const rows = await db.select({ kind: lists.kind, n: sql<number>`count(*)::int` })
        .from(lists).where(eq(lists.active, true)).groupBy(lists.kind);
      s.lists = Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
    }),
    part(async () => { s.tags = count(await db.select({ n: sql<number>`count(*)::int` }).from(tags)); }),
    part(async () => { s.stages = count(await db.select({ n: sql<number>`count(*)::int` }).from(stages).where(eq(stages.active, true))); }),
    part(async () => { s.sources = count(await db.select({ n: sql<number>`count(*)::int` }).from(leadSources).where(eq(leadSources.active, true))); }),
    part(async () => { s.professionals = count(await db.select({ n: sql<number>`count(*)::int` }).from(professionals).where(eq(professionals.active, true))); }),
    part(async () => { s.passoMin = (await getAgendaRules()).passoMin; }),
    part(async () => { s.agendaMode = await getAgendaMode(); }),
    part(async () => { s.caixaMode = await getCaixaMode(); }),
    part(async () => { const f = await getFinanceiroConfig(); s.financeiro = { contasAPagar: f.contasAPagar, resultado: f.resultado }; }),
    part(async () => { s.estoque = { ligado: (await getEstoqueConfig()).ligado }; }),
    part(async () => { s.relatorios = { ocupacao: (await getRelatoriosConfig()).ocupacao }; }),
    part(async () => { s.nota = { nfse: await getNfseModo() }; }),
    part(async () => { s.exigeCaixaAberto = (await getCaixaRules()).exigeCaixaAberto; }),
    part(async () => {
      const [r] = await db.select({ total: sql<number>`count(*)::int`, connected: sql<number>`count(*) filter (where ${channels.status} = 'conectado')::int` })
        .from(channels).where(and(notRemovedChannel));
      s.whatsapp = { connected: Number(r?.connected ?? 0), total: Number(r?.total ?? 0) };
    }),
  ]);
  return s;
}

/** Um pedido só lê o estado uma vez (o layout e o índice de Configurações usam o mesmo). */
export const configSnapshot = cache(loadConfigSnapshot);
