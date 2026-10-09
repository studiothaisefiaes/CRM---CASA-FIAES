import { asc, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { automations, stages } from "@/server/db/schema";
import { AutomationsList } from "@/components/config/automations";

export const metadata = { title: "Automações" };

export default async function AutomacoesPage() {
  const [list, st, runRows] = await Promise.all([
    db.select().from(automations).orderBy(asc(automations.name)),
    db.select({ key: stages.key, name: stages.name }).from(stages).orderBy(asc(stages.position)),
    db.execute(sql`select automation_id as id, count(*)::int as n from automation_runs where created_at > now() - interval '7 days' group by 1`),
  ]);
  const runs = Object.fromEntries((runRows.rows as { id: string; n: number }[]).map((r) => [r.id, r.n]));
  return <AutomationsList items={list.map((a) => ({ id: a.id, name: a.name, enabled: a.enabled, trigger: a.trigger, conditions: a.conditions, actions: a.actions, version: a.version, updatedAt: a.updatedAt.toISOString() }))} stages={st} runs={runs} />;
}
