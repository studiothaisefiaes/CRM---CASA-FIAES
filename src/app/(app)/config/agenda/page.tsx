import { requirePerm } from "@/server/auth/session";
import { getAgendaMode, getAgendaRules } from "@/server/domain/agenda/mode";
import { getRepetirConfig } from "@/server/domain/agenda/recurrence";
import { getFuncoes } from "@/server/domain/funcoes";
import { AgendaSettingsForm } from "@/components/config/agenda-settings";
import { RepetirSettings } from "@/components/config/repetir-settings";

export const metadata = { title: "Intervalo da agenda" };

/**
 * Configurações › Agenda e caixa › Intervalo da agenda (sem `parte`) e Repetir horário (`?parte=repetir`, item 23a): dois itens na mesma
 * página, os dois de config.sistema (limite da agenda é configuração do sistema). O modo (consulta, dupla, só CRM) fica em Área de cuidado.
 */
export default async function AgendaConfigPage({ searchParams }: PageProps<"/config/agenda">) {
  await requirePerm("config.sistema");
  if ((await searchParams).parte === "repetir") {
    const [config, funcoes] = await Promise.all([getRepetirConfig(), getFuncoes()]);
    return <RepetirSettings config={config} repetirOn={funcoes.repetir} />;
  }
  const [mode, rules] = await Promise.all([getAgendaMode(), getAgendaRules()]);
  return <AgendaSettingsForm mode={mode} passoMin={rules.passoMin} parts="passo" />;
}
