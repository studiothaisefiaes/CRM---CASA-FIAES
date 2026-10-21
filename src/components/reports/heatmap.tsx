import { insufficientText } from "@/lib/report-format";

const DAYS = [{ i: 1, short: "Seg", long: "segunda" }, { i: 2, short: "Ter", long: "terça" }, { i: 3, short: "Qua", long: "quarta" }, { i: 4, short: "Qui", long: "quinta" },
  { i: 5, short: "Sex", long: "sexta" }, { i: 6, short: "Sáb", long: "sábado" }, { i: 0, short: "Dom", long: "domingo" }];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Mapa de calor 7 x 24 em um tom só (dourado da marca): quanto mais mensagens, mais cheio. O número está escrito em cada célula (tinta sobre
 * o dourado, 5,8:1 no mais escuro). A rolagem lateral existe só dentro do bloco, com a coluna dos dias fixa; a página nunca rola de lado.
 */
export function Heatmap({ grid, unit = { one: "mensagem", many: "mensagens" }, caption = "Mensagens recebidas por dia da semana e hora do dia", ariaLabel = "Mapa de calor de mensagens por dia da semana e hora (role para o lado)", format }: {
  grid: number[][];
  /** Como se chama o que é contado (padrão: mensagem/mensagens). */ unit?: { one: string; many: string };
  caption?: string; ariaLabel?: string;
  /** Escreve um valor que não é contagem (ex.: dinheiro em centavos); a célula mostra o valor inteiro em reais, a dica e o resumo, o formato completo. */
  format?: (n: number) => string;
}) {
  const total = grid.flat().reduce((a, b) => a + b, 0);
  if (total === 0) return <p className="text-sm text-muted py-4">{insufficientText(0)}</p>;
  const max = Math.max(...grid.flat());
  let peak = { d: 0, h: 0, n: -1 };
  grid.forEach((row, d) => row.forEach((n, h) => { if (n > peak.n) peak = { d, h, n }; }));
  const text = (n: number) => (format ? format(n) : `${n} ${n === 1 ? unit.one : unit.many}`);
  const peakDay = DAYS.find((d) => d.i === peak.d)!.long;
  return (
    <div>
      <p className="text-sm text-graphite mb-3">Mais movimento: <b className="text-ink">{peakDay}, {peak.h}h</b> ({text(peak.n)}). Total de <span className="tabular">{format ? format(total) : total}</span> no período.</p>
      <div className="max-w-full overflow-x-auto rounded-[var(--radius-control)] border border-line scroll-thin" role="region" aria-label={ariaLabel} tabIndex={0}>
        <table className="w-full min-w-[820px] border-separate border-spacing-0 text-xs tabular">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-paper w-12 min-w-12 border-b border-line" aria-label="Dia da semana" />
              {HOURS.map((h) => <th key={h} scope="col" className="min-w-8 h-8 px-0 font-medium text-muted border-b border-line">{h}h</th>)}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((d) => (
              <tr key={d.i}>
                <th scope="row" className="sticky left-0 z-10 bg-paper w-12 min-w-12 px-2 text-left font-medium text-graphite border-r border-line">{d.short}</th>
                {HOURS.map((h) => {
                  const n = grid[d.i][h];
                  const level = n === 0 ? 0 : Math.max(14, Math.round((n / max) * 100));
                  return (
                    <td key={h} title={`${d.long[0].toUpperCase()}${d.long.slice(1)}, ${h}h: ${text(n)}`}
                      className={`h-9 min-w-8 text-center ${n === 0 ? "text-muted/60" : "text-ink font-medium"}`}
                      style={{ background: n === 0 ? "var(--color-paper)" : `color-mix(in srgb, var(--color-gold) ${level}%, var(--color-paper))`, boxShadow: "inset 0 0 0 1px var(--color-paper)" }}>
                      {n === 0 ? "·" : format ? Math.round(n / 100) : n}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
