import { SectionTabs } from "@/components/shell/section-tabs";
import { can } from "@/lib/permissions";
import { getCaixaMode } from "@/server/domain/caixa/mode";

/**
 * As abas do Caixa (dsgfix: abas de verdade, logo abaixo do título, não texto solto): "Caixa" (a operação do dia) e "Caixas da equipe"
 * (caixa.outros). Uma aba só = nada a trocar, não aparece. Pacotes moram só em Serviços e pacotes (r66 #10).
 * "Fechar caixa / dia" é o botão do cabeçalho; o histórico de fechamentos mora dentro dele.
 */
export async function CaixaNav({ perms, current }: { perms: readonly string[]; current: string }) {
  if (!can(perms, "caixa.operar")) return null;
  const on = (await getCaixaMode()) === "crm";
  const links = [
    ...(on ? [{ key: "caixa", label: "Caixa", href: "/caixa" }] : []),
    ...(on && can(perms, "caixa.outros") ? [{ key: "equipe", label: "Caixas da equipe", href: "/caixa/equipe" }] : []),
  ];
  return <SectionTabs label="Caixa" tabs={links} current={current} />;
}
