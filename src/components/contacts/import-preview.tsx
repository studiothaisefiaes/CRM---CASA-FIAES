import type { ImportPreview } from "@/server/domain/import";
import { formatPhoneClient } from "@/lib/phone-client";

/** Prévia da importação: o que entra, o que repete e o que será ignorado. Nada é gravado até confirmar. */
export function ImportPreviewView({ preview }: { preview: ImportPreview }) {
  const novos = Math.max(0, preview.rows - (preview.existing ?? 0));
  return (
    <div data-testid="import-previa" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat n={novos} label="novos" tone="bg-ok-soft text-ok" />
        <Stat n={preview.existing ?? 0} label="já existem" tone="bg-paper-2 text-graphite" />
        <Stat n={preview.duplicates} label="repetidos no arquivo" tone="bg-gold-soft text-gold-ink" testid="previa-duplicados" />
        <Stat n={preview.invalid.length} label="telefone inválido" tone="bg-alert-soft text-alert" testid="previa-invalidos" />
      </div>
      {preview.invalid.length > 0 && (
        <p className="text-sm text-graphite">Registros ignorados: {preview.invalid.slice(0, 12).map((i) => `linha ${i.line} (${i.value || "vazio"})`).join(", ")}{preview.invalid.length > 12 ? "…" : ""}</p>
      )}
      {preview.sample.length > 0 && (
        <ul className="text-sm text-ink-2 divide-y divide-line rounded-[var(--radius-control)] border border-line">
          {preview.sample.map((s) => <li key={s.phone} className="flex justify-between gap-3 px-3 py-1.5"><span className="truncate">{s.name ?? "Sem nome"}</span><span className="text-graphite">{formatPhoneClient(s.phone)}</span></li>)}
        </ul>
      )}
      <p className="text-xs text-muted">Nada foi gravado ainda. Confira e confirme a importação.</p>
    </div>
  );
}
function Stat({ n, label, tone, testid }: { n: number; label: string; tone: string; testid?: string }) {
  return <div className={`rounded-[var(--radius-control)] p-3 ${tone}`}><p data-testid={testid} className="font-serif text-[28px] leading-none">{n}</p><p className="mt-1 text-xs">{label}</p></div>;
}
