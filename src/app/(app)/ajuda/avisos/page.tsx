import { requirePerm } from "@/server/auth/session";
import { helpCatalog } from "@/lib/alert-copy";

export const metadata = { title: "O que cada aviso quer dizer" };

/**
 * Para treinar a equipe: cada seção, chip, cor e alerta, com a mesma frase da tela (gerada de `alert-copy`, nunca escrita à parte).
 * No celular a barra do topo é fixa (h-14): as âncoras param 80 px abaixo do topo para o título não ficar atrás dela.
 * No computador (≥1100 px) os assuntos ficam numa coluna fixa à esquerda e os avisos de cada assunto em duas colunas.
 */
export default async function AvisosPage() {
  await requirePerm("atendimento.ver");
  const groups = helpCatalog();
  return (
    <main className="mx-auto w-full max-w-[1480px] px-5 lg:px-8 pt-6 lg:pt-9 pb-12">
      <h1 className="font-display text-2xl lg:text-2xl leading-tight font-normal">O que cada aviso quer dizer</h1>
      <p className="mt-2 text-graphite max-w-[60ch]">Cada aviso diz o que aconteceu, de quem é e o que fazer. As frases aqui são as mesmas que aparecem na Fila, na conversa, no sino e no Hoje.</p>
      <div className="min-[1100px]:mt-2 min-[1100px]:grid min-[1100px]:grid-cols-[220px_minmax(0,1fr)] min-[1100px]:items-start min-[1100px]:gap-10">
      <nav aria-label="Assuntos" className="mt-5 flex flex-wrap gap-2 min-[1100px]:sticky min-[1100px]:top-6 min-[1100px]:mt-8 min-[1100px]:flex-col min-[1100px]:flex-nowrap min-[1100px]:gap-1">
        {groups.map((g) => <a key={g.id} href={`#${g.id}`} className="inline-flex min-h-11 lg:min-h-9 items-center rounded-full border border-line-strong px-3 text-sm hover:bg-paper-2 min-[1100px]:rounded-[var(--radius-control)] min-[1100px]:border-transparent">{g.title}</a>)}
      </nav>
      <div className="min-w-0">
      {groups.map((g) => (
        <section key={g.id} id={g.id} aria-labelledby={`h-${g.id}`} className="mt-8 scroll-mt-20 lg:scroll-mt-6">
          <h2 id={`h-${g.id}`} className="text-lg font-semibold">{g.title}</h2>
          <dl className="mt-3 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line/70 min-[1100px]:grid-cols-2">
            {g.entries.map((e) => (
              <div key={e.id} id={e.id} className="scroll-mt-20 lg:scroll-mt-6 bg-paper px-4 py-3 min-[1100px]:last:odd:col-span-2">
                <dt className="font-semibold text-ink">{e.title}</dt>
                <dd className="mt-0.5 text-sm text-graphite">
                  {e.text}
                  {e.example && <span className="mt-1 block text-ink-2">Exemplo: “{e.example}”</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      </div>
      </div>
    </main>
  );
}
