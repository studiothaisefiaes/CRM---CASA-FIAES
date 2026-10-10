import { splitHighlight } from "@/lib/highlight";

/** Texto com o termo da busca destacado. Sempre texto puro (nós de texto do React): o conteúdo de uma mensagem nunca vira HTML. */
export function Highlight({ text, term }: { text: string; term?: string | null }) {
  return (
    <>
      {splitHighlight(text, term).map((p, i) =>
        p.hit ? <mark key={i} className="rounded-[3px] bg-gold-soft px-0.5 font-medium text-ink [box-decoration-break:clone]">{p.text}</mark> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}
