import { requirePerm } from "@/server/auth/session";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { lists, users } from "@/server/db/schema";
import { ListsEditor } from "@/components/config/lists";
import { redirect } from "next/navigation";
import { quickReplyAttachment, quickReplyOwnerId } from "@/server/domain/quick-replies";
export const metadata = { title: "Listas e respostas" };
const TAB_KINDS = ["quick_reply", "objection", "lost_reason", "keyword"] as const;
export default async function ListasPage({ searchParams }: PageProps<"/config/listas">) {
  await requirePerm("config.diaadia");
  const aba = (await searchParams).aba;
  if (aba === "origin") redirect("/config/origens");
  // Serviços virou aba do menu (16/10). O endereço antigo (e o "#servico-<id>" do Procurar horário) continua chegando lá.
  if (aba === "service") redirect("/servicos");
  const initialTab = TAB_KINDS.find((k) => k === aba);
  const rows = await db.select().from(lists).orderBy(asc(lists.position));
  const ownerIds = [...new Set(rows.map((r) => (r.kind === "quick_reply" ? quickReplyOwnerId(r.meta) : null)).filter((x): x is string => !!x))];
  const owners = new Map((ownerIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds)) : []).map((u) => [u.id, u.name]));
  return <ListsEditor initialTab={initialTab} single={!!initialTab} items={rows.filter((r) => r.kind !== "origin" && r.kind !== "service").map((r) => ({ id: r.id, kind: r.kind, label: r.label, body: r.body, active: r.active, cycleDays: r.cycleDays, priceCents: r.priceCents, durationMin: r.durationMin, bufferMin: r.bufferMin, category: r.category,
    attachment: r.kind === "quick_reply" ? ((a) => (a ? { name: a.name, kind: a.kind } : null))(quickReplyAttachment(r.meta)) : null, boost: !!(r.meta as { boost?: boolean } | null)?.boost,
    ownerName: r.kind === "quick_reply" ? ((o) => (o ? owners.get(o) ?? "pessoa que saiu" : null))(quickReplyOwnerId(r.meta)) : null }))} />;
}
