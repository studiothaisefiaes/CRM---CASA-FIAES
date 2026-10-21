import type { ReactNode } from "react";
import { requireAnyPerm } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { todayBahia } from "@/lib/agenda";
import { commissionReport, listCommissionRules } from "@/server/domain/caixa/commission";
import { getCommissionRules } from "@/server/domain/caixa/commission-rules";
import { listAdjustmentRules, listAdjustments, materializeRules } from "@/server/domain/caixa/adjustments";
import { listProfessionals } from "@/server/domain/professionals";
import { AdjustmentsPanel } from "@/components/caixa/adjustments-panel";
import { getCaixaRecursos } from "@/server/domain/caixa/recursos";
import { PageBack, PageHeader } from "@/components/page-header";
import { CommissionTable } from "@/components/caixa/commission-table";
import { CommissionHow } from "@/components/caixa/commission-how";
import { CommissionRules } from "@/components/caixa/commission-rules";
import { SectionTabs } from "@/components/shell/section-tabs";
import { comissaoTabs, pickAba } from "@/lib/comissao-tabs";
import { lastClosedPeriodEnd } from "@/lib/payout-period";
import { listPayouts, payableFor } from "@/server/domain/caixa/payouts";
import { PayablesPanel } from "@/components/caixa/payout-sheet";
import { PayoutsList } from "@/components/caixa/payouts-list";
import { recursoOffMessage } from "@/lib/caixa-recursos";
import { shiftDay } from "@/lib/agenda";
import { missingRules } from "@/server/domain/caixa/commission-reapply";
import { ApplyClosed, MissingRules } from "@/components/comissao/missing-rules";

export const metadata = { title: "Comissão" };
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const SUBTITLE = {
  regras: "Como calcular, % por profissional e serviço, % da assistente",
  apagar: "O que falta pagar a cada profissional, até o fim do último período dela, e os recibos já pagos",
} as Record<string, string>;

/**
 * Comissão: Relatório (comissao.ver) · A pagar e Pagas (comissao.pagar; somem com "Pagar a comissão" desligado) · Lançamentos
 * (comissao.lancar) · Regras (comissao.regras). Cada aba só aparece com a permissão dela.
 */
export default async function ComissaoPage({ searchParams }: PageProps<"/caixa/comissao">) {
  const user = await requireAnyPerm("comissao.ver", "comissao.regras", "comissao.pagar", "comissao.lancar", "config.sistema");
  const sp = await searchParams;
  const recursos = await getCaixaRecursos();
  const tabs = comissaoTabs(user.perms, recursos);
  const aba = pickAba(tabs, sp.aba);
  const today = todayBahia(new Date());
  const from = isDay(sp.de) ? sp.de : `${today.slice(0, 8)}01`, to = isDay(sp.ate) ? sp.ate : today;
  let body: ReactNode;
  if (aba === "lancamentos") {
    await materializeRules(to); // os "todo mês" do período nascem na hora de ler (idempotente)
    const [rows, rules, pros] = await Promise.all([listAdjustments({ from, to }), listAdjustmentRules(), listProfessionals()]);
    body = <AdjustmentsPanel rows={rows} rules={rules} professionals={pros.map((p) => ({ id: p.id, name: p.name }))} from={from} to={to} today={today} />;
  } else if (aba === "regras") {
    const [rows, casa] = await Promise.all([listCommissionRules(), getCommissionRules()]);
    body = <><CommissionHow rules={casa} descontosLigados={recursos.comissaoComDescontos} />
      {can(user.perms, "comissao.regras") && <div className="mb-5"><ApplyClosed from={shiftDay(today, -120)} to={today} /></div>}
      <CommissionRules rows={rows} casa={casa} assistentesLigado={recursos.assistentes} /></>;
  } else if (aba === "apagar") {
    // Cada profissional até o fim do último período fechado dela (o repasse do cadastro); só quem tem algo a pagar.
    const items = [];
    for (const p of await listProfessionals({ all: true })) {
      const payable = await payableFor({ professionalId: p.id, until: lastClosedPeriodEnd(p.payoutPeriod, today) });
      if (payable.lines.length || payable.adjustments.length) items.push(payable);
    }
    const gaps = await missingRules();
    // Sem nada a pagar mas com comissão sem regra: o aviso do que falta no lugar de "Nada a pagar" (psico r68 #19).
    body = <><MissingRules gaps={gaps} from={shiftDay(today, -120)} to={today} canEdit={can(user.perms, "comissao.regras")} />{items.length || !gaps.length ? <PayablesPanel items={items} /> : null}<section aria-labelledby="ja-pagas" className="mt-8"><h2 id="ja-pagas" className="mb-3 text-lg font-semibold">Já pagas</h2><PayoutsList rows={await listPayouts({ limit: 100 })} /></section></>;
  } else if (aba === "relatorio") {
    body = <CommissionTable report={await commissionReport({ from, to })} />;
  } else {
    // Sem aba: o que a pessoa podia ver está desligado em Configurações › Caixa.
    const off = can(user.perms, "comissao.pagar") && !recursos.pagarComissao ? "pagarComissao" : "vales";
    body = <p role="status" className="text-sm text-graphite">{recursoOffMessage(off)}</p>;
  }
  const withPeriod = aba === "relatorio" || aba === "lancamentos";
  return (
    <main className="pb-12">
      <PageHeader title="Comissão" subtitle={withPeriod ? `De ${from.split("-").reverse().join("/")} a ${to.split("-").reverse().join("/")}` : aba ? SUBTITLE[aba] : undefined} back={<PageBack href="/relatorios">Relatórios</PageBack>}
        tabs={<SectionTabs label="Comissão" tabs={tabs.map((t) => ({ key: t.value, label: t.label, href: `/caixa/comissao?aba=${t.value}` }))} current={aba ?? ""} />} />
      <div className="px-5 lg:px-8">
        {withPeriod && (
          <form className="mb-5 flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="aba" value={aba ?? ""} />
            <label className="flex flex-col gap-1 text-graphite">De<input type="date" name="de" defaultValue={from} className="h-10 rounded-[var(--radius-control)] border border-line-strong px-2" /></label>
            <label className="flex flex-col gap-1 text-graphite">Até<input type="date" name="ate" defaultValue={to} className="h-10 rounded-[var(--radius-control)] border border-line-strong px-2" /></label>
            <button type="submit" className="h-10 rounded-[var(--radius-control)] border border-line-strong px-3 font-medium hover:bg-paper-2">Ver período</button>
          </form>
        )}
        {body}
      </div>
    </main>
  );
}
