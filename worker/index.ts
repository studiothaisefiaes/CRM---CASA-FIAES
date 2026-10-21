import "dotenv/config";
import { sweepPresence } from "../src/server/domain/presence";
import { assignWaitingUnowned, offerOverdue } from "../src/server/domain/offers";
import { ensureMonthlyReport } from "../src/server/reports/pdf";
process.env.TZ ??= "America/Bahia";
import { PgBoss } from "pg-boss";
import { runRules } from "../src/server/rules/engine";
import { sweepClosingWaits, sweepOverdueWaits } from "../src/server/domain/overdue-waits";
import { syncLidPairs } from "../src/server/whatsapp/lid-pairs";
import { processHistoryEvents, purgeOldWebhookEvents, retryFailedWebhooks } from "../src/server/whatsapp/webhook";
import { purgeExpiredSessions } from "../src/server/auth/sessions-store";
import { pool, db } from "../src/server/db";
import { contactStats, settings } from "../src/server/db/schema";
import { downloadPendingMedia, refreshAvatars } from "../src/server/whatsapp/media";
import { processPendingAudio } from "../src/server/whatsapp/audio";
import { checkConnections } from "../src/server/whatsapp/watchdog";
import { runMediaRetention } from "../src/server/whatsapp/retention";
import { remindDueTasks } from "../src/server/domain/tasks";
import { sweepAlerts } from "../src/server/domain/alert-actions";
import { closeAttendedDeals, sweepAttempts } from "../src/server/domain/funnel";
import { refreshContactStats } from "../src/server/domain/contact-stats";
import { sweepSuggestedReturns } from "../src/server/domain/suggested-return";
import { drainOutbox } from "../src/server/domain/outbox";
import { drainCampaigns } from "../src/server/domain/campaigns";
import { expireReturnInvites } from "../src/server/domain/return-invite";
import { sendPushForPendingAlerts } from "../src/server/push";
import { sendPendingProNotifications } from "../src/server/domain/pro/notifications";
import { runLembreteD1 } from "../src/server/domain/client-link/reminder";
import { runAfterVisit } from "../src/server/domain/after-visit";
import { runSummaryWhatsapp } from "../src/server/domain/summary-whatsapp";
import { expireOnlineRequests } from "../src/server/domain/client-link/online";
import { vapidConfig } from "../src/server/env";
import { processPendingNfse } from "../src/server/domain/fiscal/nfse";
import { processPendingNfce } from "../src/server/domain/fiscal/nfce/nfce";

// Worker do CRM: automações (a cada minuto), reprocessamento de webhooks e limpeza.
// Roda separado do app: `npm run worker` (no Contabo, sob pm2).
const QUEUES = { rules: "regras", webhooks: "webhooks-reprocessar", history: "historico-whatsapp", media: "midia-whatsapp", audio: "audio-transcricao", cleanup: "limpeza", retention: "retencao-midia", reminders: "lembretes", outbox: "fila-envios", push: "push-alertas", pushAgenda: "push-agenda", lembreteD1: "lembrete-d1", depoisAtendimento: "depois-atendimento", resumoWhatsapp: "resumo-whatsapp", pedidosOnline: "pedidos-online", distribution: "distribuicao", monthly: "relatorio-mensal", visao: "visao-contatos", retorno: "retorno-sugerido", massa: "envio-massa", notaFiscal: "nota-fiscal" } as const;

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  for (const q of Object.values(QUEUES)) await boss.createQueue(q).catch(() => {});
  await boss.schedule(QUEUES.rules, "* * * * *", null, { tz: "America/Bahia", singletonKey: "rules" });
  await boss.schedule(QUEUES.webhooks, "*/2 * * * *", null, { tz: "America/Bahia" });
  await boss.schedule(QUEUES.history, "* * * * *", null, { tz: "America/Bahia", singletonKey: "historico" });
  await boss.schedule(QUEUES.media, "* * * * *", null, { tz: "America/Bahia", singletonKey: "midia" });
  await boss.schedule(QUEUES.audio, "* * * * *", null, { tz: "America/Bahia", singletonKey: "audio" });
  await boss.schedule(QUEUES.reminders, "*/5 * * * *", null, { tz: "America/Bahia", singletonKey: "lembretes" });
  await boss.schedule(QUEUES.outbox, "* * * * *", null, { tz: "America/Bahia", singletonKey: "fila-envios" });
  await boss.schedule(QUEUES.massa, "* * * * *", null, { tz: "America/Bahia", singletonKey: "envio-massa" });
  await boss.schedule(QUEUES.distribution, "* * * * *", null, { tz: "America/Bahia", singletonKey: "distribuicao" });
  // Fase D: NFS-e pendentes (envio com falha ou "emitir ao fechar"). Com a chave desligada (o padrão), não faz nada.
  await boss.schedule(QUEUES.notaFiscal, "* * * * *", null, { tz: "America/Bahia", singletonKey: "nota-fiscal" });
  // Fechamento mensal em PDF: todo dia às 06:00 confere se o do mês anterior já existe (worker parado no dia 1º gera no dia seguinte).
  await boss.schedule(QUEUES.monthly, "0 6 * * *", null, { tz: "America/Bahia", singletonKey: "relatorio-mensal" });
  // Lote 2: a visão por contato da ficha e da lista de Contatos é refeita toda noite (e depois de cada importação do Avec).
  await boss.schedule(QUEUES.visao, "30 3 * * *", null, { tz: "America/Bahia", singletonKey: "visao-contatos" });
  // Lote 2: Retorno sugerido automático às 08:00 (depois da visão por contato das 03:30). Desligado até a gestão ligar; nunca envia nada.
  await boss.schedule(QUEUES.retorno, "0 8 * * *", null, { tz: "America/Bahia", singletonKey: "retorno-sugerido" });
  const pushOn = !!vapidConfig();
  if (pushOn) await boss.schedule(QUEUES.push, "* * * * *", null, { tz: "America/Bahia", singletonKey: "push" });
  else await boss.unschedule(QUEUES.push).catch(() => {});
  // Avisos do app da profissional (Lote 7A): a cada minuto, só com as chaves VAPID.
  if (pushOn) await boss.schedule(QUEUES.pushAgenda, "* * * * *", null, { tz: "America/Bahia", singletonKey: "push-agenda" });
  else await boss.unschedule(QUEUES.pushAgenda).catch(() => {});
  // Lote 7B: lembrete do horário (24 h antes) e aviso de remarcação. Agendado sempre; desligado (o padrão), não faz nada.
  await boss.schedule(QUEUES.lembreteD1, "*/15 * * * *", null, { tz: "America/Bahia", singletonKey: "lembrete-d1" });
  // Fase B: Depois do atendimento — pega a baixa do Avec importada depois (o Finalizado do CRM já enfileira na hora). Desligado, não faz nada.
  await boss.schedule(QUEUES.depoisAtendimento, "*/15 * * * *", null, { tz: "America/Bahia", singletonKey: "depois-atendimento" });
  // Fase B: resumo do dia no WhatsApp da gestão. Roda de hora em hora e só enfileira na hora escolhida em Configurações (padrão 19h de Salvador); desligado, não faz nada.
  await boss.schedule(QUEUES.resumoWhatsapp, "0 * * * *", null, { tz: "America/Bahia", singletonKey: "resumo-whatsapp" });
  await boss.schedule(QUEUES.pedidosOnline, "*/5 * * * *", null, { tz: "America/Bahia", singletonKey: "pedidos-online" });
  await boss.schedule(QUEUES.cleanup, "15 4 * * *", null, { tz: "America/Bahia" });
  // Retenção de mídia: todo dia às 04:00 de Salvador (America/Bahia, UTC-3 fixo; equivale a "0 7 * * *" em UTC). Lê a configuração a cada rodada; "nunca" não apaga nada.
  await boss.schedule(QUEUES.retention, "0 4 * * *", null, { tz: "America/Bahia", singletonKey: "retencao-midia" });

  // Batida do worker: gravada ao fim de cada rodada das regras (todo minuto), o que prova que o motor roda.
  // O /api/health lê daqui para saber se as automações estão funcionando.
  const beat = async () => {
    const now = new Date();
    await db.insert(settings).values({ key: "worker_heartbeat", value: now.toISOString() })
      .onConflictDoUpdate({ target: settings.key, set: { value: now.toISOString(), updatedAt: now } });
  };
  await beat().catch((e) => console.error("[batida do worker]", e));

  await boss.work(QUEUES.rules, { batchSize: 1 }, async () => {
    const t = Date.now(); const s = await runRules();
    if (s.fired || s.errors.length) console.log(`[regras] ${s.fired} disparos, ${s.alerts} alertas, ${s.moved} movidos (${Date.now() - t} ms)`, s.errors);
    // Espera vencida: Aguardando/Orçamento com a cliente esperando volta para Em conversa; Agendado sai da espera.
    const o = await sweepOverdueWaits().catch((e) => { console.error("[espera vencida]", e); return { moved: 0, cleared: 0 }; });
    if (o.moved || o.cleared) console.log("[espera vencida]", o);
    // "Obrigada!"/"ok"/👍 depois da resposta da Casa não é espera.
    const c = await sweepClosingWaits().catch((e) => { console.error("[espera de agradecimento]", e); return { cleared: 0 }; });
    if (c.cleared) console.log("[espera de agradecimento → encerrada]", c);
    // Aguardando cliente / Orçamento: tentativas D+1, D+3, D+7 (combinados com aviso) e Perdido "Não respondeu mais" depois da 3ª. Nunca envia mensagem.
    const tt = await sweepAttempts().catch((e) => { console.error("[tentativas]", e); return { advanced: 0, adopted: 0, lost: 0, errors: [] as string[] }; });
    if (tt.advanced || tt.adopted || tt.lost || tt.errors.length) console.log("[tentativas]", tt);
    // Convite de retorno (mensagem em massa) sem resposta em 14 dias: a conversa volta a ficar encerrada. Nunca envia mensagem.
    const ri = await expireReturnInvites().catch((e) => { console.error("[convite de retorno]", e); return 0; });
    if (ri) console.log("[convite de retorno → encerrada]", ri);
    // Atendida há 3 dias vira Fechado (ganho).
    const ca = await closeAttendedDeals().catch((e) => { console.error("[atendidas]", e); return { closed: 0, errors: [] as string[] }; });
    if (ca.closed || ca.errors.length) console.log("[atendidas → fechado]", ca);
    // Número oculto (@lid) que já tem o número revelado pela Evolution: junta com a conversa da cliente.
    const l = await syncLidPairs().catch((e) => { console.error("[número oculto]", e); return { merged: 0, renamed: 0 }; });
    if (l.merged || l.renamed) console.log("[número oculto → número]", l);
    await beat().catch((e) => console.error("[batida do worker]", e));
  });
  await boss.work(QUEUES.webhooks, async () => { const r = await retryFailedWebhooks(); if (r.tried) console.log("[webhooks]", r); });
  // Histórico do WhatsApp ao conectar um número: um lote por vez até esvaziar.
  await boss.work(QUEUES.history, { batchSize: 1 }, async () => {
    for (let i = 0; i < 50; i++) { const r = await processHistoryEvents(5); if (r.lotes) console.log("[histórico]", r); if (r.lotes < 5) break; }
  });
  // Fotos, áudios e figurinhas: baixa logo (o link do WhatsApp expira) + fotos de perfil.
  await boss.work(QUEUES.media, { batchSize: 1 }, async () => {
    await checkConnections().catch((e) => console.error("[vigia da conexão]", e));
    const m = await downloadPendingMedia(30); const a = await refreshAvatars(15);
    if (m.tried || a.tried) console.log("[mídia]", m, "[fotos de perfil]", a);
  });
  // Áudios: cópia .m4a (toca no iPhone), duração e transcrição. Um por vez, até 5 por rodada; sem ffmpeg/transcritor só avisa no log.
  await boss.work(QUEUES.audio, { batchSize: 1 }, async () => {
    const r = await processPendingAudio(5).catch((e) => { console.error("[áudio]", e); return null; });
    if (r && (r.converted || r.transcribed || r.silent || r.failed)) console.log("[áudio]", r);
  });
  // Tarefas que vencem nos próximos 15 min: um aviso para o responsável.
  await boss.work(QUEUES.reminders, { batchSize: 1 }, async () => {
    const r = await remindDueTasks(); if (r.alerts) console.log("[lembretes]", r);
    // Fadiga de alerta: repetidos saem, "parada" que não vale mais sai, e o resto sobe em degraus (vermelho → gestão).
    const s = await sweepAlerts().catch((e) => { console.error("[avisos em degraus]", e); return null; });
    if (s && (s.duplicates || s.stale || s.red || s.gestao)) console.log("[avisos em degraus]", s);
  });
  // Fila de envios automáticos (lembretes, enquete D-1, resposta fora do horário): teto por hora e reconferências na hora de enviar.
  await boss.work(QUEUES.outbox, { batchSize: 1 }, async () => { const r = await drainOutbox(); if (r.sent || r.cancelled || r.retry || r.failed) console.log("[fila de envios]", r); });
  // Mensagem em massa (Lote 5): no máximo uma por rodada; não faz nada com a chave desligada (o padrão).
  await boss.work(QUEUES.massa, { batchSize: 1 }, async () => {
    const r = await drainCampaigns().catch((e) => { console.error("[mensagem em massa]", e); return null; });
    if (r && (r.sent || r.failed || r.skipped)) console.log("[mensagem em massa]", r);
  });
  // Nota fiscal: a mesma fila processa as duas notas (NFS-e na Sefin, NFC-e na SVRS). As deps de verdade (A1 do .env + o governo do
  // ambiente de cada nota) são criadas dentro de processPendingNfse/processPendingNfce. Nunca registrar o XML nem a resposta: só as contagens.
  await boss.work(QUEUES.notaFiscal, { batchSize: 1 }, async () => {
    for (const [tipo, run] of [["NFS-e", processPendingNfse], ["NFC-e", processPendingNfce]] as const) {
      // Só uma frase fixa e o tipo do erro: a mensagem de um erro do banco traz os parâmetros (XML com CPF). Uma nota não para a outra.
      const r = await run().catch((e) => { console.error(`[nota fiscal] a fila da ${tipo} falhou`, e instanceof Error ? e.name : "erro"); return null; });
      if (r && (r.autorizadas || r.rejeitadas || r.falhas)) console.log(`[nota fiscal] ${tipo}`, r);
    }
  });
  await boss.work(QUEUES.monthly, { batchSize: 1 }, async () => {
    try { const r = await ensureMonthlyReport(); if (r.created) console.log("[relatório mensal] gerado", r.created); }
    catch (e) { console.error("[relatório mensal] falhou", e); }
  });
  await boss.work(QUEUES.visao, { batchSize: 1 }, async () => {
    try { const r = await refreshContactStats(); console.log(`[visão por contato] ${r.contatos} contatos, ${r.comVisita} com visita (${r.ms} ms)`); }
    catch (e) { console.error("[visão por contato] falhou", e); }
  });
  await boss.work(QUEUES.retorno, { batchSize: 1 }, async () => {
    try { const r = await sweepSuggestedReturns(); if (!r.desligado) console.log("[retorno sugerido]", r); }
    catch (e) { console.error("[retorno sugerido] falhou", e); }
  });
  // Distribuição: quem sumiu há 5 min vira ausente e devolve os leads sem resposta.
  await boss.work(QUEUES.distribution, { batchSize: 1 }, async () => {
    const p = await sweepPresence(); if (p.away || p.returned) console.log("[distribuição] presença", p);
    const u = await assignWaitingUnowned(); if (u.assigned) console.log("[distribuição] sem dona entregues", u);
    const o = await offerOverdue(); if (o.offered) console.log("[distribuição] ofertas", o);
  });
  // Push no celular: só com as chaves VAPID no .env (sem elas o job nem é agendado).
  if (pushOn) await boss.work(QUEUES.push, { batchSize: 1 }, async () => { const r = await sendPushForPendingAlerts(); if (r.sent || r.failed) console.log("[push]", r); });
  // Lote 7B: pedido do site sem resposta até o início vira "recusado" (desligado, não há pedido nenhum).
  await boss.work(QUEUES.pedidosOnline, { batchSize: 1 }, async () => { const r = await expireOnlineRequests(); if (r.cancelled) console.log("[pedidos do site vencidos]", r); });
  await boss.work(QUEUES.lembreteD1, { batchSize: 1 }, async () => { const r = await runLembreteD1(); if (r.enqueued) console.log("[lembrete do horário]", r); });
  await boss.work(QUEUES.depoisAtendimento, { batchSize: 1 }, async () => { const r = await runAfterVisit(); if (r.enqueued) console.log("[depois do atendimento]", r); });
  await boss.work(QUEUES.resumoWhatsapp, { batchSize: 1 }, async () => { const r = await runSummaryWhatsapp(); if (r.enqueued) console.log("[resumo no WhatsApp]", r); });
  if (pushOn) await boss.work(QUEUES.pushAgenda, { batchSize: 1 }, async () => { const r = await sendPendingProNotifications(); if (r.sent || r.failed || r.skipped) console.log("[avisos da profissional]", r); });
  await boss.work(QUEUES.retention, { batchSize: 1 }, async () => { await runMediaRetention(new Date()); });
  await boss.work(QUEUES.cleanup, async () => { await purgeExpiredSessions(); await purgeOldWebhookEvents(); });

  // Primeira vez (tabela vazia logo depois da migration): não espera a madrugada.
  if (!(await db.select({ id: contactStats.contactId }).from(contactStats).limit(1)).length) await boss.send(QUEUES.visao, {});
  // Primeira rodada imediata (sem esperar o próximo minuto cheio).
  await boss.send(QUEUES.rules, {});
  console.log("Worker do CRM rodando. Automações a cada minuto.");

  const stop = async () => { console.log("Encerrando worker…"); await boss.stop({ graceful: true, timeout: 10_000 }); await pool.end(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
