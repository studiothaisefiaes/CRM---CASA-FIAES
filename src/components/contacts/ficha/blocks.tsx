import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ProfileField } from "./editable";
import { ReturnActions } from "./return-actions";
import { LoyaltyOpener } from "./loyalty";
import { loyaltySummary } from "@/lib/loyalty";
import { GoToTab } from "./tabs";
import { SITUATION_STATE_LABEL, type Situation, type SituationState } from "@/lib/client-situation";
import { daysBetween, displayName, returnLine } from "@/lib/client-rhythm";
import { appointmentLine, brDay, packagePercent } from "@/lib/client-avec";
import { validityLabel } from "@/lib/agenda";
import { conversationFacts, isOpenPackage, lastVisit } from "@/lib/ficha";
import { dueLabel } from "@/lib/next-action";
import { formatBRL } from "@/lib/money";
import { leadHref } from "@/lib/lead-href";
import { stripSignature } from "@/lib/signature";
import { cn } from "@/lib/cn";
import type { ClientSnapshot } from "@/server/queries/client-snapshot";
import type { ContactDeal, ContactDetail } from "@/server/queries/contact";
import type { LoyaltyView } from "@/server/queries/loyalty-view";
import type { ContactAvecData, SalePaymentItem } from "@/server/queries/avec";

const H2 = "text-lg font-semibold tracking-[-0.01em]";
const LABEL = "text-sm font-semibold text-graphite";
const LINK = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 text-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink lg:min-h-0";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthYear = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]}/${day.slice(0, 4)}`;
const vezes = (n: number) => `${n} ${n === 1 ? "vez" : "vezes"}`;
const ha = (n: number) => (n === 0 ? "hoje" : n === 1 ? "ontem" : `há ${n} dias`);

/** Seção das abas (Horários, Pagamentos, Conversas, Notas): título e conteúdo, sem caixa alta. */
export function Card({ id, title, children, extra }: { id: string; title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-4 lg:p-5" aria-labelledby={`h-${id}`} data-bloco={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id={`h-${id}`} className={H2}>{title}</h2>{extra}</div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Cartão do Resumo: fundo de painel, rótulo pequeno, conteúdo. */
function Box({ id, label, children, extra, className }: { id: string; label: string; children: ReactNode; extra?: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={`h-${id}`} data-bloco={id} className={cn("flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-card)] bg-paper-2 p-4", className)}>
      <div className="flex items-baseline justify-between gap-2"><h2 id={`h-${id}`} className={LABEL}>{label}</h2>{extra}</div>
      {children}
    </section>
  );
}

const STATE_TONE: Record<SituationState, "alert" | "ink" | "neutral"> = { sem_dono: "neutral", atrasada: "alert", sumida: "alert", na_hora_de_voltar: "ink", aniversario: "neutral" };

/** A situação em uma frase (montada no servidor) e os estados. */
export function SituationBlock({ situation }: { situation: Situation }) {
  return (
    <section aria-label="Situação agora" data-bloco="situacao" className="rounded-[var(--radius-card)] border border-line bg-paper px-4 py-3">
      <p data-testid="frase-situacao" className="text-base leading-relaxed text-ink first-letter:uppercase">{situation.sentence}</p>
      {situation.states.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Estados da cliente">
          {situation.states.map((s) => <li key={s}><Badge tone={STATE_TONE[s]}>{SITUATION_STATE_LABEL[s]}</Badge></li>)}
        </ul>
      )}
    </section>
  );
}

const APPT_STATUS: Record<string, { label: string; tone: "ok" | "neutral" }> = { agendado: { label: "Agendado", tone: "neutral" }, confirmado: { label: "Confirmado", tone: "ok" } };

/**
 * A aba Resumo: cartões em grade. Próximo horário, pacote em uso, última visita, hora de voltar, situação da conversa e os números
 * (total gasto e ticket só para quem vê valores: o servidor nem manda).
 */
export function SummaryGrid({ contactId, snap, avec, now, today, money, canSchedule, consultoria, fidelidade }: {
  contactId: string; snap: ClientSnapshot; avec: ContactAvecData; now: number; today: string; money: boolean; canSchedule: boolean;
  /** O cartão da Consultoria (só para quem vê as fichas, com a função ligada). */ consultoria?: { answered: number; total: number; lastDay: string | null };
  /** O cartão da Fidelidade (só com a função ligada). */ fidelidade?: LoyaltyView;
}) {
  const next = avec.proximos[0] ?? null;
  const pkg = avec.pacotes.find(isOpenPackage) ?? null;
  const visit = lastVisit(avec.historico);
  const lastDay = visit?.day ?? snap.stats.lastVisitOn;
  const retorno = snap.situation.retorno;
  const conv = snap.conversation;
  const facts = conv ? conversationFacts(conv, now) : null;
  const more = (tab: "horarios" | "pacotes" | "conversas", label: string) => <GoToTab tab={tab} money={money} className={LINK}>{label}</GoToTab>;
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      <Box id="proximo" label="Próximo horário" extra={avec.proximos.length > 1 ? more("horarios", `Ver todos (${avec.proximos.length})`) : null}>
        {next ? (
          <>
            <p className="text-base font-semibold text-ink first-letter:uppercase">{appointmentLine({ startsAt: next.startsAt, serviceLabel: next.serviceLabel, professionalName: null }, now)}</p>
            <p className="text-sm text-graphite">{[displayName(next.professionalName) ? `Com ${displayName(next.professionalName)}` : "Profissional não informada", next.durationMin ? `${next.durationMin} min` : null].filter(Boolean).join(" · ")}</p>
            {APPT_STATUS[next.status] && <span><Badge tone={APPT_STATUS[next.status].tone}>{APPT_STATUS[next.status].label}</Badge></span>}
          </>
        ) : <p className="text-sm text-graphite">Nenhum horário marcado.</p>}
      </Box>

      <Box id="pacote" label="Pacote em uso" extra={avec.pacotes.length ? more("pacotes", "Ver pacotes") : null}>
        {pkg ? (
          <>
            <p className="break-words text-base font-semibold text-ink">{pkg.packageName}</p>
            <div role="meter" aria-valuemin={0} aria-valuemax={pkg.totalSessions} aria-valuenow={Math.min(pkg.usedSessions, pkg.totalSessions)} aria-label={`${pkg.usedSessions} de ${pkg.totalSessions} sessões usadas`}
              className="h-2 overflow-hidden rounded-full bg-paper-3">
              <div className="h-full rounded-full bg-ink-2" style={{ width: `${packagePercent(pkg.usedSessions, pkg.totalSessions)}%` }} />
            </div>
            <p className="text-sm text-graphite">
              <span className="font-semibold tabular text-ink">{pkg.usedSessions} de {pkg.totalSessions}</span> sessões
              {pkg.validUntil ? <> · <span className={cn(pkg.expiringSoon && "font-medium text-ink")}>{validityLabel(pkg.validUntil, today)}</span></> : null}
            </p>
          </>
        ) : <p className="text-sm text-graphite">{avec.pacotes.length ? "Nenhum pacote em uso (os encerrados estão na aba Pacotes)." : "Sem pacote."}</p>}
      </Box>

      <Box id="ultima-visita" label="Última visita">
        {lastDay ? (
          <>
            <p className="text-base font-semibold text-ink"><span className="tabular">{brDay(lastDay)}</span> <span className="font-normal text-graphite">· {ha(Math.max(0, daysBetween(lastDay, today)))}</span></p>
            {visit && visit.day === lastDay && (visit.services.length > 0 || visit.professionals.length > 0) && (
              <p className="text-sm text-graphite">{[visit.services.join(", "), visit.professionals.length ? `Com ${visit.professionals.join(" e ")}` : null].filter(Boolean).join(" · ")}</p>
            )}
          </>
        ) : <p className="text-sm text-graphite">Ainda não veio à Casa.</p>}
        {snap.stats.topServices.length > 0 && <p className="mt-auto pt-1 text-sm text-graphite">Mais feitos: {snap.stats.topServices.map((x) => `${x.item} (${x.n}×)`).join(", ")}</p>}
      </Box>

      <Box id="retorno" label="Hora de voltar">
        <p className="text-sm text-ink">{retorno ? returnLine(retorno, today) : "Sem previsão ainda: o ritmo aparece a partir da 3ª visita (ou com o ciclo do serviço cadastrado)."}</p>
        <ReturnActions contactId={contactId} dueOn={retorno && retorno.status !== "agendada" ? retorno.dueOn : null} canSchedule={canSchedule} />
      </Box>

      <Box id="agora" label="Conversa">
        {conv && facts ? (
          <>
            <p className="flex flex-wrap items-center gap-1.5">
              <Badge>{facts.stage}</Badge>
              <span className="inline-flex h-[22px] items-center gap-1.5 rounded-[6px] bg-paper px-2 text-xs font-semibold" style={{ color: facts.color }}>
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: facts.color }} />{facts.status}
              </span>
            </p>
            <p className="text-sm text-ink">{facts.with}</p>
            <p className="text-sm text-graphite">Retomada: {facts.retomada ?? "nenhuma marcada"}</p>
            <Link href={leadHref(conv.dealId)} className={LINK}>Abrir conversa</Link>
          </>
        ) : <p className="text-sm text-graphite">Nenhuma conversa em andamento.</p>}
      </Box>

      <NumbersBlock snap={snap} money={money} />
      {consultoria && <ConsultoriaCard {...consultoria} money={money} />}
      {fidelidade && <LoyaltyCard view={fidelidade} />}
    </div>
  );
}

/** O cartão pequeno da Consultoria no Resumo: quanto da anamnese está respondido e a última consultoria. Abre a aba Consultoria. */
export function ConsultoriaCard({ answered, total, lastDay, money }: { answered: number; total: number; lastDay: string | null; money: boolean }) {
  return (
    <Box id="consultoria" label="Consultoria" extra={<GoToTab tab="consultoria" money={money} className={LINK} label="Abrir Consultoria">Abrir</GoToTab>}>
      <p className="text-sm text-ink">{total > 0 ? `Anamnese: ${answered} de ${total} respondidas` : "Anamnese: nenhuma pergunta em uso"}</p>
      <p className="text-sm text-graphite">{lastDay ? `Última consultoria: ${brDay(lastDay)}` : "Nenhuma consultoria ainda."}</p>
    </Box>
  );
}

/** O cartão pequeno da Fidelidade no Resumo: uma linha por programa ("Fiel da Fiaes 9 de 12"). "Abrir" mostra tudo e o histórico. */
export function LoyaltyCard({ view }: { view: LoyaltyView }) {
  const lines = loyaltySummary(view.programs);
  return (
    <Box id="fidelidade" label="Fidelidade" extra={<LoyaltyOpener view={view} />}>
      {lines.length === 0 ? <p className="text-sm text-graphite">Nenhum programa em uso.</p> : (
        <ul className="flex flex-col gap-1">
          {lines.map((l) => <li key={l.id} className="flex items-center gap-2 text-sm text-ink"><span className="tabular">{l.text}</span>{l.ready && <Badge tone="ok">Prêmio disponível</Badge>}</li>)}
        </ul>
      )}
    </Box>
  );
}

/** Números: visitas, desde, frequência, faltas e cancelamentos para todas; ticket e total só com "ver valores". */
export function NumbersBlock({ snap, money }: { snap: ClientSnapshot; money: boolean }) {
  const s = snap.stats;
  const items: [string, string][] = [];
  if (money) items.push(["Total gasto", formatBRL(s.totalCents ?? 0)]);
  items.push(["Visitas", String(s.visits)]);
  if (money) items.push(["Ticket médio", s.ticketCents != null ? formatBRL(s.ticketCents) : "—"]);
  items.push(
    ["Desde", s.firstVisitOn ? monthYear(s.firstVisitOn) : snap.knownSince ? monthYear(snap.knownSince.slice(0, 10)) : "—"],
    ["Frequência", s.rhythmDays ? `~${s.rhythmDays} dias` : "—"],
    ["Faltas", String(s.noShows)],
    ["Cancelamentos", String(s.cancellations)],
  );
  return (
    <Box id="numeros" label="Números">
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
        {items.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-xs text-muted">{k}</dt><dd className="truncate text-base font-semibold leading-tight tabular text-ink">{v}</dd></div>)}
      </dl>
    </Box>
  );
}

/** Pagamentos (só com "ver valores"): pagamentos e os lançamentos de Dívida e Crédito Cliente. O Avec não manda saldo. */
export function FinanceBlock({ snap, payments }: { snap: ClientSnapshot; payments: SalePaymentItem[] }) {
  const f = snap.finance;
  return (
    <Card id="financeiro" title="Pagamentos">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2"><dt className="text-xs text-muted">Lançado como Dívida no Avec</dt><dd>{f.debtCount ? `${formatBRL(f.debtCents ?? 0)} · ${vezes(f.debtCount)} · última em ${brDay(f.lastDebtOn)}` : "Nada lançado"}</dd></div>
        <div className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2"><dt className="text-xs text-muted">Lançado como Crédito Cliente no Avec</dt><dd>{f.creditCount ? `${formatBRL(f.creditCents ?? 0)} · ${vezes(f.creditCount)}` : "Nada lançado"}</dd></div>
      </dl>
      <p className="mt-1.5 text-xs text-muted">São os lançamentos com essas formas de pagamento, não o saldo de hoje.</p>
      {payments.length === 0 ? <p className="mt-3 text-sm text-graphite">Nenhum pagamento registrado.</p> : (
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Dia</th><th className="font-medium">Comanda</th><th className="font-medium">Forma</th><th className="text-right font-medium">Valor</th></tr></thead>
          <tbody>
            {payments.slice(0, 30).map((p) => (
              <tr key={p.id} className="border-t border-line/70">
                <td className="py-1.5 tabular">{brDay(p.paidOn ?? p.comandaOn)}</td><td className="tabular">{p.comanda ?? "—"}</td>
                <td>{p.method ?? "—"}</td><td className="text-right tabular">{p.valueCents != null ? formatBRL(p.valueCents) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Notas: anotações (campo único da cliente) e avisos fixos (alergias, "só com a Heloísa"…). */
export function NotesBlock({ contactId, notes, alertNotes }: { contactId: string; notes: string | null; alertNotes: string | null }) {
  return (
    <Card id="anotacoes" title="Notas">
      <div className="grid gap-4 xl:grid-cols-2">
        <ProfileField contactId={contactId} name="notes" label="Anotações da cliente" kind="textarea" value={notes ?? ""} placeholder="Vale para todas as conversas dela…" />
        <ProfileField contactId={contactId} name="alertNotes" label="Avisos fixos" kind="textarea" value={alertNotes ?? ""}
          placeholder="Ex.: Alérgica a amônia" hint="Uma linha por aviso. Aparecem em destaque aqui e na conversa." />
      </div>
    </Card>
  );
}

/** A conversa resumida (última mensagem e quem mandou, quantas conversas) e o Histórico completo recolhido. */
export function ConversationBlock({ data, now, children }: { data: ContactDetail; now: number; children: ReactNode }) {
  const last = data.messages.at(-1);
  const open = data.deals.find((d) => d.open);
  return (
    <Card id="conversa" title="Última mensagem">
      {last ? (
        <p className="text-sm"><span className="text-muted">{last.direction === "in" ? "Ela" : displayName(last.sender) ?? "A Casa"} · {dueLabel(last.createdAt.getTime(), now)}: </span>{stripSignature(last.body) || "(mídia)"}</p>
      ) : <p className="text-sm text-graphite">Nenhuma mensagem ainda.</p>}
      <p className="mt-1 text-xs text-muted">{data.deals.length} {data.deals.length === 1 ? "conversa" : "conversas"} · {data.messageTotal} mensagens</p>
      {open && <Link href={leadHref(open.id)} className={LINK}>Abrir conversa</Link>}
      <details className="mt-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink lg:min-h-0">Histórico completo</summary><div className="mt-2">{children}</div></details>
    </Card>
  );
}

function dealStatus(d: ContactDeal): { label: string; tone: "ok" | "alert" | "neutral" } {
  if (d.merged) return { label: "Mesclado (mesmo número)", tone: "neutral" };
  if (d.archived) return { label: "Não é cliente", tone: "neutral" };
  if (d.stageKind === "fechado") return { label: "Venda fechada", tone: "ok" };
  if (d.stageKind === "perdido") return { label: "Perdido", tone: "alert" };
  return { label: d.stageName, tone: "neutral" };
}

/** Todas as conversas (leads), com "Mesclado" separado de "Não é cliente". */
export function LeadsBlock({ deals, day }: { deals: ContactDeal[]; day: (d: Date) => string }) {
  return (
    <Card id="leads" title={`Todas as conversas (${deals.length})`}>
      {deals.length === 0 ? <p className="text-sm text-graphite">Nenhuma conversa ainda.</p> : (
        <ul className="-mx-1 divide-y divide-line/70">
          {deals.map((x) => {
            const st = dealStatus(x);
            const body = (
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5"><Badge tone={st.tone}>{st.label}</Badge><span className="text-sm tabular text-graphite">{day(x.createdAt)}</span></span>
                <span className="mt-1 block text-sm text-graphite">{x.sourceLabel}{x.ownerName ? ` · Com ${displayName(x.ownerName.split(" ")[0])}` : ""}{x.valueCents ? ` · ${formatBRL(x.valueCents)}` : ""}</span>
              </span>
            );
            return <li key={x.id}>{x.archived ? <div className="flex min-h-11 items-center px-1 py-2.5">{body}</div> : <Link href={leadHref(x.id)} className="flex min-h-11 items-center rounded-[var(--radius-control)] px-1 py-2.5 hover:bg-paper-2/60">{body}</Link>}</li>;
          })}
        </ul>
      )}
    </Card>
  );
}
