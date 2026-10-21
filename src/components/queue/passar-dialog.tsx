"use client";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { bulkAssignAction, claimAction, passToTeamAction, transferAction } from "@/app/(app)/funil/actions";
import { addNoteAction } from "@/app/(app)/conversa/actions";
import { AVAILABILITY_LABEL, type Availability } from "@/lib/availability";
import type { TransferPerson } from "@/lib/transfer-options";
import { cn } from "@/lib/cn";

const DOT: Record<string, string> = { disponivel: "bg-ok", pausa: "bg-gold", ausente: "bg-muted" };
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

/**
 * "Passar para…" (nova organização, 16/10): a equipe na ordem da distribuição, com o estado e quantas esperam cada uma
 * ("Tânia · Disponível · 4 esperando") e um campo opcional "o que ela precisa saber" (vira nota com @, e ela é avisada).
 * Uma conversa (`dealId`) ou o lote (`dealIds`). Escolher a si mesma = Assumir.
 */
export function PassarDialog({ open, onClose, dealId, dealIds, people, teams = [], ownerId, viewerId, onDone }: {
  open: boolean; onClose: () => void; dealId?: string; dealIds?: string[]; people: TransferPerson[]; ownerId: string | null; viewerId: string | null;
  /** Setores que a pessoa pode escolher (a tela só passa quando a função Setores está ligada e ela tem a permissão). Só para uma conversa. */
  teams?: { id: string; name: string; livres: number }[];
  onDone: (r: { id: string; name: string; count: number; team?: boolean }) => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const [pickTeam, setPickTeam] = useState<string | null>(null);
  const teamList = dealIds ? [] : teams;
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ORDER: Record<string, number> = { disponivel: 0, pausa: 1, ausente: 2 };
  const list = people.filter((p) => dealIds || p.id !== ownerId)
    .sort((a, b) => (ORDER[a.availability] ?? 3) - (ORDER[b.availability] ?? 3) || a.priorityLevel - b.priorityLevel || a.waiting - b.waiting || a.name.localeCompare(b.name, "pt-BR"));
  const chosen = list.find((p) => p.id === pick) ?? null;

  const chosenTeam = teamList.find((t) => t.id === pickTeam) ?? null;

  const confirm = () => {
    if (!chosen && !chosenTeam) { setError("Escolha quem vai cuidar."); return; }
    if (chosenTeam) {
      start(async () => {
        const r = await passToTeamAction(dealId!, chosenTeam.id);
        if (!r.ok) { setError(r.error); return; }
        onDone({ id: chosenTeam.id, name: chosenTeam.name, count: 1, team: true });
      });
      return;
    }
    if (!chosen) return;
    start(async () => {
      if (dealIds) {
        const r = await bulkAssignAction(dealIds, chosen.id);
        if (!r.ok) { setError(r.error); return; }
        onDone({ id: chosen.id, name: chosen.name, count: r.data!.assigned });
        return;
      }
      const r = chosen.id === viewerId ? await claimAction(dealId!) : await transferAction(dealId!, chosen.id);
      if (!r.ok) { setError(r.error); return; }
      const body = nota.trim();
      if (body) {
        const first = chosen.name.split(/\s+/)[0];
        const text = body.toLowerCase().includes(`@${first.toLowerCase()}`) ? body : `@${first} ${body}`;
        await addNoteAction({ dealId: dealId!, body: text, mentions: [chosen.id] });
      }
      onDone({ id: chosen.id, name: chosen.name, count: 1 });
    });
  };

  return (
    <Dialog open={open} onClose={onClose} width={440} title={dealIds ? `Passar ${dealIds.length} conversas para…` : "Passar para…"}
      description="Quem recebe ganha um aviso com som."
      footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button><Button onClick={confirm} loading={pending}>Passar</Button></>}>
      <div className="flex max-h-[min(60vh,480px)] flex-col gap-4 overflow-y-auto pr-1">
        {teamList.length > 0 && (
          <div role="radiogroup" aria-label="Setores" className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-graphite">Setores</p>
            {teamList.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={pickTeam === t.id} onClick={() => { setPickTeam(t.id); setPick(null); setError(null); }}
                className={cn("flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] border px-3 text-left transition-colors", pickTeam === t.id ? "border-ink bg-paper-2" : "border-line hover:bg-paper-2")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.name}</span>
                  <span className="text-xs text-graphite">{t.livres === 0 ? "Ninguém livre agora" : t.livres === 1 ? "1 pessoa livre" : `${t.livres} pessoas livres`}</span>
                </span>
              </button>
            ))}
            <p className="mt-1 text-xs font-semibold text-graphite">Pessoas</p>
          </div>
        )}
        <div role="radiogroup" aria-label="Pessoas" className="flex flex-col gap-1">
          {list.map((p) => {
            const state = AVAILABILITY_LABEL[p.availability as Availability] ?? "Ausente";
            return (
              <button key={p.id} type="button" role="radio" aria-checked={pick === p.id} onClick={() => { setPick(p.id); setPickTeam(null); setError(null); }}
                className={cn("flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] border px-3 text-left transition-colors", pick === p.id ? "border-ink bg-paper-2" : "border-line hover:bg-paper-2")}>
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-paper-3 text-xs font-bold text-graphite">{initials(p.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}{p.id === viewerId ? " (você)" : ""}</span>
                  <span className="flex items-center gap-1.5 text-xs text-graphite"><span aria-hidden className={cn("size-2 rounded-full", DOT[p.availability] ?? "bg-muted")} />{state} · {p.waiting} esperando</span>
                </span>
              </button>
            );
          })}
        </div>
        {!dealIds && !chosenTeam && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-graphite">O que ela precisa saber (opcional)</span>
            <Input value={nota} maxLength={400} placeholder="Ex.: ela quer sábado de manhã" onChange={(e) => setNota(e.target.value)} className="h-11" />
          </label>
        )}
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}
