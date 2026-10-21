"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveTeamAction } from "@/app/(app)/config/equipe/setores/actions";

type Team = { id: string; name: string; active: boolean; members: { id: string; name: string }[] };
type Person = { id: string; name: string };

/**
 * Configurações › Pessoas › Setores: Recepção, Método Fiaes® e Serviços gerais (e os que a Casa criar). Cada setor tem as suas pessoas;
 * "Passar para…" entrega a conversa a quem do setor está Disponível. Nada aqui manda mensagem para a cliente.
 */
export function TeamsEditor({ teams, people, canManage }: { teams: Team[]; people: Person[]; canManage: boolean }) {
  return (
    <section aria-labelledby="setores-titulo" className="flex flex-col gap-4">
      <div>
        <h2 id="setores-titulo" className="text-lg font-semibold">Quem faz parte de cada setor?</h2>
        <p className="mt-1 max-w-[70ch] text-sm text-graphite">Ao passar uma conversa para um setor, ela vai para quem do setor está Disponível e tem menos conversas esperando. Se ninguém estiver livre, a gestão é avisada.</p>
      </div>
      <ul className="flex flex-col gap-3">
        {teams.map((t) => <li key={t.id}><TeamCard team={t} people={people} canManage={canManage} /></li>)}
      </ul>
      {canManage && <NewTeam people={people} />}
    </section>
  );
}

function Members({ people, value, onChange, disabled, label }: { people: Person[]; value: string[]; onChange: (v: string[]) => void; disabled: boolean; label: string }) {
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5" disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      {people.map((p) => (
        <label key={p.id} className="inline-flex min-h-8 items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />
          {p.name}
        </label>
      ))}
    </fieldset>
  );
}

function TeamCard({ team, people, canManage }: { team: Team; people: Person[]; canManage: boolean }) {
  const [name, setName] = useState(team.name);
  const [active, setActive] = useState(team.active);
  const [ids, setIds] = useState(team.members.map((m) => m.id));
  const [pending, start] = useTransition(); const toast = useToast();
  const save = (next: { active?: boolean } = {}) => start(async () => {
    const r = await saveTeamAction({ id: team.id, name, active: next.active ?? active, memberIds: ids });
    if (r.ok) toast("Setor salvo"); else toast(r.error, "error");
  });
  return (
    <div className={`flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper p-4 ${active ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={`Nome do setor ${team.name}`} maxLength={60} disabled={!canManage} className="h-9 max-w-[18rem] flex-1" />
        <Switch checked={active} disabled={!canManage || pending} label={active ? `Desativar ${team.name}` : `Ativar ${team.name}`} onChange={(v) => { setActive(v); save({ active: v }); }} />
      </div>
      <Members people={people} value={ids} onChange={setIds} disabled={!canManage} label={`Pessoas do setor ${team.name}`} />
      {canManage && <div><Button size="sm" onClick={() => save()} loading={pending}>Salvar {team.name}</Button></div>}
    </div>
  );
}

function NewTeam({ people }: { people: Person[] }) {
  const [name, setName] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [pending, start] = useTransition(); const toast = useToast();
  return (
    <form className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper-2/60 p-4"
      onSubmit={(e) => { e.preventDefault(); start(async () => {
        const r = await saveTeamAction({ name, memberIds: ids });
        if (r.ok) { setName(""); setIds([]); toast("Setor criado"); } else toast(r.error, "error");
      }); }}>
      <p className="text-base font-medium">Novo setor</p>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Maquiagem" aria-label="Nome do novo setor" maxLength={60} />
      <Members people={people} value={ids} onChange={setIds} disabled={false} label="Pessoas do novo setor" />
      <div><Button type="submit" loading={pending} disabled={!name.trim()}>Criar setor</Button></div>
    </form>
  );
}
