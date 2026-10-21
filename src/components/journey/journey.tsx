import type { Journey as JourneyData } from "@/server/queries/journey";
import { Station } from "./station";

/**
 * As estações da jornada, da primeira mensagem ao fim. Grade em CSS: lado a lado a partir de 1280 px (cada estação com largura proporcional a quantas pessoas
 * tem), empilhadas abaixo disso e no celular, sem rolagem lateral. A linha tracejada liga as estações, na horizontal ou na vertical.
 */
export function Journey({ journey }: { journey: JourneyData }) {
  // Estação cheia ganha mais espaço; a vazia encolhe. O teto evita que uma estação com 80 pessoas engula o resto.
  const cols = journey.stations.map((s) => (s.count === 0 ? "minmax(120px,0.6fr)" : `minmax(120px,${Math.min(4, Math.max(1.2, s.people.length / 2))}fr)`)).join(" ");
  return (
    <section aria-label="Etapas da jornada" className="relative px-5 lg:px-8 pb-10">
      <div aria-hidden className="absolute bottom-16 left-[30px] top-7 border-l-2 border-dashed border-line-strong lg:left-[42px] xl:hidden" />
      <div aria-hidden className="absolute inset-x-12 top-[1.625rem] hidden border-t-2 border-dashed border-line-strong xl:block" />
      <ol className="relative grid grid-cols-1 gap-6 xl:gap-3 xl:[grid-template-columns:var(--cols)]" style={{ "--cols": cols } as React.CSSProperties}>
        {journey.stations.map((s, i) => <Station key={s.key} station={s} index={i} />)}
      </ol>
    </section>
  );
}
