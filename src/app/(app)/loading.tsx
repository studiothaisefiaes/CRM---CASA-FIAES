/** Trocar de tela (28/10, Cati: "demora pra sair de uma aba pra outra"): o menu já responde ao clique enquanto a tela nova chega. */
export default function Loading() {
  const bar = "rounded-[var(--radius-card)] bg-paper-2 motion-safe:animate-pulse";
  return (
    <main className="flex flex-col gap-4 p-4 lg:p-6" aria-busy="true">
      <p role="status" className="flex items-center gap-2 text-sm text-muted">
        <span aria-hidden className="size-1.5 rounded-full bg-gold-ink motion-safe:animate-pulse" />Carregando…
      </p>
      <div className={`h-9 w-1/3 ${bar}`} />
      <div className={`h-24 ${bar}`} />
      <div className={`h-24 ${bar}`} />
      <div className={`h-24 ${bar}`} />
    </main>
  );
}
