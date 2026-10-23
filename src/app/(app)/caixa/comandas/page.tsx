import Link from "next/link";
import { CaixaNav } from "@/components/caixa/caixa-nav";
import { ComandaProvider } from "@/components/caixa/comanda-provider";
import { ComandasList } from "@/components/caixa/comandas-list";
import { PageHeader } from "@/components/page-header";
import { LiveRefresh } from "@/components/shell/live";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { todayBahia } from "@/lib/agenda";
import { CAIXA_OFF } from "@/lib/caixa-settings";
import { cn } from "@/lib/cn";
import { isIsoDay } from "@/lib/caixa-recursos";
import { isUuid } from "@/lib/uuid";
import { requirePerm } from "@/server/auth/session";
import { getCaixaMode, getCaixaRules } from "@/server/domain/caixa/mode";
import { listProfessionals } from "@/server/domain/professionals";
import { listPaymentOptions } from "@/server/domain/caixa/payment-options";
import { isBlindFor } from "@/server/queries/caixa";
import { buildComandaCatalog } from "@/server/queries/comanda-catalog";
import { listComandas, type ComandaListStatus } from "@/server/queries/comandas-list";

export const metadata = { title: "Comandas" };

const STATUS: { value: ComandaListStatus | ""; label: string }[] = [
  { value: "", label: "Todas" }, { value: "aberta", label: "Abertas" }, { value: "fechada", label: "Pagas" }, { value: "divida", label: "Com dívida" }, { value: "cancelada", label: "Canceladas" },
];
const daysBefore = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/**
 * Caixa › Comandas (22/10, pedido do dono: "o histórico tá ruim, quero igual ao Avec"): as comandas por período, situação, profissional e
 * busca (cliente, telefone ou nº); tocar abre a comanda. Padrão: os últimos 7 dias.
 */
export default async function ComandasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePerm("caixa.operar");
  const sp = await searchParams;
  const tabs = <CaixaNav perms={user.perms} current="comandas" />;
  if ((await getCaixaMode()) !== "crm") return (
    <main className="pb-12"><PageHeader title="Comandas" tabs={tabs} /><div className="px-5 lg:px-8"><Empty title={CAIXA_OFF}>As comandas aparecem aqui quando o caixa do CRM for ligado.</Empty></div></main>
  );
  const today = todayBahia(new Date());
  const ate = isIsoDay(sp.ate) ? sp.ate : today;
  const de = isIsoDay(sp.de) && sp.de <= ate ? sp.de : daysBefore(ate, 6);
  const status = STATUS.some((s) => s.value && s.value === sp.status) ? (sp.status as ComandaListStatus) : undefined;
  const pro = isUuid(sp.pro) ? sp.pro : undefined;
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const [rules, pros, options] = await Promise.all([getCaixaRules(), listProfessionals(), listPaymentOptions({ activeOnly: true })]);
  // Revisão final: quem recebe uma comanda aberta daqui vê as "Outra forma" ativas, como no Caixa.
  const catalog = await buildComandaCatalog(user, { today, paymentOptions: options.map((o) => ({ id: o.id, label: o.label })) });
  const { rows, total } = await listComandas({ from: de, to: ate, status, q, professionalId: pro, blind: isBlindFor(rules, user) });
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ de, ate, status, q, pro, ...o }).filter((e): e is [string, string] => !!e[1]));
    return `/caixa/comandas?${p}`;
  };
  return (
    <main className="pb-12">
      <LiveRefresh scopes={["caixa"]} />
      <PageHeader title="Comandas" subtitle="O histórico das comandas: abertas, pagas, com dívida e canceladas" tabs={tabs} />
      <div className="flex flex-col gap-4 px-5 lg:px-8">
        <nav aria-label="Situação" className="flex flex-wrap gap-1.5">
          {STATUS.map((s) => (
            <Link key={s.value || "todas"} href={href({ status: s.value || undefined })} aria-current={(status ?? "") === s.value ? "page" : undefined}
              className={cn("inline-flex min-h-11 items-center rounded-full border px-3 text-sm lg:min-h-9", (status ?? "") === s.value ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-paper-2")}>{s.label}</Link>
          ))}
        </nav>
        <form method="get" action="/caixa/comandas" className="flex flex-wrap items-end gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-sm text-graphite">Buscar
            <Input type="search" name="q" defaultValue={q ?? ""} placeholder="Cliente, telefone ou nº da comanda" className="h-11" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-graphite">Profissional
            <Select name="pro" defaultValue={pro ?? ""} className="h-11">
              <option value="">Todas</option>
              {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-graphite">De<Input type="date" name="de" defaultValue={de} className="h-11" /></label>
          <label className="flex flex-col gap-1 text-sm text-graphite">Até<Input type="date" name="ate" defaultValue={ate} className="h-11" /></label>
          <Button type="submit" variant="secondary">Filtrar</Button>
        </form>
        <ComandaProvider catalog={catalog}>
          <ComandasList rows={rows} total={total} />
        </ComandaProvider>
      </div>
    </main>
  );
}
