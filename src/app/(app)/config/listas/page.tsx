import { asc } from "drizzle-orm";
import { db } from "@/server/db";
import { lists } from "@/server/db/schema";
import { ListsEditor } from "@/components/config/lists";
export const metadata = { title: "Listas e respostas" };
export default async function ListasPage() {
  const rows = await db.select().from(lists).orderBy(asc(lists.position));
  return <ListsEditor items={rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, body: r.body, active: r.active }))} />;
}
