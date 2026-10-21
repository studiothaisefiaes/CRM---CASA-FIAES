import { PageBack, PageHeader } from "@/components/page-header";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePerm } from "@/server/auth/session";
import { db } from "@/server/db";
import { contacts } from "@/server/db/schema";
import { isUuid } from "@/lib/uuid";
import { phoneHint } from "@/lib/merge-view";
import { Empty } from "@/components/ui/empty";
import { isFuncaoOn } from "@/server/domain/funcoes";
import { listDuplicateSuspects } from "@/server/queries/duplicate-suspects";
import { MergeFlow } from "@/components/contacts/merge-flow";

export const metadata = { title: "Unir cadastros" };

/** Ficha › ⋯ › Unir com…: um passo por tela. Só com a permissão "Unir cadastros duplicados" e a função ligada. */
export default async function UnirPage({ params }: PageProps<"/contatos/[id]/unir">) {
  await requirePerm("contatos.unir");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [c] = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164 }).from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!c) notFound();
  const on = await isFuncaoOn("unir");
  const suspects = on ? (await listDuplicateSuspects({ contactId: id })).map((s) => s.aId === id
    ? { id: s.bId, name: s.bName, hint: s.bHint, signals: s.signals } : { id: s.aId, name: s.aName, hint: s.aHint, signals: s.signals }) : [];
  return (
    <main className="pb-12">
      <PageHeader title="Unir cadastros" subtitle="Junte duas fichas da mesma pessoa numa só" back={<PageBack href={`/contatos/${c.id}`}>{c.name ?? "Ficha da cliente"}</PageBack>} />
      <div className="px-5 lg:px-8">
      {on ? <MergeFlow base={{ id: c.id, name: c.name, hint: phoneHint(c.phone) }} suspects={suspects} />
        : <Empty title="Unir cadastros está desligado">Ligue em Configurações › Recursos para unir cadastros duplicados.</Empty>}
      </div>
    </main>
  );
}
