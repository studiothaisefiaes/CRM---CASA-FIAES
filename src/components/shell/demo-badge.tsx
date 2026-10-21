/** Etiqueta discreta do ambiente de demonstração (DEMO=true): menu lateral e cabeçalho do celular. */
export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span title="Ambiente de demonstração: todos os dados são fictícios e nada é enviado pelo WhatsApp."
      className={`inline-flex items-center h-5 px-2 rounded-full border border-gold/50 bg-gold/10 text-xs font-semibold uppercase tracking-[0.06em] text-gold-ink ${className}`}>Demonstração</span>
  );
}
