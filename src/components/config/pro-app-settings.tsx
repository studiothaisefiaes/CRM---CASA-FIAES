"use client";
import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveProAppSettingsAction } from "@/app/(app)/config/profissionais/acesso-actions";
import type { ProAppSettings } from "@/server/domain/pro/settings";

/** Uma linha da configuração: o texto e a chave. */
function SettingRow({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div><p className="text-sm font-medium">{label}</p><p className="text-sm text-graphite">{hint}</p></div>
      <Switch checked={checked} disabled={disabled} label={label} onChange={onChange} />
    </div>
  );
}

/** App da profissional: o que ela vê na comissão e o aviso quando a cliente confirma. Os dois começam desligados (seção 8.8). */
export function ProAppSettingsCard({ value }: { value: ProAppSettings }) {
  const [v, setV] = useState(value);
  const [pending, start] = useTransition();
  const toast = useToast();
  const save = (next: ProAppSettings) => start(async () => {
    const r = await saveProAppSettingsAction(next);
    if (r.ok) { setV(next); toast("Salvo"); } else toast(r.error, "error");
  });
  return (
    <section className="mb-5 rounded-[var(--radius-card)] border border-line bg-paper p-4">
      <h2 className="font-display text-lg">App da profissional</h2>
      <SettingRow label="Mostrar o valor do serviço nos ganhos" hint="Desligado, ela vê só a comissão (como no Avec da Casa)." checked={v.mostraValorServico} disabled={pending}
        onChange={(on) => save({ ...v, mostraValorServico: on })} />
      <SettingRow label="Avisar quando a cliente confirmar" hint="Manda um aviso no celular dela a cada confirmação." checked={v.avisaConfirmacao} disabled={pending}
        onChange={(on) => save({ ...v, avisaConfirmacao: on })} />
    </section>
  );
}
