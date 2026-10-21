import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { dealEvents, deals, stages, type Stage } from "../db/schema";

/**
 * Nova organização (16/10, aprovada pelo dono): migração de DADOS das etapas, reversível pelo backup JSON.
 * - nomes: Em conversa, Orçamento, Hora de voltar; cor nova de Novo contato (só se ainda é a padrão antiga);
 * - "Aguardando cliente" sai do funil: as conversas vão para Em conversa MANTENDO as tentativas (contador, data, tarefa e a entrada na etapa,
 *   que é de onde as tentativas contam); os dias das tentativas da etapa passam para Em conversa se ela não tinha os seus;
 * - "Fechado" sai da escolha: as conversas vão para Atendida, terminadas (closedAt) e encerradas (Resolvidas);
 * - as duas etapas ficam desativadas (o histórico continua com o nome).
 * Nunca envia mensagem. Quem chama (scripts/nova-organizacao-etapas.ts) faz o ensaio, grava o backup e mostra o resultado.
 */
export const NOVA_ORG_REASON = "nova_organizacao";
const RENAMES: [key: string, to: string][] = [["atendimento", "Em conversa"], ["orcamento", "Orçamento"], ["retorno", "Hora de voltar"]];
const LEAD_COLOR = { from: "#b8863f", to: "#a87a2c" };

type StageSnap = Pick<Stage, "id" | "key" | "name" | "color" | "active" | "attemptDays">;
export type DealSnap = { id: string; stageId: string; stageKey: string; closedAt: string | null; conversationArchivedAt: string | null; archivedStageId: string | null; toStageId: string };
export type NovaOrgBackup = { versao: 1; feitoEm: string; stages: StageSnap[]; deals: DealSnap[] };
type DealRow = { id: string; stageId: string; stageKey: string; kind: string; closedAt: Date | null; conversationArchivedAt: Date | null; archivedStageId: string | null };

async function readState(tx: Tx | typeof db) {
  const all = await tx.select().from(stages);
  const byKey = new Map(all.map((s) => [s.key, s]));
  const conversa = byKey.get("atendimento"), atendida = all.find((s) => s.kind === "atendido" && s.key === "atendida") ?? all.find((s) => s.kind === "atendido");
  if (!conversa || !atendida) throw new Error('Faltam as etapas "Em conversa" ou "Atendida": rode "npm run db:seed" antes.');
  const oldIds = all.filter((s) => s.kind === "followup" || s.kind === "fechado").map((s) => s.id);
  const rows = oldIds.length ? (await tx.select({ id: deals.id, stageId: deals.stageId, stageKey: stages.key, kind: stages.kind, closedAt: deals.closedAt,
    conversationArchivedAt: deals.conversationArchivedAt, archivedStageId: deals.archivedStageId })
    .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(inArray(deals.stageId, oldIds))) as DealRow[] : [];
  // Aguardando: só as que não terminaram (as fechadas/perdidas antigas ficam como histórico). Fechado: todas.
  const aguardando = rows.filter((r) => r.kind === "followup" && !r.closedAt);
  const fechado = rows.filter((r) => r.kind === "fechado");
  return { all, byKey, conversa, atendida, aguardando, fechado };
}

function stagePlan(s: Awaited<ReturnType<typeof readState>>) {
  const out: { id: string; patch: Partial<typeof stages.$inferInsert>; text: string }[] = [];
  for (const [key, to] of RENAMES) { const st = s.byKey.get(key); if (st && st.name !== to) out.push({ id: st.id, patch: { name: to }, text: `Renomear "${st.name}" → "${to}"` }); }
  const lead = s.byKey.get("lead");
  if (lead && lead.color.toLowerCase() === LEAD_COLOR.from) out.push({ id: lead.id, patch: { color: LEAD_COLOR.to }, text: `Cor de "${lead.name}": ${LEAD_COLOR.from} → ${LEAD_COLOR.to}` });
  const fu = s.all.filter((x) => x.kind === "followup").sort((a, b) => a.position - b.position)[0];
  if (fu?.attemptDays?.length && !s.conversa.attemptDays?.length) {
    out.push({ id: s.conversa.id, patch: { attemptDays: fu.attemptDays }, text: `Dias das tentativas de Em conversa: os de ${fu.name} (${fu.attemptDays.join(", ")})` });
  }
  for (const st of s.all.filter((x) => (x.kind === "followup" || x.kind === "fechado") && x.active).sort((a, b) => a.position - b.position)) {
    out.push({ id: st.id, patch: { active: false }, text: `Desativar "${st.name}"` });
  }
  return out;
}

/** Ensaio: o que mudaria (nada é gravado). */
export async function planNovaOrganizacao() {
  const s = await readState(db);
  return { stageChanges: stagePlan(s).map((c) => c.text), aguardando: s.aguardando, fechado: s.fechado };
}

/** Aplica tudo numa transação só e devolve o backup (o antes de cada etapa e de cada conversa mexida). Idempotente. */
export async function applyNovaOrganizacao(now = new Date(), opts: { /** Grava o backup ANTES do commit: se falhar, nada é aplicado. */ beforeCommit?: (b: NovaOrgBackup) => Promise<void> } = {}) {
  return db.transaction(async (tx) => {
    const s = await readState(tx);
    const plan = stagePlan(s);
    const backup: NovaOrgBackup = {
      versao: 1, feitoEm: now.toISOString(),
      stages: s.all.map((x) => ({ id: x.id, key: x.key, name: x.name, color: x.color, active: x.active, attemptDays: x.attemptDays })),
      deals: [],
    };
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    const oldIds = new Set(s.all.filter((x) => x.kind === "followup" || x.kind === "fechado").map((x) => x.id));
    const target = (r: DealRow) => (r.kind === "followup" ? s.conversa : s.atendida);
    for (const r of [...s.aguardando, ...s.fechado]) {
      const to = target(r);
      backup.deals.push({ id: r.id, stageId: r.stageId, stageKey: r.stageKey, closedAt: iso(r.closedAt), conversationArchivedAt: iso(r.conversationArchivedAt), archivedStageId: r.archivedStageId, toStageId: to.id });
      // "Não é cliente" guarda a etapa de quando saiu (a mesma em que está): o Desfazer não pode cair numa etapa desligada.
      const archivedStage = r.archivedStageId && oldIds.has(r.archivedStageId) ? { archivedStageId: to.id } : {};
      if (r.kind === "followup") {
        // A entrada na etapa NÃO muda: é dela que as tentativas contam os dias.
        await tx.update(deals).set({ stageId: to.id, ...archivedStage }).where(eq(deals.id, r.id));
      } else {
        await tx.update(deals).set({
          stageId: to.id, ...archivedStage,
          closedAt: sql`coalesce(${deals.closedAt}, ${deals.stageEnteredAt})`,
          conversationArchivedAt: sql`coalesce(${deals.conversationArchivedAt}, ${deals.closedAt}, ${deals.stageEnteredAt})`,
          awaitingReplySince: null,
        }).where(eq(deals.id, r.id));
      }
      await tx.insert(dealEvents).values({ dealId: r.id, type: "etapa_alterada", payload: { de: r.stageKey, para: to.key, motivo: NOVA_ORG_REASON }, createdAt: now });
    }
    for (const c of plan) await tx.update(stages).set(c.patch).where(eq(stages.id, c.id));
    if (opts.beforeCommit) await opts.beforeCommit(backup);
    return { backup, stageChanges: plan.map((c) => c.text), aguardando: s.aguardando.length, fechado: s.fechado.length };
  });
}

/**
 * Desfaz com o backup: etapas como estavam e cada conversa de volta, MAS só se ela ainda está onde a migração pôs
 * (conversa que a equipe já mexeu depois fica como está e aparece em `skipped`). Apaga o registro da mudança de etapa da migração.
 */
export async function revertNovaOrganizacao(backup: NovaOrgBackup): Promise<{ stages: number; deals: number; skipped: string[] }> {
  if (backup?.versao !== 1 || !Array.isArray(backup.stages) || !Array.isArray(backup.deals)) throw new Error("Backup inválido.");
  return db.transaction(async (tx) => {
    for (const st of backup.stages) {
      await tx.update(stages).set({ name: st.name, color: st.color, active: st.active, attemptDays: st.attemptDays }).where(eq(stages.id, st.id));
    }
    let n = 0;
    const skipped: string[] = [];
    for (const d of backup.deals) {
      const [cur] = await tx.select({ stageId: deals.stageId }).from(deals).where(eq(deals.id, d.id));
      if (!cur || cur.stageId !== d.toStageId) { skipped.push(d.id); continue; }
      await tx.update(deals).set({
        stageId: d.stageId, closedAt: d.closedAt ? new Date(d.closedAt) : null,
        conversationArchivedAt: d.conversationArchivedAt ? new Date(d.conversationArchivedAt) : null, archivedStageId: d.archivedStageId,
      }).where(eq(deals.id, d.id));
      await tx.delete(dealEvents).where(and(eq(dealEvents.dealId, d.id), eq(dealEvents.type, "etapa_alterada"), sql`${dealEvents.payload}->>'motivo' = ${NOVA_ORG_REASON}`));
      n++;
    }
    return { stages: backup.stages.length, deals: n, skipped };
  });
}

/** Conversas abertas por etapa (para o antes/depois do script). */
export async function openByStageNow() {
  return (await db.execute(sql`select s.name as etapa, s.active as ativa, count(d.id)::int as conversas
    from stages s left join deals d on d.stage_id = s.id and d.closed_at is null and d.archived_at is null
    group by s.id order by s.position`)).rows;
}
