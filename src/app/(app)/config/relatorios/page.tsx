import { requirePerm } from "@/server/auth/session";
import { getRelatoriosConfig } from "@/server/domain/relatorios-config";
import { RelatoriosSettingsForm } from "@/components/config/relatorios-settings";

export const metadata = { title: "Relatórios" };

/** Configurações › Agenda e caixa › Relatórios. */
export default async function RelatoriosConfigPage() {
  await requirePerm("config.sistema");
  return <RelatoriosSettingsForm config={await getRelatoriosConfig()} />;
}
