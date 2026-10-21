"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { IconSearch } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { RetomarDialog } from "./retomar-dialog";
import { cancelScheduledAction, restoreScheduledAction } from "@/app/(app)/atendimento/programadas/actions";
import type { ScheduledList, ScheduledRow } from "@/server/queries/scheduled-list";
import { displayName } from "@/lib/display-name";
import { dueLabel } from "@/lib/next-action";
import { bahiaParts } from "@/lib/schedule";
import { cn } from "@/lib/cn";

type Params = { quem: "minhas" | "todas"; periodo: "hoje" | "7d" | "todas"; q: string };
const TZ = "America/Bahia";
const CHIP = "inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium transition-colors pointer-coarse:min-h-11";
const hm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

const href = (p: Params, over: Partial<Params>) => {
  const n = { ...p, ...over };
  const sp = new URLSearchParams();
  if (n.quem === "minhas") sp.set("quem", "minhas");
  if (n.periodo !== "todas") sp.set("periodo", n.periodo);
  if (n.q.trim()) sp.set("q", n.q.trim());
  return sp.size ? `/atendimento/programadas?${sp}` : "/atendimento/programadas";
};

/** "Hoje · sexta, 16/10", "Amanhã · sábado, 17/10", "quinta, 22/10". */
function dayTitle(key: string, nowMs: number) {
  const today = bahiaParts(nowMs).date, tomorrow = bahiaParts(nowMs + 86_400_000).date;
  const d = new Date(`${key}T12:00:00-03:00`).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit" });
  return key === today ? `Hoje · ${d}` : key === tomorrow ? `Amanhã · ${d}` : d.charAt(0).toUpperCase() + d.slice(1);
}

/**
 * A lista de Mensagens programadas: agrupada por dia, larga no computador (hora | cliente | texto | ações) e uma coluna no celular.
 * Nada aqui envia: Editar troca pela nova (diálogo do Retomar), Cancelar pede confirmação e oferece Desfazer.
 */
export function ProgramadasView({ data, params, onlyOwnScope, nowIso }: { data: ScheduledList; params: Params; onlyOwnScope: boolean; nowIso: string }) {
  const router = useRouter();
  const toast = useToast();
  const nowMs = Date.parse(nowIso);
  const [text, setText] = useState(params.q);
  const [editing, setEditing] = useState<{ row: ScheduledRow; n: number } | null>(null);
  const [cancelling, setCancelling] = useState<ScheduledRow | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (text.trim() === params.q.trim()) return;
    const t = setTimeout(() => router.replace(href(params, { q: text }), { scroll: false }), 250);
    return () => clearTimeout(t);
  }, [text, params, router]);

  const groups = new Map<string, ScheduledRow[]>();
  for (const r of data.pending) {
    const k = bahiaParts(Date.parse(r.sendAt)).date;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const filtered = params.quem === "minhas" || params.periodo !== "todas" || !!params.q.trim();

  const undo = (id: string) => start(async () => {
    const r = await restoreScheduledAction(id);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Mensagem de volta na lista", "ok");
    router.refresh();
  });
  const cancel = (row: ScheduledRow) => start(async () => {
    const r = await cancelScheduledAction(row.id);
    setCancelling(null);
    if (!r.ok) { toast(r.error, "error"); router.refresh(); return; }
    toast(`Mensagem para ${displayName(row.name).split(" ")[0]} cancelada`, "ok", { label: "Desfazer", onClick: () => undo(row.id) });
    router.refresh();
  });

  return (
    <div className="flex-1 px-4 pb-16 pt-5 lg:px-8 lg:pt-7">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Link href="/atendimento" className="-ml-2 inline-flex min-h-11 min-w-11 items-center px-2 text-sm text-graphite hover:text-ink lg:min-h-0">‹ Fila</Link>
          <h2 className="mt-1 font-display text-[28px] lg:text-[34px] leading-none font-light tracking-[-0.01em]">Mensagens programadas</h2>
          <p className="mt-2 text-sm text-graphite">
            {data.total === 0 ? "Nenhuma esperando para sair." : `${data.total} ${data.total === 1 ? "mensagem vai sair sozinha" : "mensagens vão sair sozinhas"} na hora marcada.`}
            {onlyOwnScope ? " Mostra as suas conversas e as sem dona." : ""}
          </p>
        </div>
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Buscar por nome</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar por nome" autoComplete="off" enterKeyHint="search"
            className="h-11 w-full rounded-[var(--radius-control)] border border-control bg-paper pl-10 pr-3 text-[16px] outline-none focus:border-ink sm:h-10 sm:text-sm" />
        </label>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        <nav aria-label="De quem" className="flex gap-1.5">
          {([["todas", "Todas"], ["minhas", "Minhas"]] as const).map(([v, l]) => (
            <Link key={v} href={href(params, { quem: v })} replace scroll={false} aria-current={params.quem === v ? "true" : undefined}
              className={cn(CHIP, params.quem === v ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-2 hover:bg-paper-2")}>{l}</Link>
          ))}
        </nav>
        <span aria-hidden className="hidden h-6 w-px bg-line sm:block" />
        <nav aria-label="Quando" className="flex flex-wrap gap-1.5">
          {([["hoje", "Hoje"], ["7d", "Próximos 7 dias"], ["todas", "Todas as datas"]] as const).map(([v, l]) => (
            <Link key={v} href={href(params, { periodo: v })} replace scroll={false} aria-current={params.periodo === v ? "true" : undefined}
              className={cn(CHIP, params.periodo === v ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-2 hover:bg-paper-2")}>{l}</Link>
          ))}
        </nav>
      </div>

      {groups.size === 0 ? (
        <div className="rounded-[var(--radius-card,16px)] border border-line bg-paper">
          <Empty title={filtered ? "Nada com esse filtro" : "Nenhuma mensagem programada"}>
            {filtered ? "Tire um filtro ou a busca para ver as outras." : "Programe pelo Retomar… da conversa ou pelo relógio do campo de mensagem."}
          </Empty>
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {[...groups.entries()].map(([day, rows]) => (
            <section key={day} aria-label={dayTitle(day, nowMs)}>
              <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-ink">
                {dayTitle(day, nowMs)}<span className="font-normal text-muted tabular">{rows.length}</span>
              </h3>
              <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-paper">
                {rows.map((r) => (
                  <Row key={r.id} row={r} nowMs={nowMs}
                    actions={<>
                      <Link href={`/atendimento?lead=${r.dealId}`} className="inline-flex h-9 items-center rounded-[8px] border border-line-strong px-3 text-sm font-medium text-ink hover:bg-paper-2 pointer-coarse:min-h-11">Abrir conversa</Link>
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ row: r, n: (editing?.n ?? 0) + 1 })}>Editar</Button>
                      <Button size="sm" variant="ghost" className="text-alert" onClick={() => setCancelling(r)}>Cancelar</Button>
                    </>} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {data.recent.length > 0 && (
        <details className="group mt-8">
          <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-graphite hover:text-ink [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
            Não saíram nas últimas 24 h <span className="font-normal text-muted tabular">{data.recent.length}</span>
          </summary>
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-paper">
            {data.recent.map((r) => (
              <Row key={r.id} row={r} nowMs={nowMs} muted
                actions={<Link href={`/atendimento?lead=${r.dealId}`} className="inline-flex h-9 items-center rounded-[8px] border border-line-strong px-3 text-sm font-medium text-ink hover:bg-paper-2 pointer-coarse:min-h-11">Abrir conversa</Link>} />
            ))}
          </ul>
        </details>
      )}

      {editing && (
        <RetomarDialog key={`e${editing.n}`} open onClose={() => setEditing(null)} dealIds={[editing.row.dealId]} name={displayName(editing.row.name)}
          initialText={editing.row.text} initialMotivo={editing.row.motivo ?? ""} initialAt={Date.parse(editing.row.sendAt)} initialCancela={editing.row.cancelIfReply} editOutboxId={editing.row.id}
          onDone={(r) => { setEditing(null); toast(r.texto ? `Mensagem atualizada · ${dueLabel(Date.parse(r.dueAt), Date.now())}` : "Virou lembrete: a mensagem não sai mais", "ok"); router.refresh(); }} />
      )}
      {cancelling && (
        <Dialog open onClose={() => setCancelling(null)} title={`Cancelar a mensagem para ${displayName(cancelling.name).split(" ")[0]}?`}
          description={`Ela ia sair ${dueLabel(Date.parse(cancelling.sendAt), nowMs)}.${cancelling.hasReminder ? " O lembrete da retomada continua." : ""}`}
          footer={<><Button variant="ghost" onClick={() => setCancelling(null)} disabled={pending}>Voltar</Button><Button variant="danger" loading={pending} onClick={() => cancel(cancelling)}>Cancelar mensagem</Button></>}>
          <p className="whitespace-pre-line rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-ink line-clamp-6">{cancelling.text}</p>
        </Dialog>
      )}
    </div>
  );
}

/** "Não saiu: sem conexão", "Cancelada: a cliente escreveu depois…", "Cancelada em Mensagens programadas". */
function whyNot(r: ScheduledRow) {
  const e = r.error?.trim().replace(/\.$/, "") ?? "";
  if (r.status === "failed") return e ? `Não saiu: ${e}` : "Não saiu";
  return /^cancelada/i.test(e) ? e : e ? `Cancelada: ${e}` : "Cancelada";
}

function Row({ row: r, nowMs, actions, muted = false }: { row: ScheduledRow; nowMs: number; actions: React.ReactNode; muted?: boolean }) {
  const name = displayName(r.name);
  const failed = r.status === "failed";
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3.5 lg:grid-cols-[64px_minmax(180px,240px)_minmax(0,1fr)_auto] lg:items-start lg:gap-x-5 lg:px-5">
      <p className="col-start-1 row-start-1 pt-1.5 font-display text-[19px] leading-none tabular text-ink lg:pt-2" title={dueLabel(Date.parse(r.sendAt), nowMs)}>
        {hm(r.sendAt)}
      </p>
      <div className="col-start-2 row-start-1 flex min-w-0 items-center gap-2.5 lg:col-start-2">
        <ContactAvatar contactId={r.contactId} hasAvatar={r.hasAvatar} version={r.avatarV} name={name} size={36} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{name}</p>
          <p className="truncate text-xs text-muted">{r.authorName ? `por ${r.authorName.split(" ")[0]}` : "automática"}</p>
        </div>
      </div>
      <div className="col-span-2 min-w-0 lg:col-span-1 lg:col-start-3 lg:row-start-1">
        <p className={cn("whitespace-pre-line text-sm leading-relaxed line-clamp-4", muted ? "text-graphite" : "text-ink")}>{r.text}</p>
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-graphite">
          {muted && <span className={cn("font-semibold", failed ? "text-alert" : "text-ink-2")}>{whyNot(r)}</span>}
          {!muted && r.cancelIfReply && <span>Cancela se ela responder antes</span>}
          {!muted && r.motivo && <span>Motivo: {r.motivo}</span>}
        </p>
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-1.5 lg:col-span-1 lg:col-start-4 lg:row-start-1 lg:justify-end">{actions}</div>
    </li>
  );
}
