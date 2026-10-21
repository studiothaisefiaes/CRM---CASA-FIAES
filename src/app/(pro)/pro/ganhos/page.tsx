import { requirePerm } from "@/server/auth/session";
import { resolvePro } from "@/server/queries/pro";
import { getProEarnings, getProReceipts } from "@/server/queries/pro-earnings";
import { getProAppSettings } from "@/server/domain/pro/settings";
import { caixaOn } from "@/server/domain/agenda/ports";
import { GanhosView } from "@/components/pro/earnings-view";

export const metadata = { title: "Ganhos" };

/** Ganhos: exige `pro.ganhos`; os ganhos pedem o caixa no CRM (seção 8.4.7), os recibos não (pagar a comissão não depende do modo). */
export default async function ProEarningsPage() {
  const user = await requirePerm("pro.ganhos");
  const pro = await resolvePro(user.id);
  if (!pro) return null;
  const cfg = await getProAppSettings();
  const [data, receipts] = await Promise.all([
    (await caixaOn()) ? getProEarnings(pro, new Date(), { showServiceValue: cfg.mostraValorServico }) : null,
    getProReceipts(pro),
  ]);
  return (
    <main className="flex flex-col gap-3">
      <h1 className="font-display text-xl">Ganhos</h1>
      <GanhosView data={data} receipts={receipts} />
    </main>
  );
}
