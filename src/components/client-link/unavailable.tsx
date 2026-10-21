import { LinkShell } from "./link-page";

/**
 * Página pública de "não dá agora" (r66 #8): em português, com a marca da Casa e a saída pelo WhatsApp. Serve ao agendamento online
 * desligado (/agendar) e ao link da cliente vencido ou inválido (/c/...). Sem WhatsApp cadastrado, só o texto.
 */
export function LinkUnavailable({ title, text, waHref }: { title: string; text: string; waHref: string | null }) {
  return (
    <LinkShell>
      <section className="mt-6 flex flex-col gap-4 rounded-[var(--radius-panel)] border border-line bg-white p-6 shadow-[var(--shadow-card)]">
        <h1 className="font-display text-2xl font-semibold leading-tight">{title}</h1>
        <p role="status" className="text-md text-graphite">{text}</p>
        {waHref && <a href={waHref} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-14 items-center justify-center rounded-[var(--radius-control)] bg-ink px-5 text-md font-medium text-paper">Falar com a Casa pelo WhatsApp</a>}
      </section>
    </LinkShell>
  );
}
