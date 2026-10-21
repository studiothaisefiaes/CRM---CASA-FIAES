import { requirePerm } from "@/server/auth/session";
import { getEstoqueConfig } from "@/server/domain/estoque/config";
import { EstoqueSettingsForm } from "@/components/config/estoque-settings";

export const metadata = { title: "Estoque" };

/** Configurações › Agenda e caixa › Estoque. */
export default async function EstoqueConfigPage() {
  await requirePerm("config.sistema");
  return <EstoqueSettingsForm config={await getEstoqueConfig()} />;
}
