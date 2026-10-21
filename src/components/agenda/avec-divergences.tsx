import Link from "next/link";
import { DIVERGENCE_LABEL, type AvecDivergence, type AvecRejected } from "@/server/domain/agenda/twins";
import { DUPLA_NOTE, hourOf } from "@/lib/agenda-text";
import { STATUS_LABEL, type AgendaStatus } from "@/lib/agenda";
import { Empty } from "@/components/ui/empty";

const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const label = (s: string | null) => (s ? STATUS_LABEL[s as AgendaStatus] ?? s : "sem informação");
const describe = (d: AvecDivergence) =>
  d.kind === "horario_diferente" ? `No CRM às ${hourOf(d.crmStartsAt!)}; no Avec às ${hourOf(d.avecStartsAt!)}.`
    : d.kind === "status_diferente" ? `No CRM: ${label(d.crmStatus)}; no Avec: ${label(d.avecStatus)}.`
    : d.kind === "status_desconhecido" ? `No Avec: «${d.avecStatus ?? "sem informação"}». Marque o que aconteceu no horário.`
    : d.kind === "venda_sem_par" ? "O Avec tem venda da cliente nesse dia, mas não dá para saber se foi deste horário. Marque se ela veio ou faltou."
    : d.kind === "sem_baixa_no_avec" ? `No CRM: ${label(d.crmStatus)}; no Avec continua Agendado. Dê baixa no Avec.`
    : d.kind === "atendimento_longe" ? "O Avec tem outro horário da cliente nesse dia, a mais de 2 h deste. Veja se é a mesma visita."
      : `Marcado no Avec às ${hourOf(d.avecStartsAt!)}, depois da troca para só CRM.`;

const dmy = (day: string) => day.split("-").reverse().join("/");
/** As linhas recusadas, agrupadas pelo motivo. Motivo novo precisa de um grupo aqui. */
const REJECTED_GROUPS: { id: string; reasons: string[]; title: string; note: string; line: (r: AvecRejected) => string }[] = [
  { id: "avec-recusadas", reasons: ["data_fora_do_limite"], title: "Data impossível no Avec",
    note: "Não entraram na agenda. Corrija a data no Avec; na próxima importação saem daqui.",
    line: (r) => `No Avec: ${dmy(r.day)}${r.hm ? ` às ${r.hm}` : ""}.` },
  { id: "avec-fichas-sem-cliente", reasons: ["cliente_nao_encontrada"], title: "Cliente não encontrada no CRM",
    note: "A ficha do Avec não entrou: não há uma cliente com esse nome, ou há mais de uma. Corrija o nome no Avec ou no CRM; na próxima importação saem daqui.",
    line: (r) => `Ficha do Avec, cadastro em ${dmy(r.day)}.` },
];

/** "Conferir com o Avec" (6.4, regra 12): só leitura. A recepção decide o que fazer; o sistema não corrige sozinho. */
export function AvecDivergences({ items, rejected = [] }: { items: AvecDivergence[]; rejected?: AvecRejected[] }) {
  return (
    <div className="flex flex-col gap-4">
      <p role="note" className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">{DUPLA_NOTE}</p>
      {REJECTED_GROUPS.map((g) => {
        const list = rejected.filter((r) => g.reasons.includes(r.reason));
        if (!list.length) return null;
        return (
          <section key={g.id} aria-labelledby={g.id} className="flex flex-col gap-2">
            <h3 id={g.id} className="text-base font-semibold text-ink-2">{g.title} · <span className="tabular">{list.length}</span></h3>
            <p className="-mt-1 text-sm text-graphite">{g.note}</p>
            <ul className="rounded-[var(--radius-panel)] border border-line bg-paper">
              {list.map((r) => (
                <li key={r.id} className="border-t border-line/70 px-4 py-3 first:border-t-0 sm:px-5">
                  <p className="font-medium">{r.clientName}{r.serviceLabel ? ` · ${r.serviceLabel}` : ""}{r.professionalName ? ` com ${r.professionalName}` : ""}</p>
                  <p className="text-sm text-graphite tabular">{g.line(r)}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!items.length ? (rejected.length ? null : (
        <div className="rounded-[var(--radius-panel)] border border-line bg-paper"><Empty title="Nada para conferir">Os horários do CRM e do Avec batem.</Empty></div>
      )) : (
        <ul className="rounded-[var(--radius-panel)] border border-line bg-paper">
          {items.map((d) => (
            <li key={`${d.kind}:${d.appointmentId}:${d.avecAppointmentId ?? ""}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/70 px-4 py-3 first:border-t-0 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{d.clientName} · {d.serviceLabel} · {DM.format(new Date(`${d.day}T12:00:00Z`))}</p>
                <p className="text-sm text-graphite">{DIVERGENCE_LABEL[d.kind]}. {describe(d)}</p>
              </div>
              <Link href={`/agenda?d=${d.day}&destaque=${d.appointmentId}`} className="text-sm font-medium text-gold-ink underline-offset-4 hover:underline">Abrir o horário</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
