import { alterarHorario } from "@/server/api/rotas/agenda";

// API v1: a trava (chave, escopo, permissão do perfil, limite) e a auditoria ficam em rotaApi (src/server/api/rota.ts).
export const dynamic = "force-dynamic";
export const PATCH = alterarHorario.handler;
