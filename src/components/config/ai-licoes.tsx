"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { decideLicaoAction } from "@/app/(app)/config/ia/actions";
import type { LicaoView } from "@/server/ai/licoes";

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Lições do Rebater (29/10): quando a atendente rebate uma sugestão, a IA refaz e diz o que errou. Aqui a gestão decide: "Usar sempre"
 * (entra em toda sugestão, na seção "Lições aprendidas") ou "Descartar". Só as aprovadas mudam a IA; dá para ajustar o texto antes.
 */
export function AiLicoes({ initial }: { initial: LicaoView[] }) {
  const [items, setItems] = useState(initial);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useToast();
  const decide = (l: LicaoView, status: "aprovada" | "descartada") => start(async () => {
    const texto = texts[l.id]?.trim() || null;
    const r = await decideLicaoAction({ id: l.id, status, texto });
    if (!r.ok) { toast(r.error, "error"); return; }
    setItems((xs) => status === "descartada" ? xs.filter((x) => x.id !== l.id) : xs.map((x) => x.id === l.id ? { ...x, status, licao: texto ?? x.licao } : x));
    toast(status === "aprovada" ? "Lição em uso: a próxima sugestão já segue." : l.status === "aprovada" ? "Lição tirada." : "Lição descartada.", "ok");
  });
  const pendentes = items.filter((l) => l.status === "pendente"), aprovadas = items.filter((l) => l.status === "aprovada");
  return (
    <section aria-labelledby="ia-licoes" className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <div className="flex flex-col gap-1">
        <h2 id="ia-licoes" className="text-lg font-semibold">O que a IA aprendeu com o Rebater</h2>
        <p className="text-sm text-graphite">Quando alguém rebate uma sugestão, a IA refaz e escreve o que errou. Só vale para todas as conversas depois de “Usar sempre”.</p>
      </div>
      {!items.length && <p className="text-sm text-muted">Nada por enquanto. Use “Rebater” numa sugestão da conversa.</p>}
      {pendentes.length > 0 && <h3 className="text-sm font-semibold text-ink">Para aprovar ({pendentes.length})</h3>}
      {pendentes.map((l) => (
        <article key={l.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line bg-paper-2/60 p-3">
          <p className="text-xs text-muted">{l.quem ? `${l.quem.split(/\s+/)[0]} rebateu` : "Rebatida"} em {when(l.createdAt)}: “{l.critica}”</p>
          <textarea aria-label="Lição (pode ajustar antes de aprovar)" rows={2} maxLength={300} value={texts[l.id] ?? l.licao} onChange={(e) => setTexts((t) => ({ ...t, [l.id]: e.target.value }))}
            className="w-full resize-y rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 py-2 text-sm text-ink" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decide(l, "aprovada")} disabled={pending}>Usar sempre</Button>
            <Button size="sm" variant="ghost" onClick={() => decide(l, "descartada")} disabled={pending}>Descartar</Button>
          </div>
        </article>
      ))}
      {aprovadas.length > 0 && <h3 className="text-sm font-semibold text-ink">Em uso ({aprovadas.length})</h3>}
      {aprovadas.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {aprovadas.map((l) => (
            <li key={l.id} className="flex items-start gap-2 text-sm text-ink">
              <span className="min-w-0 flex-1">{l.licao}</span>
              <Button size="sm" variant="ghost" onClick={() => decide(l, "descartada")} disabled={pending}>Tirar</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
