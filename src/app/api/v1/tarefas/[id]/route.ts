import { concluirTarefa } from "@/server/api/rotas/tarefas";

// API v1: a trava (chave, escopo, permissão do perfil, limite) e a auditoria ficam em rotaApi (src/server/api/rota.ts).
export const dynamic = "force-dynamic";
export const PATCH = concluirTarefa.handler;
