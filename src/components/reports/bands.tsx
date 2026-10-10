"use client";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";
import { shareText } from "@/lib/report-format";
import type { Bands } from "@/server/reports/queries";

const BANDS: { key: keyof Bands; label: string; swatch: string }[] = [
  { key: "ate2", label: "Até 2 min", swatch: "bg-ok" },
  { key: "de2a10", label: "2 a 10 min", swatch: "bg-gold" },
  { key: "de10a60", label: "10 min a 1 h", swatch: "bg-gold-ink" },
  { key: "mais1h", label: "Mais de 1 h", swatch: "bg-alert" },
];

/** Faixas de primeira resposta em uma barra empilhada horizontal, com rótulo e contagem de cada faixa (a cor nunca é o único sinal). */
export function BandsBar({ bands, n }: { bands: Bands; n: number }) {
  const total = BANDS.reduce((a, b) => a + bands[b.key], 0);
  return (
    <div>
      <motion.div className="flex h-4 gap-[2px] origin-left" style={{ transformOrigin: "left center" }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, ease: EASE }}
        role="img" aria-label={BANDS.map((b) => `${b.label}: ${bands[b.key]}`).join("; ")}>
        {total === 0 ? <div className="flex-1 rounded-full bg-paper-3" /> : BANDS.filter((b) => bands[b.key] > 0).map((b) => (
          <div key={b.key} className={`${b.swatch} first:rounded-l-full last:rounded-r-full`} style={{ flexGrow: bands[b.key], flexBasis: 0, minWidth: 6 }} />
        ))}
      </motion.div>
      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        {BANDS.map((b) => (
          <div key={b.key}>
            <dt className="flex items-center gap-2 text-[13px] text-graphite"><span className={`size-2.5 rounded-sm ${b.swatch}`} aria-hidden />{b.label}</dt>
            <dd className="mt-0.5 tabular"><b className="text-[18px] font-semibold">{bands[b.key]}</b>
              {n > 0 && <span className="text-[13px] text-muted"> · {shareText(bands[b.key], n)}</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
