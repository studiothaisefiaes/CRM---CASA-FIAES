import { listarEtapas } from "@/server/api/rotas/funil";

// API v1: a trava (chave, escopo, permissão do perfil, limite) e a auditoria ficam em rotaApi (src/server/api/rota.ts).
export const dynamic = "force-dynamic";
export const GET = listarEtapas.handler;
