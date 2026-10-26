import { alterarContato, verContato } from "@/server/api/rotas/contatos";

// API v1: a trava (chave, escopo, permissão do perfil, limite) e a auditoria ficam em rotaApi (src/server/api/rota.ts).
export const dynamic = "force-dynamic";
export const GET = verContato.handler;
export const PATCH = alterarContato.handler;
