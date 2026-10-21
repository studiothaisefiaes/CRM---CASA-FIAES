"use client";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { salonQuery } from "@/lib/salon-period";
import { cn } from "@/lib/cn";
import type { OcupacaoMedida, OcupacaoView } from "@/server/reports/ocupacao";
import { DataList, type Col } from "./data-list";
import { Heatmap } from "./heatmap";
import { Muted, Section } from "./section";

const hours = (min: number) => (min / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Salão › Ocupação: "Quando a Casa enche e quem está livre?" Filtros, mapa de calor e ocupação de cada profissional. */
export function OcupacaoTab({ d }: { d: OcupacaoView }) {
  const router = useRouter();
  const go = (o: { prof?: string | null; medida?: OcupacaoMedida }) => {
    const q = new URLSearchParams(salonQuery(d.range, "salao", "ocupacao"));
    const prof = o.prof === undefined ? d.professionalId : o.prof, medida = o.medida ?? d.medida;
    if (prof) q.set("prof", prof);
    if (medida === "valor") q.set("medida", "valor");
    router.replace(`/relatorios?${q}`, { scroll: false });
  };
  type R = OcupacaoView["professionals"][number];
  const cols: Col<R>[] = [
    { key: "n", label: "Profissional", render: (p) => p.name },
    { key: "d", label: "Disponível (h)", align: "right", render: (p) => hours(p.availableMin) },
    { key: "a", label: "Agendado (h)", align: "right", render: (p) => hours(p.bookedMin) },
    { key: "o", label: "Ocupação", align: "right", render: (p) => (p.pct == null ? <span className="text-muted">—</span> : `${p.pct}%`) },
    { key: "y", label: "Dias", align: "right", render: (p) => p.days },
  ];
  const valor = d.medida === "valor";
  const chip = (on: boolean) => cn("min-h-11 lg:min-h-8 rounded-full border px-3 text-sm font-medium transition-colors", on ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2");
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-graphite">Profissional
            <select value={d.professionalId ?? ""} onChange={(e) => go({ prof: e.target.value || null })}
              className="h-11 lg:h-9 rounded-[var(--radius-control)] border border-control bg-paper px-3 text-md lg:text-sm">
              <option value="">Todas</option>
              {d.professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {d.money && (
            <div className="flex gap-1.5" role="group" aria-label="O que o mapa mostra">
              <button type="button" aria-pressed={!valor} onClick={() => go({ medida: "horarios" })} className={chip(!valor)}>Horários</button>
              <button type="button" aria-pressed={valor} onClick={() => go({ medida: "valor" })} className={chip(valor)}>Valor</button>
            </div>
          )}
        </div>
      </div>
      <Section id="salao-ocupacao" title="Quando a Casa enche e quem está livre?" legend="salaoOcupacao"
        lead="Disponível = horário de trabalho dela (ou o da Casa) menos bloqueios e folgas.">
        <Heatmap grid={d.grid} unit={{ one: "horário", many: "horários" }} format={valor ? money : undefined}
          caption={valor ? "Valor dos horários marcados por dia da semana e hora de início (em reais)" : "Horários marcados por dia da semana e hora de início"}
          ariaLabel={`Mapa de calor de ${valor ? "valor" : "horários"} marcados por dia da semana e hora (role para o lado)`} />
        <h3 className="mt-8 mb-2 text-base font-semibold">Ocupação por profissional</h3>
        {d.professionals.length === 0 ? <Muted>Nenhuma profissional ativa.</Muted> : <DataList rows={d.professionals} cols={cols} rowKey={(p) => p.id} caption="Ocupação por profissional" />}
      </Section>
    </div>
  );
}
