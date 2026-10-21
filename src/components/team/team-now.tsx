// src/components/team/team-now.tsx
import Link from "next/link";
import type { TeamNow } from "@/server/queries/team-now";
import { lastReplyLabel, TEAM_STATE_LABEL, type TeamState } from "@/lib/team-now";
import { queueHref } from "@/lib/queue";
import { cn } from "@/lib/cn";
import { firstName } from "@/lib/authorship";

const DOT: Record<TeamState, string> = { respondendo: "bg-ok", no_crm: "bg-ok/50", pausa: "bg-gold", sem_sinal: "bg-line-strong" };

/** As linhas: nome, estado, última resposta (pelo CRM ou pelo celular), quantas esperam e quantas são dela; no fim, "Sem dono". */
export function TeamRows({ team, now, compact = false }: { team: TeamNow; now: Date; compact?: boolean }) {
  const pad = compact ? "py-2" : "py-2.5";
  return (
    <ul className="divide-y divide-line/70">
      {team.members.map((m) => (
        <li key={m.id} className={cn("flex items-start justify-between gap-3", pad)}>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[m.state])} />{m.name}
              <span className="font-normal text-muted">· {TEAM_STATE_LABEL[m.state]}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted">Última resposta: {lastReplyLabel(m.lastReplyAt, m.lastReplyVia, now)}</p>
          </div>
          <p className="shrink-0 text-right text-xs tabular text-graphite">
            <span className={m.waiting ? "font-semibold text-ink" : ""}>{m.waiting} esperando</span><br />{m.mine} {m.mine === 1 ? "conversa" : "conversas"} dela
          </p>
        </li>
      ))}
      <li className={pad}>
        <Link href={queueHref({ view: "sem-dono" })} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink">
          <span className={team.unowned.total ? "font-medium text-gold-ink" : "text-muted"}>Sem dono</span>
          <span className="text-xs tabular text-graphite">{team.unowned.waiting} esperando · {team.unowned.total} no total</span>
        </Link>
      </li>
    </ul>
  );
}

/** Hoje: o painel inteiro. */
export function TeamNowPanel({ team, now }: { team: TeamNow; now: Date }) {
  return (
    <section aria-labelledby="h-equipe" className="rounded-[var(--radius-panel)] border border-line bg-paper px-5 py-4">
      <h2 id="h-equipe" className="text-base font-semibold">Equipe agora</h2>
      <p className="mt-0.5 text-xs text-muted">Quem está respondendo (pelo CRM ou, pela assinatura, pelo celular) e quantas conversas esperam cada uma.</p>
      {team.members.length === 0 && <p className="mt-2 text-sm text-muted">Ninguém respondeu nos últimos 7 dias.</p>}
      <div className="mt-2"><TeamRows team={team} now={now} /></div>
    </section>
  );
}

const AVATAR_TONE = ["bg-gold-soft text-gold-ink", "bg-paper-3 text-ink-2", "bg-ok-soft text-ok", "bg-info-soft text-graphite"];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toLocaleUpperCase("pt-BR") || "?";

/**
 * Fila: uma linha só, "Sara está com 4 · Cati com 0" (quantas conversas esperam resposta de cada uma), com mini avatares.
 * Só quem recebe conversa da distribuição; o "sem dono" já está no chip do topo. Nada de reticências: se não couber, a linha quebra.
 * Tocar abre a lista com o estado e a última resposta de cada uma.
 */
export function TeamNowStrip({ team, now }: { team: TeamNow; now: Date }) {
  const people = team.members.filter((m) => m.receives);
  if (!people.length) return null;
  // Primeiro nome ("Ana Souza" → "Ana"): quem tem assinatura já vem curto ("Cati"); assim a linha cabe sem cortar.
  const resumo = people.map((m, i) => `${firstName(m.name) ?? m.name} ${i === 0 ? "está " : ""}com ${m.waiting}`).join(" · ");
  return (
    <details className="text-sm">
      <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-control)] px-2 text-graphite hover:bg-paper-2 lg:min-h-8 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="flex shrink-0">
          {people.slice(0, 4).map((m, i) => (
            <span key={m.id} data-mini-avatar="" className={cn("grid size-6 place-items-center rounded-full text-xs font-semibold ring-2 ring-paper", AVATAR_TONE[i % AVATAR_TONE.length], i > 0 && "-ml-1.5")}>{initials(m.name)}</span>
          ))}
        </span>
        <span className="min-w-0 tabular"><span className="sr-only">Equipe agora: </span>{resumo}</span>
      </summary>
      <p className="text-xs text-muted">O número ao lado de cada nome é quantas conversas esperam resposta dela.</p>
      <TeamRows team={{ ...team, members: people }} now={now} compact />
    </details>
  );
}
