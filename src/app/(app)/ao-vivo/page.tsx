import { requirePerm } from "@/server/auth/session";
import { CashClosedNotice } from "@/components/caixa/cash-closed-notice";
import { can } from "@/lib/permissions";
import { env } from "@/server/env";
import { getCaixaMode } from "@/server/domain/caixa/mode";
import { getLiveBoardData } from "@/server/queries/ao-vivo";
import { buildComandaCatalog } from "@/server/queries/comanda-catalog";
import { LiveRefresh } from "@/components/shell/live";
import { ComandaProvider } from "@/components/caixa/comanda-provider";
import { SectionTabs } from "@/components/shell/section-tabs";
import { hojeTabs } from "@/lib/section-tabs";
import { HojeTopo, dataPorExtenso } from "@/components/today/hoje-topo";
import { LiveBoard } from "@/components/ao-vivo/live-board";

export const metadata = { title: "Ao vivo" };

/** Só para conferir a tela em outra hora (prints, e2e): `?agora=2026-10-17T10:20-03:00`, e só com as ferramentas de desenvolvimento ligadas. */
function pageNow(agora: unknown): { now: Date; frozen: boolean } {
  if (!env().DEV_TOOLS || typeof agora !== "string") return { now: new Date(), frozen: false };
  const t = Date.parse(agora);
  return Number.isNaN(t) ? { now: new Date(), frozen: false } : { now: new Date(t), frozen: true };
}

/**
 * Hoje › Ao vivo (spec 17/10; aba de Hoje, a rota /ao-vivo continua): o monitor da recepção. Atualiza sozinha: horários e comandas pelo tempo real (`agenda`, `caixa`) e, a cada
 * minuto, pelo que a importação do Avec mudou. Com o caixa no CRM e "Operar o caixa", a visita aberta mostra a comanda.
 */
export default async function AoVivoPage({ searchParams }: PageProps<"/ao-vivo">) {
  const user = await requirePerm("atendimento.ver");
  const { now, frozen } = pageNow((await searchParams).agora);
  const [data, caixaMode] = await Promise.all([getLiveBoardData(now), getCaixaMode()]);
  const caixaOn = caixaMode === "crm";
  const board = <LiveBoard data={data} nowMs={now.getTime()} frozen={frozen} caixaOn={caixaOn} />;
  let body = board;
  if (caixaOn && can(user.perms, "caixa.operar")) {
    const catalog = await buildComandaCatalog(user);
    body = <ComandaProvider catalog={catalog}>{board}</ComandaProvider>;
  }
  return (
    <main className="mx-auto w-full max-w-[1920px]">
      {/* Mesmo topo e mesma largura do Resumo e da Recepção: a barra de abas fica no mesmo lugar. */}
      <div className="mx-auto w-full max-w-[1480px] px-5 pt-6 lg:px-8 lg:pt-9">
        <CashClosedNotice user={user} className="mb-5" />
        <HojeTopo name={user.name} now={now}><span className="inline-block first-letter:uppercase">{dataPorExtenso(now)}.</span> O monitor da recepção, atualiza sozinho.</HojeTopo>
        <SectionTabs label="Hoje" tabs={hojeTabs(user.perms)} current="ao-vivo" className="mt-5" />
      </div>
      <LiveRefresh scopes={["agenda", "caixa"]} pollMs={60_000} />
      {body}
    </main>
  );
}
