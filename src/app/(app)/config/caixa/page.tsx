import { requirePerm } from "@/server/auth/session";
import { getCaixaMode, getCaixaRules } from "@/server/domain/caixa/mode";
import { getCaixaRecursos } from "@/server/domain/caixa/recursos";
import { CaixaRecursosForm } from "@/components/config/caixa-recursos";
import { CaixaSettingsForm } from "@/components/config/caixa-settings";
import { CaixaRulesForm } from "@/components/caixa/caixa-rules-form";

export const metadata = { title: "Caixa, pacotes e comissão" };

/** Configurações › Agenda e caixa › Caixa, pacotes e comissão. Onde a Casa recebe (Avec ou CRM) fica em Área de cuidado › Ligação com o Avec (/config/avec). */
export default async function CaixaConfigPage() {
  await requirePerm("config.sistema");
  const [mode, rules, recursos] = await Promise.all([getCaixaMode(), getCaixaRules(), getCaixaRecursos()]);
  return (
    <div className="flex flex-col gap-8">
      <CaixaSettingsForm mode={mode} exigeCaixaAberto={rules.exigeCaixaAberto} parts="regras" />
      {/* As regras do fechamento saíram de Caixas da equipe (dsgfix, r68 #4): configuração mora em Configurações. */}
      <div id="regras-fechamento" className="scroll-mt-6"><CaixaRulesForm rules={rules} /></div>
      <CaixaRecursosForm value={recursos} />
    </div>
  );
}
