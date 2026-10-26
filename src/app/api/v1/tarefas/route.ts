import { criarTarefa, listarTarefas } from "@/server/api/rotas/tarefas";

// API v1: a trava (chave, escopo, permissão do perfil, limite) e a auditoria ficam em rotaApi (src/server/api/rota.ts).
export const dynamic = "force-dynamic";
export const GET = listarTarefas.handler;
export const POST = criarTarefa.handler;
