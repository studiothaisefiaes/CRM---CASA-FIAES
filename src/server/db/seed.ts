import { sql } from "drizzle-orm";
import type { Db } from "./index";
import { stages, lists, automations } from "./schema";
import { DEFAULT_STAGES, DEFAULT_LISTS, DEFAULT_QUICK_REPLIES, DEFAULT_AUTOMATIONS } from "./seed-data";

/** Idempotente: pode rodar quantas vezes quiser sem duplicar nem sobrescrever edições do gestor. */
export async function seed(db: Db) {
  await db.insert(stages).values(DEFAULT_STAGES.map((s) => ({ ...s }))).onConflictDoNothing({ target: stages.key });
  const listRows = [
    ...Object.entries(DEFAULT_LISTS).flatMap(([kind, labels]) =>
      labels.map((label, position) => ({ kind: kind as "objection" | "lost_reason" | "origin", label, position }))),
    ...DEFAULT_QUICK_REPLIES.map((q, position) => ({ kind: "quick_reply" as const, label: q.label, body: q.body, position })),
  ];
  await db.insert(lists).values(listRows).onConflictDoNothing();
  await db.insert(automations).values(DEFAULT_AUTOMATIONS.map((a) => ({ ...a }))).onConflictDoNothing({ target: automations.key });
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from stages`)).rows as { n: number }[];
  return { stages: n };
}
