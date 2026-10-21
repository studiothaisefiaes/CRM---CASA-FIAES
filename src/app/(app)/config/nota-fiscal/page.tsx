import { requirePerm } from "@/server/auth/session";
import { fiscalReadiness, getFiscalEmpresa, getFiscalRegras, getNfceModo, getNfseModo } from "@/server/domain/fiscal/config";
import { FiscalSettingsForm } from "@/components/config/fiscal-settings";

export const metadata = { title: "Nota fiscal" };

/** Configurações › Agenda e caixa › Nota fiscal. Só quem tem "Configurar a nota fiscal". */
export default async function NotaFiscalConfigPage() {
  await requirePerm("nota.configurar");
  const [empresa, regras, nfse, nfce, readiness, readinessNfce] = await Promise.all([getFiscalEmpresa(), getFiscalRegras(), getNfseModo(), getNfceModo(), fiscalReadiness("nfse"), fiscalReadiness("nfce")]);
  return <FiscalSettingsForm empresa={empresa} regras={regras} nfse={nfse} nfce={nfce} missing={readiness.missing} missingNfce={readinessNfce.missing} />;
}
