import { requirePerm } from "@/server/auth/session";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { automations, stages, users } from "@/server/db/schema";
import { activeAutomationFilter } from "@/server/rules/retired";
import { AutomationsList } from "@/components/config/automations";
import { getSuggestedReturnSetting } from "@/server/domain/suggested-return";
import { SuggestedReturnSwitch } from "@/components/config/suggested-return-switch";
import { ReminderD1Card } from "@/components/config/reminder-d1";
import { getLembreteD1 } from "@/server/domain/client-link/settings";
import { listTeams } from "@/server/domain/teams";
import { listLibrary } from "@/server/domain/library";
import { funcaoParam } from "@/server/domain/funcoes";
import { canReceiveConversation } from "@/server/domain/team-scope";

export const metadata = { title: "Automações" };

/** Regras, lembrete e retorno são três itens de Configurações (`?parte=`); sem `parte` (endereço antigo), mostra os três. */
const PARTES = ["regras", "lembrete", "retorno"] as const;

export default async function AutomacoesPage({ searchParams }: PageProps<"/config/automacoes">) {
  await requirePerm("config.sistema");
  const p = (await searchParams).parte;
  const parte = PARTES.find((x) => x === p);
  const show = (x: (typeof PARTES)[number]) => !parte || parte === x;
  const [list, st, runRows, retorno, lembrete, teamRows, people, files, maxDelay] = await Promise.all([
    // Sem as aposentadas (lembrete_agendamento e confirmacao_d1, Plano 5): o lembrete da véspera é o do fim desta tela / Mensagens.
    db.select().from(automations).where(activeAutomationFilter()).orderBy(asc(automations.name)),
    db.select({ key: stages.key, name: stages.name }).from(stages).orderBy(asc(stages.position)),
    db.execute(sql`select automation_id as id, count(*)::int as n from automation_runs where created_at > now() - interval '7 days' group by 1`),
    getSuggestedReturnSetting(),
    getLembreteD1(),
    // Para as ações "Passar para" e "Enviar um arquivo da Biblioteca" (Fase B, Task 7).
    listTeams(),
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), canReceiveConversation())).orderBy(asc(users.name)),
    listLibrary(),
    funcaoParam("regras_acontecimento", "atraso_max_min"),
  ]);
  const options = { teams: teamRows.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name })), people, files: files.map((f) => ({ id: f.id, name: f.name })), maxDelay };
  const runs = Object.fromEntries((runRows.rows as { id: string; n: number }[]).map((r) => [r.id, r.n]));
  return (
    <>
      {show("retorno") && <SuggestedReturnSwitch initial={retorno} />}
      {show("regras") && <AutomationsList items={list.map((a) => ({ id: a.id, name: a.name, enabled: a.enabled, trigger: a.trigger, conditions: a.conditions, actions: a.actions, version: a.version, updatedAt: a.updatedAt.toISOString() }))} stages={st} runs={runs} options={options} />}
      {show("lembrete") && <ReminderD1Card value={lembrete} />}
    </>
  );
}
