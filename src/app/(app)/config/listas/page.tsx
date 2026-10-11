import { asc } from "drizzle-orm";
import { db } from "@/server/db";
import { lists } from "@/server/db/schema";
import { ListsEditor } from "@/components/config/lists";
export const metadata = { title: "Listas e respostas" };
const TAB_KINDS = ["quick_reply", "objection", "lost_reason", "origin", "service"] as const;
export default async function ListasPage({ searchParams }: PageProps<"/config/listas">) {
  const aba = (await searchParams).aba;
  const initialTab = TAB_KINDS.find((k) => k === aba);
  const rows = await db.select().from(lists).orderBy(asc(lists.position));
  return <ListsEditor initialTab={initialTab} items={rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, body: r.body, active: r.active, cycleDays: r.cycleDays }))} />;
}
