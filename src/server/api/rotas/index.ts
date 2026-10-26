import type { RotaApi } from "../rota";
import { eu } from "./eu";
import { alterarConversa, enviarMensagem, listarConversas, listarMensagens, novaConversa, novaNota, verConversa } from "./conversas";
import { alterarContato, criarContato, listarContatos, verContato } from "./contatos";
import { listarEtapas } from "./funil";
import { alterarHorario, listarAgenda, listarProfissionais, listarServicos, marcarHorario } from "./agenda";
import { concluirTarefa, criarTarefa, listarTarefas } from "./tarefas";
import { alterarResposta, criarResposta, listarRespostas } from "./respostas";
import { listarAvisos } from "./avisos";
import { RELATORIOS } from "./relatorios";

/**
 * O registro central da API v1: TODA rota declarada aqui aparece no OpenAPI (/api/v1/openapi.json). O teste confere que cada rota do
 * registro tem o seu route.ts em src/app/api/v1 (exportando o mesmo handler) e que nenhum route.ts de lá fica fora do registro.
 */
export const ROTAS: readonly RotaApi[] = [
  eu,
  listarContatos, criarContato, verContato, alterarContato,
  listarConversas, novaConversa, verConversa, alterarConversa, listarMensagens, enviarMensagem, novaNota,
  listarEtapas,
  listarAgenda, marcarHorario, alterarHorario, listarProfissionais, listarServicos,
  listarTarefas, criarTarefa, concluirTarefa,
  listarRespostas, criarResposta, alterarResposta,
  listarAvisos,
  ...RELATORIOS,
];

/** Um relatório pelo caminho (os route.ts de /relatorios/* usam isto). */
export const relatorio = (caminho: string): RotaApi => {
  const r = RELATORIOS.find((x) => x.caminho === `/relatorios/${caminho}`);
  if (!r) throw new Error(`relatório ${caminho} não registrado`);
  return r;
};
