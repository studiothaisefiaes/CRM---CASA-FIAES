"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRepetirConfigAction } from "@/app/(app)/config/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { REPETIR_MIN_VEZES, REPETIR_PADRAO, REPETIR_TETO, type RepetirConfig } from "@/lib/repetir";

const ok = (v: string, min: number, max: number) => { const n = Number(v); return v.trim() !== "" && Number.isInteger(n) && n >= min && n <= max; };

/**
 * Configurações › Agenda e caixa › Repetir horário: até quantas semanas entre uma vez e outra (padrão 12, de 1 a 52) e até quantas vezes
 * (padrão 26, de 2 a 104). Os limites valem no servidor; os horários já repetidos não mudam.
 */
export function RepetirSettings({ config, repetirOn }: { config: RepetirConfig; repetirOn: boolean }) {
  const [semanas, setSemanas] = useState(String(config.maxSemanas));
  const [vezes, setVezes] = useState(String(config.maxVezes));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const submit = () => {
    if (!ok(semanas, 1, REPETIR_TETO.maxSemanas)) { setError(`Use de 1 a ${REPETIR_TETO.maxSemanas} semanas.`); return; }
    if (!ok(vezes, REPETIR_MIN_VEZES, REPETIR_TETO.maxVezes)) { setError(`Use de ${REPETIR_MIN_VEZES} a ${REPETIR_TETO.maxVezes} vezes.`); return; }
    setError(null);
    start(async () => {
      const r = await saveRepetirConfigAction({ maxSemanas: Number(semanas), maxVezes: Number(vezes) });
      if (!r.ok) { setError(r.error); return; }
      toast("Limites do Repetir salvos"); router.refresh();
    });
  };
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5" aria-labelledby="repetir-titulo">
      <h2 id="repetir-titulo" className="text-lg font-semibold">Repetir horário</h2>
      <p className="mt-1 max-w-[62ch] text-sm text-graphite">Ao marcar, a recepção pode repetir o mesmo horário a cada algumas semanas. Aqui fica o máximo que ela pode escolher. Os horários já repetidos não mudam.</p>
      {!repetirOn && <p role="note" className="mt-3 rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">Essa função está desligada em Configurações › Recursos. Os horários que já se repetem continuam na Agenda.</p>}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Field label="Até quantas semanas entre uma vez e outra" htmlFor="repetir-semanas" hint={`Padrão ${REPETIR_PADRAO.maxSemanas}. De 1 a ${REPETIR_TETO.maxSemanas}.`}>
            <Input id="repetir-semanas" type="number" inputMode="numeric" min={1} max={REPETIR_TETO.maxSemanas} step={1} value={semanas} disabled={!repetirOn || pending}
              onChange={(e) => setSemanas(e.target.value)} />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Até quantas vezes" htmlFor="repetir-vezes" hint={`Padrão ${REPETIR_PADRAO.maxVezes}. De ${REPETIR_MIN_VEZES} a ${REPETIR_TETO.maxVezes}.`}>
            <Input id="repetir-vezes" type="number" inputMode="numeric" min={REPETIR_MIN_VEZES} max={REPETIR_TETO.maxVezes} step={1} value={vezes} disabled={!repetirOn || pending}
              onChange={(e) => setVezes(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </Field>
        </div>
        <Button loading={pending} disabled={!repetirOn} onClick={submit}>Salvar</Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-alert">{error}</p>}
    </section>
  );
}
