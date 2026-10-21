import { requirePro } from "@/server/auth/pro-session";
import { listMyLeaves } from "@/server/domain/pro/leave";
import { todayBahia } from "@/lib/agenda";
import { LeaveForm } from "@/components/pro/leave-form";
import { cn } from "@/lib/cn";

export const metadata = { title: "Folga" };
const STATUS = { pedido: "Aguardando a recepção", aprovado: "Aprovada", recusado: "Recusada" } as const;

export default async function ProLeavePage() {
  const { pro } = await requirePro();
  if (!pro) return null;
  const mine = await listMyLeaves(pro);
  return (
    <main className="flex flex-col gap-4">
      <h1 className="font-display text-xl">Pedir folga ou bloqueio</h1>
      <LeaveForm today={todayBahia(new Date())} />
      {mine.length > 0 && (
        <section aria-labelledby="meus-pedidos">
          <h2 id="meus-pedidos" className="mb-2 font-medium">Seus pedidos</h2>
          <ul className="flex flex-col gap-2">
            {mine.map((l) => (
              <li key={l.id} className="rounded-[var(--radius-control)] border border-line px-3 py-2">
                <p>{l.title} · {l.period}</p>
                <p className={cn("text-sm", l.status === "recusado" ? "text-alert" : l.status === "aprovado" ? "text-ok" : "text-gold-ink")}>{STATUS[l.status]}{l.status === "recusado" && l.note ? `: ${l.note}` : ""}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
