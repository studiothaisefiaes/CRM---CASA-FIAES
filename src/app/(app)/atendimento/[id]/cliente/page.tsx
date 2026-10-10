import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getDealDetail } from "@/server/queries/deal";
import { LeadPanel } from "@/components/lead/lead-sheet";
import { ViewportRedirect } from "@/components/queue/queue-route";
import { IconArrowRight } from "@/components/icons";
import { leadHref } from "@/lib/lead-href";

export const metadata = { title: "Cliente" };

/** Celular, terceiro passo da sequência: lista → conversa → dados do cliente. A T17 refaz o conteúdo; aqui abre direto na aba Dados. */
export default async function ClientePage({ params }: PageProps<"/atendimento/[id]/cliente">) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getDealDetail(id);
  if (!detail) notFound();
  return (
    <main className="h-[calc(100dvh-3.5rem-5rem)] lg:h-dvh flex flex-col overflow-hidden">
      <ViewportRedirect when="desktop" to={leadHref(id)} />
      <div className="shrink-0 flex items-center px-3 h-12 border-b border-line bg-paper">
        <Link href={`/atendimento/${id}`} className="inline-flex items-center gap-2 min-h-11 px-3 -ml-1 rounded-[var(--radius-control)] text-sm font-medium text-ink hover:bg-paper-2">
          <IconArrowRight size={15} className="rotate-180" aria-hidden />Voltar para a conversa
        </Link>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)]">
        <LeadPanel key={id} d={detail} initialTab="dados" />
      </div>
    </main>
  );
}
