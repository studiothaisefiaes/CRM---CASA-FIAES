import { requirePerm } from "@/server/auth/session";
import { getFinanceiroConfig } from "@/server/domain/financeiro/config";
import { FinanceiroSettingsForm } from "@/components/config/financeiro-settings";

export const metadata = { title: "Financeiro" };

/** Configurações › Agenda e caixa › Financeiro. */
export default async function FinanceiroConfigPage() {
  await requirePerm("config.sistema");
  return <FinanceiroSettingsForm config={await getFinanceiroConfig()} />;
}
