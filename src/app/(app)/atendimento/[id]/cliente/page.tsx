import Link from "next/link";
import { can } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { requirePerm } from "@/server/auth/session";
import { getQueueItem } from "@/server/queries/queue";
import { getShellBanners } from "@/server/queries/banners";
import { ConversationPane } from "@/components/queue/conversation-pane";
import { ViewportRedirect } from "@/components/queue/queue-route";
import { IconArrowRight } from "@/components/icons";
import { isUuid } from "@/lib/uuid";

export const metadata = { title: "Cliente" };

/** Celular, terceiro passo da sequência: lista → conversa → dados do cliente. Abre direto na aba Dados (o painel do cliente). */
export default async function ClientePage({ params }: PageProps<"/atendimento/[id]/cliente">) {
  const user = await requirePerm("atendimento.ver");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [item, banners] = await Promise.all([getQueueItem(id), getShellBanners()]);
  if (!item) notFound();
  return (
    <main className="h-dvh flex flex-col overflow-hidden">
      {/* Desktop: a conversa com os painéis mora em /atendimento/ID (que não redireciona de volta). */}
      <ViewportRedirect when="desktop" to={`/atendimento/${id}`} />
      <div className="shrink-0 flex items-center px-3 h-12 border-b border-line bg-paper">
        <Link href={`/atendimento/${id}`} className="inline-flex items-center gap-2 min-h-11 px-3 -ml-1 rounded-[var(--radius-control)] text-sm font-medium text-ink hover:bg-paper-2">
          <IconArrowRight size={15} className="rotate-180" aria-hidden />Voltar para a conversa
        </Link>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)]">
        <ConversationPane key={id} dealId={id} initial={item} initialTab="dados" back={false} wa={{ down: banners.disconnected, href: can(user.perms, "config.sistema") ? "/config/whatsapp" : "/atendimento" }} />
      </div>
    </main>
  );
}
