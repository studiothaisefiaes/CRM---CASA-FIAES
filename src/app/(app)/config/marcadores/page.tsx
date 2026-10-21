import { requirePerm } from "@/server/auth/session";
import { getVisitTypes, listAppointmentLabels } from "@/server/domain/agenda/labels";
import { getFuncoes } from "@/server/domain/funcoes";
import { MarcadoresSettings } from "@/components/config/marcadores-settings";

export const metadata = { title: "Marcadores do horário" };

/** Configurações › Agenda e caixa › Marcadores do horário: a lista de marcadores e os tipos (Indicação, Noiva). Pede config.marcadores. */
export default async function MarcadoresPage() {
  await requirePerm("config.marcadores");
  const [labels, types, funcoes] = await Promise.all([listAppointmentLabels({ all: true }), getVisitTypes(), getFuncoes()]);
  return <MarcadoresSettings labels={labels} types={types} marcadoresOn={funcoes.marcadores} tiposOn={funcoes.tipo_horario} />;
}
