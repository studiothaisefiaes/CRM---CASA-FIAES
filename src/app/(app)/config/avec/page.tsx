import { requirePerm } from "@/server/auth/session";
import { getAgendaMode, getAgendaRules } from "@/server/domain/agenda/mode";
import { getCaixaMode, getCaixaRules } from "@/server/domain/caixa/mode";
import { AgendaSettingsForm } from "@/components/config/agenda-settings";
import { CaixaSettingsForm } from "@/components/config/caixa-settings";
import { AvecRoboForm } from "@/components/config/avec-robo";
import { getRoboConfig, getRoboLast } from "@/server/domain/avec/robo/settings";

export const metadata = { title: "Ligação com o Avec" };

/**
 * Área de cuidado › Ligação com o Avec (F5): o modo da agenda e onde a Casa recebe, os dois que mudam onde a recepção trabalha.
 * Os formulários são os de Agenda e Caixa, mostrando só o modo; o passo e a regra do caixa aberto são salvos como estão.
 */
export default async function AvecPage() {
  await requirePerm("config.sistema");
  const [agendaMode, agendaRules, caixaMode, caixaRules, robo, last] = await Promise.all([getAgendaMode(), getAgendaRules(), getCaixaMode(), getCaixaRules(), getRoboConfig(), getRoboLast()]);
  return (
    <div className="grid items-start gap-6 min-[1100px]:grid-cols-2">
      <AgendaSettingsForm mode={agendaMode} passoMin={agendaRules.passoMin} parts="modo" />
      <CaixaSettingsForm mode={caixaMode} exigeCaixaAberto={caixaRules.exigeCaixaAberto} parts="modo" />
      <AvecRoboForm ativo={robo.ativo} hora={robo.hora} last={last && { em: last.em, ok: last.ok, linhasNovas: last.linhasNovas, erros: last.erros, relatorios: last.relatorios.length }} />
    </div>
  );
}
