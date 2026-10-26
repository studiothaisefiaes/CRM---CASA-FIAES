import { alterarResposta } from "@/server/api/rotas/respostas";

// API v1: a trava (chave, escopo, permissão do perfil, limite) e a auditoria ficam em rotaApi (src/server/api/rota.ts).
export const dynamic = "force-dynamic";
export const PATCH = alterarResposta.handler;
