import Link from "next/link";
import type { ReactNode } from "react";
import type { AlertItem } from "@/server/queries/alerts";
import type { AttendanceDue, StaleRow, TodayBirthday, TodayItem, TodayTask } from "@/server/queries/today";
import type { ScheduledList } from "@/server/queries/scheduled-list";
import type { TeamNow } from "@/server/queries/team-now";
import type { AgendaMode } from "@/lib/agenda-settings";
import { clientLabel, sinceLabel } from "@/lib/alert-copy";
import { dayNumbers, type DayVisit } from "@/lib/day-visit";
import { displayName } from "@/lib/display-name";
import { hidePhone } from "@/lib/hide-phone";
import { leadHref } from "@/lib/lead-href";
import { dueLabel } from "@/lib/next-action";
import { queueHref } from "@/lib/queue";
import { staleHref } from "@/lib/report-links";
import { seconds } from "@/lib/format";
import { TEAM_STATE_LABEL } from "@/lib/team-now";
import { cn } from "@/lib/cn";
import { IconArrowRight } from "@/components/icons";
import { ProgramadasHoje } from "@/components/queue/programadas-hoje";
import { TeamRows } from "@/components/team/team-now";
import { AttendanceList } from "./attendance-list";
import { BirthdaysPanel } from "./birthdays-today";
import { DayTable } from "./day-table";
import { NextActionsPanel } from "./next-actions";
import { PreviewRow, ResumoBloco } from "./resumo-bloco";
import { WaitingList, WaitStatusText } from "./waiting-list";

/*
 * O Hoje como resumo (protótipo v3, aprovado pelo dono em 17/10): "um local que junta informações e avisa". Faixa escura com o que é da
 * pessoa agora e uma grade de blocos compactos; cada bloco abre o painel grande com a lista completa. Quem tinha bloco próprio e saiu
 * (comparecimentos, parados, cobranças, programadas, tempo médio) virou linha num bloco ou seção num painel: nada some sem caminho.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const capFirst = (s: string) => (s ? s[0].toLocaleUpperCase("pt-BR") + s.slice(1) : s);
const nameOf = (i: Pick<TodayItem, "name" | "phone">) => (i.name?.trim() ? displayName(i.name) : capFirst(clientLabel(null, i.phone)));
const lateFirst = <T extends { late?: boolean }>(xs: T[]) => [...xs.filter((x) => x.late), ...xs.filter((x) => !x.late)];
const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Bahia" });
const PREVIA = 3;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section aria-label={title} className="mt-6 first:mt-0"><h3 className="mb-1 text-sm font-semibold text-graphite">{title}</h3>{children}</section>;
}

/** Lista de conversas com link (cobranças, retomadas): nome (nunca telefone cru) e o detalhe à direita. */
function ItemList({ items, render }: { items: TodayItem[]; render: (i: TodayItem) => string }) {
  return (
    <ul className="divide-y divide-line/70">
      {items.map((i) => (
        <li key={i.id + (i.extra ?? "")}>
          <Link href={leadHref(i.id)} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink">
            <span className="min-w-0 break-words">{nameOf(i)}</span><span className="shrink-0 text-muted">{render(i)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A faixa escura do alto: só o que é DA PESSOA agora (conversas em que ela é a dona, combinados dela, avisos não lidos para ela). */
export function ParaVoceAgora({ waitingMine, waiting, tasks, alerts }: { waitingMine: TodayItem[]; waiting: TodayItem[]; tasks: TodayTask[]; alerts: AlertItem[] }) {
  const parts = [
    waitingMine.length ? plural(waitingMine.length, "conversa esperando você", "conversas esperando você") : null,
    tasks.length ? plural(tasks.length, "combinado para hoje", "combinados para hoje") : null,
    alerts.length ? plural(alerts.length, "aviso", "avisos") : null,
  ].filter(Boolean);
  const next = lateFirst(waitingMine)[0] ?? lateFirst(waiting)[0];
  return (
    <section data-testid="para-voce" aria-label="Para você agora" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] bg-ink px-5 py-4 text-paper">
      <div className="min-w-0">
        <p className="text-[17px] font-semibold">Para você agora</p>
        <p className="mt-0.5 text-sm text-paper/70">{parts.length ? parts.join(" · ") : "Nada pendente para você agora."}</p>
      </div>
      {next && (
        <Link href={leadHref(next.id)} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-[var(--radius-control)] bg-gold px-4 text-base font-semibold text-ink transition-transform active:scale-[0.98]">
          Atender próxima <IconArrowRight size={16} />
        </Link>
      )}
    </section>
  );
}

/** Meus combinados (até 3) e, só quando há algo, as linhas de quem saiu do Hoje: sem responsável, cobranças, comparecimentos e programadas. */
export function CombinadosBloco({ tasks, unassigned, dues, attendance, programadas, nowMs }: {
  tasks: TodayTask[]; unassigned: TodayTask[] | null; dues: TodayItem[]; attendance: AttendanceDue[]; programadas: Pick<ScheduledList, "pending" | "total">; nowMs: number;
}) {
  const extras: [string, number][] = ([
    ["Sem responsável", unassigned?.length ?? 0], ["Cobranças e recontatos", dues.length],
    ["Comparecimentos para conferir", attendance.length], ["Mensagens programadas hoje", programadas.pending.length],
  ] as [string, number][]).filter(([, n]) => n > 0);
  const panel = (
    <>
      <NextActionsPanel mine={tasks} unassigned={unassigned} nowMs={nowMs} idPrefix="combinados-todos" />
      {dues.length > 0 && <Section title="Cobranças e recontatos"><ItemList items={dues} render={(i) => i.extra ?? ""} /></Section>}
      {attendance.length > 0 && <Section title="Comparecimentos para conferir"><AttendanceList items={attendance} nowMs={nowMs} /></Section>}
      {programadas.total > 0 && <div className="mt-6"><ProgramadasHoje today={programadas.pending} total={programadas.total} /></div>}
    </>
  );
  return (
    <ResumoBloco id="combinados" title="Meus combinados" count={tasks.length} empty={!tasks.length && !extras.length} panel={panel}
      panelPhrase="Os combinados vencidos e os de hoje. Concluir tira da lista.">
      {!tasks.length && <p className="text-sm text-muted">Nada seu para hoje.</p>}
      {tasks.slice(0, PREVIA).map((t) => (
        <PreviewRow key={t.id} left={hidePhone(t.title, t.name, t.phone)}
          right={<span className={cn(t.overdue && "text-alert")}>{dueLabel(new Date(t.dueAt).getTime(), nowMs)}{t.overdue ? " · atrasado" : ""}</span>} />
      ))}
      {extras.map(([label, n]) => <PreviewRow key={label} left={label} right={n} />)}
    </ResumoBloco>
  );
}

/** Os avisos do sino para a pessoa, ainda não lidos (até 3, cada um já é um link); o painel tem todos, cada um levando aonde o aviso leva. */
export function AvisosBloco({ alerts, nowMs }: { alerts: AlertItem[]; nowMs: number }) {
  const text = (a: AlertItem) => hidePhone(a.message, a.contactName, a.phone);
  const when = (a: AlertItem) => sinceLabel(new Date(a.createdAt).getTime(), nowMs);
  return (
    <ResumoBloco id="avisos" title="Avisos para você" count={alerts.length} empty={!alerts.length}
      panel={alerts.length ? (
        <ul className="divide-y divide-line/70">
          {alerts.map((a) => (
            <li key={a.id}>
              <Link href={a.href} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink">
                <span className="min-w-0 break-words">{text(a)}</span><span className="shrink-0 text-muted tabular">{when(a)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">Nenhum aviso novo para você.</p>}
      panelPhrase="Os avisos do sino no seu nome que você ainda não abriu.">
      {!alerts.length && <p className="text-sm text-muted">Nenhum aviso novo.</p>}
      {/* Cada aviso da prévia abre com um toque (QA r58, I-6: o pedido do site vai direto aos Pedidos do site), por cima do "Ver todos". */}
      {alerts.slice(0, PREVIA).map((a) => (
        <PreviewRow key={a.id} right={when(a)}
          left={<Link href={a.href} className="pointer-events-auto relative z-10 -my-1.5 inline-flex min-h-11 items-center underline-offset-4 hover:text-gold-ink hover:underline lg:min-h-8">{text(a)}</Link>} />
      ))}
    </ResumoBloco>
  );
}

/** Aniversário hoje (até 3, com "Parabéns"); o painel tem todas, com "Mandar parabéns", e os próximos 7 dias. */
export function AniversarioBloco({ items }: { items: TodayBirthday[] }) {
  const today = items.filter((b) => b.today);
  const next = items.length - today.length;
  return (
    <ResumoBloco id="aniversario" title="Aniversário hoje" count={today.length} empty={!today.length} panel={<BirthdaysPanel items={items} />}
      panelPhrase="Quem faz aniversário hoje e nos próximos 7 dias. “Mandar parabéns” só preenche a mensagem na conversa; nada sai sem você enviar.">
      {!today.length && <p className="text-sm text-muted">Nenhum hoje · {next} nos próximos 7 dias</p>}
      {today.slice(0, PREVIA).map((b) => (
        <PreviewRow key={b.contactId} left={displayName(b.name)}
          right={<span className="rounded-full bg-gold-soft px-2 py-0.5 text-xs font-semibold text-gold-ink">Parabéns</span>} />
      ))}
    </ResumoBloco>
  );
}

/** O dia na Casa (2 colunas): os números, as 2 próximas chegadas e "Ver o dia todo", que abre a tabela do dia no painel grande. */
export function DiaNaCasaBloco({ visits, nowMs, caixaOn, canMark, agendaMode }: { visits: DayVisit[]; nowMs: number; caixaOn: boolean; canMark: boolean; agendaMode: AgendaMode }) {
  const d = dayNumbers(visits, nowMs, { caixaOn });
  const nums: [number, string, boolean?][] = [[d.inHouse, "na Casa"], [d.toCome, "a chegar"], [d.done, "finalizaram"]];
  if (d.toPay != null) nums.push([d.toPay, "faltam pagar", d.toPay > 0]);
  nums.push([d.noShow, "não vieram"]);
  return (
    <ResumoBloco id="dia" title="O dia na Casa" countLabel={plural(d.total, "cliente", "clientes")} wide empty={!d.total} more="Ver o dia todo"
      panel={<DayTable visits={visits} nowMs={nowMs} caixaOn={caixaOn} canMark={canMark} agendaMode={agendaMode} />}>
      {!d.total ? <p className="text-sm text-muted">Ninguém na Agenda hoje.</p> : (
        <>
          <div data-testid="dia-numeros" className="flex flex-wrap gap-x-6 gap-y-2 pb-1.5 pt-0.5">
            {nums.map(([n, label, warn]) => (
              <div key={label} className="grid text-[12.5px] text-muted">
                <b className={cn("font-display text-[26px] font-light leading-none tabular", warn ? "text-gold-ink" : "text-ink")}>{n}</b>{label}
              </div>
            ))}
          </div>
          {d.next.map((v) => {
            const s = v.services[0];
            const more = v.services.length - 1;
            return <PreviewRow key={v.key} left={<><b className="tabular">{HORA.format(new Date(v.entry))}</b> {v.name} · {s.service}{s.pro ? ` com ${s.pro}` : ""}{more > 0 ? ` +${more}` : ""}</>} />;
          })}
        </>
      )}
    </ResumoBloco>
  );
}

/** Esperando resposta, da equipe toda (até 2); o painel tem a lista, o contador de atrasados que leva à Fila e o tempo médio de resposta. */
export function EsperandoBloco({ waiting, late, resp }: { waiting: TodayItem[]; late: number; resp: { n: number; avg: number; within: number; goal: number } }) {
  const shown = lateFirst(waiting);
  return (
    <ResumoBloco id="esperando" title="Esperando resposta" count={waiting.length} empty={!waiting.length} more="Abrir as conversas"
      panelPhrase="Atrasados primeiro, depois quem espera há mais tempo."
      panelFooter={<Link href="/atendimento" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-ink px-4 text-sm font-semibold text-paper lg:min-h-10">Abrir a fila</Link>}
      panel={<>
        {late > 0 && (
          <Link href={queueHref({ foco: "atrasados" })} className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-alert underline decoration-alert/40 underline-offset-4 hover:decoration-alert">
            {plural(late, "atrasado", "atrasados")} · ver na fila <IconArrowRight size={14} />
          </Link>
        )}
        <WaitingList items={waiting} limit={40} />
        <p className="mt-4 border-t border-line/70 pt-3 text-sm text-graphite">
          Tempo médio de resposta hoje: <b className={cn("tabular", resp.n && resp.avg > resp.goal ? "text-alert" : "text-ink")}>{resp.n ? seconds(resp.avg) : "—"}</b>
          <span className="text-muted"> · {resp.n ? `${resp.within} de ${resp.n} em até ${seconds(resp.goal)} (a meta)` : `meta: responder em até ${seconds(resp.goal)}`}</span>
        </p>
      </>}>
      {late > 0 && <p className="text-sm font-medium text-alert">{plural(late, "atrasado", "atrasados")}</p>}
      {!waiting.length && <p className="text-sm text-muted">Ninguém esperando.</p>}
      {shown.slice(0, 2).map((i) => <PreviewRow key={i.id} left={nameOf(i)} right={<span className={cn(i.late && "text-alert")}><WaitStatusText i={i} /></span>} />)}
    </ResumoBloco>
  );
}

/** Para retomar: os parados além do limite da etapa (era "Parados agora") e as retomadas por etapa. Cada linha tem o próprio número. */
export function RetomarBloco({ followups, stale }: { followups: TodayItem[]; stale: StaleRow[] }) {
  const parados = stale.reduce((a, r) => a + r.parados, 0);
  const byStage = [...followups.reduce((m, i) => m.set(i.stageName, (m.get(i.stageName) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  return (
    <ResumoBloco id="retomar" title="Para retomar" empty={!parados && !followups.length} more="Ver todas"
      panel={<>
        {parados > 0 && (
          <Section title="Conversas paradas além do limite da etapa">
            <ul className="divide-y divide-line/70">
              {stale.map((r) => (
                <li key={r.stageKey}>
                  <Link href={staleHref(r.stageKey)} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink">
                    <span className="min-w-0 break-words">{r.stage}</span><span className="shrink-0 text-muted tabular">{plural(r.parados, "parado", "parados")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title="Para retomar">{followups.length ? <ItemList items={followups} render={(i) => i.stageName} /> : <p className="text-sm text-muted">Ninguém para retomar.</p>}</Section>
      </>}>
      {!parados && !followups.length && <p className="text-sm text-muted">Ninguém para retomar.</p>}
      {parados > 0 && <PreviewRow left="Conversas paradas" right={parados} />}
      {byStage.slice(0, parados > 0 ? 2 : 3).map(([stage, n]) => <PreviewRow key={stage} left={stage} right={n} />)}
    </ResumoBloco>
  );
}

/** Equipe agora: quem está respondendo e quantas esperam cada uma; o painel tem a última resposta de cada uma e o "Sem dono". */
export function EquipeBloco({ team, now }: { team: TeamNow; now: Date }) {
  return (
    <ResumoBloco id="equipe" title="Equipe agora" empty={!team.members.length} more="Ver equipe"
      panelPhrase="Quem está respondendo (pelo CRM ou, pela assinatura, pelo celular) e quantas conversas esperam cada uma."
      panel={<>{!team.members.length && <p className="text-sm text-muted">Ninguém respondeu nos últimos 7 dias.</p>}<TeamRows team={team} now={now} /></>}>
      {!team.members.length && <p className="text-sm text-muted">Ninguém respondeu nos últimos 7 dias.</p>}
      {team.members.slice(0, PREVIA).map((m) => <PreviewRow key={m.id} left={`${m.name} · ${TEAM_STATE_LABEL[m.state]}`} right={`${m.waiting} esperando`} />)}
    </ResumoBloco>
  );
}
