import type { PurchaseService } from "@/lib/package-purchases";
import { cn } from "@/lib/cn";

/**
 * Os serviços de uma compra de pacote com o uso de cada um (o Avec grava uma linha por serviço; a tela mostra uma compra só).
 * Só quando a compra tem mais de um serviço: com um só, o nome dele vai na linha do pacote (`servicesLine`).
 */
export function PurchaseServiceList({ p, className }: { p: { packageName: string; services: PurchaseService[] }; className?: string }) {
  if (p.services.length < 2) return null;
  return (
    <ul aria-label={`Serviços do pacote ${p.packageName}`} className={cn("flex flex-col gap-0.5 text-graphite", className)}>
      {p.services.map((s) => (
        <li key={s.id} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 break-words">{s.label}</span>
          <span className="shrink-0 tabular">{s.usedSessions} de {s.totalSessions}</span>
        </li>
      ))}
    </ul>
  );
}
