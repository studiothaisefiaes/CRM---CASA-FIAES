"use client";
import { Select } from "@/components/ui/field";

type Assistant = { professionalId: string; name: string; position: 1 | 2 };
type Pro = { id: string; name: string; active: boolean; assistantOf?: string | null };

/**
 * Assistentes de um serviço da comanda aberta (até `max`): cada uma com "Tirar", e "+ Assistente" para pôr mais. As do par da profissional
 * vêm primeiro na lista; a própria profissional do serviço e quem já está nunca aparecem. Só leitura (`disabled`) sem a permissão.
 */
export function AssistantsField({ item, professionals, max, disabled, onChange }: {
  item: { label: string; professionalId: string | null; assistants: Assistant[] }; professionals: Pro[]; max: number; disabled?: boolean;
  onChange: (professionalIds: string[]) => void;
}) {
  const ids = item.assistants.map((a) => a.professionalId);
  const options = professionals
    .filter((p) => p.active && p.id !== item.professionalId && !ids.includes(p.id))
    .sort((a, b) => Number(b.assistantOf === item.professionalId) - Number(a.assistantOf === item.professionalId));
  const canAdd = !disabled && ids.length < max && options.length > 0;
  if (!item.assistants.length && !canAdd) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={`Assistentes de ${item.label}`}>
      {item.assistants.map((a) => (
        <span key={a.professionalId} className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2.5 py-1 text-graphite">
          {a.name}
          {!disabled && (
            <button type="button" aria-label={`Tirar ${a.name}`} className="inline-flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 px-1 text-alert hover:underline"
              onClick={() => onChange(ids.filter((id) => id !== a.professionalId))}>×</button>
          )}
        </span>
      ))}
      {canAdd && (
        <Select aria-label={`+ Assistente em ${item.label}`} value="" className="h-9 w-auto text-sm" onChange={(e) => { if (e.target.value) onChange([...ids, e.target.value]); }}>
          <option value="">+ Assistente</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      )}
    </div>
  );
}
