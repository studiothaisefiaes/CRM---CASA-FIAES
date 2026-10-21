import { Badge } from "@/components/ui/badge";
import { Card } from "./blocks";
import { VISIT_STATUS_LABEL, type VisitDay } from "@/lib/visit-days";
import { displayName } from "@/lib/client-rhythm";
import { brDay } from "@/lib/client-avec";
import { formatBRL } from "@/lib/money";

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const TONE: Record<string, "ok" | "alert" | "gold" | "neutral"> = { compareceu: "ok", faltou: "alert", cancelado: "neutral", agendado: "gold", confirmado: "gold" };

/** 8. Visitas passadas e futuras juntas, com profissional, situação e a observação do horário; os itens da comanda do mesmo dia. */
export function VisitsBlock({ days, money }: { days: VisitDay[]; money: boolean }) {
  return (
    <Card id="visitas" title="Visitas">
      {days.length === 0 ? <p className="text-sm text-graphite">Nenhuma visita registrada no Avec nem no CRM.</p> : (
        <ol className="divide-y divide-line/70">
          {days.map((d) => (
            <li key={d.day} className="py-3">
              <p className="text-sm font-semibold tabular">{brDay(d.day)}{d.future ? " · marcado" : ""}{money && d.totalCents != null ? ` · ${formatBRL(d.totalCents)}` : ""}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {d.appointments.map((a) => (
                  <li key={a.id}>
                    <span className="tabular text-graphite">{hora(a.startsAt)}</span> · {a.serviceLabel}{a.professionalName ? ` · ${displayName(a.professionalName)}` : ""}{" "}
                    <Badge tone={TONE[a.status] ?? "neutral"}>{VISIT_STATUS_LABEL[a.status] ?? a.status}</Badge>
                    {a.notes && <p className="mt-0.5 whitespace-pre-line text-graphite">Observação: {a.notes}</p>}
                  </li>
                ))}
                {d.items.map((i) => (
                  <li key={i.id} className="text-graphite">
                    {i.item}{i.professionalName ? ` · ${displayName(i.professionalName)}` : ""}{i.fromPackage ? " · do pacote" : ""}{money && i.totalCents != null ? ` · ${formatBRL(i.totalCents)}` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
