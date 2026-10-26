import { relatorio } from "@/server/api/rotas/index";

// API v1: a trava (chave, escopo, permissão do perfil, limite) e a auditoria ficam em rotaApi (src/server/api/rota.ts).
export const dynamic = "force-dynamic";
export const GET = relatorio("respostas-por-pessoa").handler;
