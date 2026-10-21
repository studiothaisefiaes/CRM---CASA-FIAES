"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { AvailabilityDot } from "@/components/shell/availability-menu";
import { AVAILABILITY_LABEL, type Availability } from "@/lib/availability";
import { saveDistributionAction, setPriorityLevelAction } from "@/app/(app)/config/actions";

type Person = { id: string; name: string; availability: string; online: boolean; priorityLevel: number; waiting: number };
const label = (a: string) => AVAILABILITY_LABEL[a as Availability] ?? "Ausente";

/** Configurações › Distribuição: ligar, limite por pessoa e o nível de prioridade de cada uma, com o estado ao vivo. */
export function DistributionEditor({ initial, team, canSystem, canLevels }: { initial: { enabled: boolean; limit: number }; team: Person[]; canSystem: boolean; canLevels: boolean }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [limit, setLimit] = useState(String(initial.limit));
  const [confirmOn, setConfirmOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const save = (on: boolean) => start(async () => {
    const r = await saveDistributionAction({ enabled: on, limit: Number(limit) });
    if (!r.ok) { setErr(r.error); return; }
    setErr(null); setEnabled(on); toast(on ? "Distribuição ligada" : "Distribuição salva", "ok");
  });
  return (
    <div className="grid items-start gap-6 min-[1100px]:grid-cols-2">
      <section aria-labelledby="dist-h" className="rounded-[var(--radius-card)] border border-line bg-paper p-4 lg:p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="dist-h" className="leading-tight text-lg font-semibold">Distribuição automática</h2>
            <p className="text-sm text-graphite mt-1 max-w-[60ch]">Conversas novas caem sozinhas com quem está disponível: primeiro o nível 1, depois quem tem menos conversas esperando. Cliente que volta cai com quem a atendeu, se ela estiver livre. Se a responsável não responder no prazo, a próxima pessoa livre recebe o aviso para assumir.</p>
          </div>
          <Switch checked={enabled} label="Distribuição automática" disabled={pending || !canSystem} onChange={(v) => (v ? setConfirmOn(true) : save(false))} />
        </div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); save(enabled); }}>
          <Field label="Conversas esperando resposta por pessoa (limite)" htmlFor="dist-limit" error={err}>
            <Input id="dist-limit" type="number" inputMode="numeric" min={1} max={20} value={limit} onChange={(e) => setLimit(e.target.value)} className="w-28" disabled={!canSystem} />
          </Field>
          {canSystem && <Button type="submit" variant="secondary" loading={pending}>Salvar limite</Button>}
        </form>
        {!canSystem && <p className="text-sm text-muted">Ligar, desligar e o limite ficam com a gestão (Configurar o sistema).</p>}
      </section>

      <section aria-labelledby="team-h" className="rounded-[var(--radius-card)] border border-line bg-paper">
        <div className="px-4 lg:px-5 pt-4 pb-2">
          <h2 id="team-h" className="text-lg font-semibold">Quem recebe</h2>
          <p className="text-sm text-graphite mt-1">Quem tem “Receber conversas da distribuição” no perfil. O estado muda sozinho: Disponível ao abrir o CRM, Ausente depois de 5 minutos sem o CRM aberto.</p>
        </div>
        {team.length === 0 ? <p className="px-5 py-6 text-sm text-muted">Ninguém recebe conversas ainda. Marque “Receber conversas da distribuição” num perfil em Pessoas › Perfis de acesso.</p> : (
          <ul className="divide-y divide-line/70">
            {team.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 lg:px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.name}</span>
                  <span className="text-sm text-muted inline-flex items-center gap-1.5"><AvailabilityDot state={(p.online ? p.availability : "ausente") as Availability} />{p.online ? label(p.availability) : "Ausente"} · {p.waiting} esperando</span>
                </span>
                <Select aria-label={`Nível de ${p.name}`} className="w-36 h-9" defaultValue={String(p.priorityLevel)} disabled={pending || !canLevels}
                  onChange={(e) => start(async () => { const r = await setPriorityLevelAction(p.id, Number(e.target.value)); toast(r.ok ? "Nível salvo" : r.error, r.ok ? "ok" : "error"); })}>
                  <option value="1">1º nível</option><option value="2">2º nível</option><option value="3">3º nível</option>
                </Select>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={confirmOn} onClose={() => setConfirmOn(false)} title="Ligar a distribuição automática?"
        description="Conversas novas vão cair sozinhas com quem está disponível. Nenhuma mensagem é enviada para clientes: só muda quem é a responsável."
        footer={<><Button variant="secondary" onClick={() => setConfirmOn(false)}>Cancelar</Button><Button loading={pending} onClick={() => { setConfirmOn(false); save(true); }}>Ligar</Button></>} />
    </div>
  );
}
