import { documentoOpenApi } from "@/server/api/openapi";

/**
 * O documento OpenAPI 3.1 da API v1, montado do registro central (uma vez por processo, ver documentoOpenApi). Público (sem chave): é só
 * a descrição das rotas, sem dado nenhum, para colar em outra IA ou num gerador de cliente.
 */
export const dynamic = "force-dynamic";
export function GET(_req: Request) {
  return new Response(documentoOpenApi(), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
