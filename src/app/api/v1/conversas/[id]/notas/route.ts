import { novaNota } from "@/server/api/rotas/conversas";

// API v1: a trava (chave, escopo, permissão do perfil, limite) e a auditoria ficam em rotaApi (src/server/api/rota.ts).
export const dynamic = "force-dynamic";
export const POST = novaNota.handler;
