import Link from "next/link";
import { todayBahia } from "@/lib/agenda";
import { PACKAGE_TABS, PackagesList, type PackageTab } from "@/components/agenda/packages-list";
import { listClientPackages } from "@/server/queries/avec";
import { listPackageCards } from "@/server/domain/caixa/packages";
import { isUuid } from "@/lib/uuid";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Clientes › Com pacote (era Serviços › Clientes com pacote): situação, busca e, vindo do cartão do pacote, só aquele pacote.
 * Endereço: /contatos?vista=pacote[&situacao=][&q=][&pacote=].
 */
export async function ClientesComPacote({ sp, withValues, now }: { sp: Record<string, string | string[] | undefined>; withValues: boolean; now: Date }) {
  const pacoteParam = typeof sp.pacote === "string" && isUuid(sp.pacote) ? sp.pacote : null;
  const pacote = pacoteParam ? (await listPackageCards(now)).find((p) => p.id === pacoteParam) ?? null : null;
  const situacao: PackageTab = PACKAGE_TABS.some((t) => t.value === sp.situacao) ? (sp.situacao as PackageTab) : "ativos";
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 80);
  const packageDefId = pacote?.id;
  const [items, ativos] = await Promise.all([
    listClientPackages({ situacao, q: q || undefined, withValues, packageDefId }, now),
    situacao === "ativos" && !q ? Promise.resolve(null) : listClientPackages({ situacao: "ativos", packageDefId }, now),
  ]);
  const totalAtivos = (ativos ?? items).length;
  const href = (over: { situacao?: PackageTab; q?: string; pacote?: string | null }) => {
    const s = new URLSearchParams({ vista: "pacote" });
    const st = over.situacao ?? situacao, qq = over.q ?? q, pk = over.pacote === undefined ? pacote?.id : over.pacote;
    if (st !== "ativos") s.set("situacao", st);
    if (qq) s.set("q", qq);
    if (pk) s.set("pacote", pk);
    return `/contatos?${s}`;
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-graphite">
        <span>{totalAtivos ? plural(totalAtivos, "pacote ativo", "pacotes ativos") : "Nenhum pacote ativo"}{pacote && <> do <strong className="font-semibold text-ink">{pacote.name}</strong></>}</span>
        {pacote && <Link href={href({ pacote: null })} className="font-medium text-gold-ink underline underline-offset-4">Ver todos os pacotes</Link>}
      </p>
      <PackagesList items={items} tab={situacao} q={q} today={todayBahia(now)} withValues={withValues} hrefFor={href}
        pacoteHref="/servicos?aba=pacotes" searchAction="/contatos" searchHidden={{ vista: "pacote", ...(pacote ? { pacote: pacote.id } : {}) }} />
    </div>
  );
}
