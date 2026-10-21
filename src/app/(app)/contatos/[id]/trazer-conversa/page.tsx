import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePerm } from "@/server/auth/session";
import { db } from "@/server/db";
import { contacts } from "@/server/db/schema";
import { isUuid } from "@/lib/uuid";
import { IconArrowRight } from "@/components/icons";
import { WhatsappImport } from "@/components/config/whatsapp-import";

export const metadata = { title: "Trazer conversa antiga do WhatsApp" };

/** Ficha › ⋯ › Trazer conversa antiga do WhatsApp: a mesma tela de Configurações › Trazer dados, com a cliente já escolhida. */
export default async function TrazerConversaPage({ params }: PageProps<"/contatos/[id]/trazer-conversa">) {
  await requirePerm("contatos.ver");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [c] = await db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!c) notFound();
  return (
    <main className="mx-auto w-full max-w-[1480px] px-5 pb-12 lg:px-8">
      <div className="pt-4 lg:pt-6">
        <Link href={`/contatos/${c.id}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-graphite hover:text-ink lg:min-h-0"><IconArrowRight size={14} className="rotate-180" />{c.name ?? "Ficha da cliente"}</Link>
      </div>
      <div className="mt-3"><WhatsappImport contact={c} /></div>
    </main>
  );
}
