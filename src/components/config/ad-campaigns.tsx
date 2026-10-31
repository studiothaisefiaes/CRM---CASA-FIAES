"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { nameAdCampaignAction, setAdCampaignArchivedAction } from "@/app/(app)/config/actions";

/** Um anúncio visto nas conversas (datas em ISO: vêm do servidor). Ver server/domain/ad-origin.ts. */
export type AdRow = {
  adId: string; name: string | null; label: string; sourceApp: string | null; postUrl: string | null; title: string | null; body: string | null;
  firstSeenAt: string; lastSeenAt: string; archived: boolean; conversas: number;
  /** "Campanha › Conjunto" no Meta (só com a API de Marketing ligada). */
  meta?: string | null;
};

const APP: Record<string, string> = { instagram: "Instagram", facebook: "Facebook" };
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });

/**
 * Configurações › Origens › Anúncios (26/10): os anúncios do Meta que trouxeram conversas aparecem sozinhos (o WhatsApp manda o anúncio na
 * mensagem). A gestão dá o nome da campanha (vale para as conversas antigas também; anúncios com o mesmo nome somam no relatório) e arquiva os
 * que acabaram. Sem miniatura: a imagem do Meta é de outro site (a página não carrega imagem de fora) e o endereço expira em poucos dias.
 */
export function AdCampaigns({ rows }: { rows: AdRow[] }) {
  const active = rows.filter((r) => !r.archived), archived = rows.filter((r) => r.archived);
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[70ch] text-sm text-graphite">
        Quando uma cliente chega clicando num anúncio do Instagram ou do Facebook, o anúncio aparece aqui sozinho. Dê o nome da campanha (ex.: Método Fiaes® outubro):
        a origem das conversas desse anúncio passa a ser esse nome, inclusive das antigas. Anúncios com o mesmo nome somam como uma campanha no relatório de Origem.
      </p>
      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-paper">
          <Empty title="Nenhum anúncio ainda">Quando uma cliente escrever clicando num anúncio, ele aparece aqui com o texto e o link do post.</Empty>
        </div>
      ) : (
        <ul className="grid gap-3">{active.map((r) => <li key={r.adId}><AdCard r={r} /></li>)}</ul>
      )}
      {archived.length > 0 && (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-graphite hover:text-ink [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>Arquivados ({archived.length})
          </summary>
          <ul className="mt-2 grid gap-3">{archived.map((r) => <li key={r.adId}><AdCard r={r} /></li>)}</ul>
        </details>
      )}
    </div>
  );
}

function AdCard({ r }: { r: AdRow }) {
  const [name, setName] = useState(r.name ?? "");
  const [pending, start] = useTransition(); const toast = useToast();
  const save = () => {
    if (name.trim() === (r.name ?? "")) return;
    start(async () => {
      const res = await nameAdCampaignAction(r.adId, name);
      if (res.ok) toast(name.trim() ? "Nome da campanha salvo" : "Nome tirado"); else { toast(res.error, "error"); setName(r.name ?? ""); }
    });
  };
  const archive = () => start(async () => {
    const res = await setAdCampaignArchivedAction(r.adId, !r.archived);
    if (!res.ok) toast(res.error, "error");
  });
  const titleId = `anuncio-${r.adId}`;
  return (
    <article aria-labelledby={titleId} className={`flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper p-4 ${r.archived ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-base font-medium">{r.label}</h3>
          {r.name && r.body && <p className="mt-1 line-clamp-2 text-sm text-graphite">“{r.body}”</p>}
          {r.meta && <p className="mt-1 text-sm text-graphite">No Meta: {r.meta}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite">
            <Badge tone="gold">{APP[r.sourceApp ?? ""] ?? "Anúncio"}</Badge>
            <span className="tabular">{r.conversas} {r.conversas === 1 ? "conversa" : "conversas"}</span>
            <span aria-hidden className="text-muted">·</span>
            <span className="tabular">Primeira vez {day(r.firstSeenAt)} · última {day(r.lastSeenAt)}</span>
            {r.postUrl && <><span aria-hidden className="text-muted">·</span>
              <a href={r.postUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-gold-ink underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">Ver post</a></>}
          </div>
        </div>
        <Button variant="ghost" size="sm" disabled={pending} onClick={archive}>{r.archived ? "Desarquivar" : "Arquivar"}</Button>
      </div>
      <label className="flex max-w-md flex-col gap-1.5">
        <span className="text-sm font-medium text-graphite">Nome da campanha</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          placeholder={r.meta?.split(" › ")[0] ?? "Ex.: Método Fiaes® outubro"} maxLength={80} disabled={pending} />
      </label>
    </article>
  );
}
