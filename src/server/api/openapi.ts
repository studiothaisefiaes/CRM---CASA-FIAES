import { z } from "zod";
import type { RotaApi } from "./rota";
import { ROTAS } from "./rotas";
import { zErro } from "./rota";
import { LIMITE_ENVIOS, LIMITE_ENVIOS_GLOBAL_DIA, LIMITE_ENVIOS_GLOBAL_MIN, LIMITE_ENVIOS_PESSOA, LIMITE_GERAL } from "./limite";

/**
 * OpenAPI 3.1 montado do registro central (cada `rotaApi` declara método, caminho, escopo, permissão, schemas zod e a descrição).
 * Não há documento escrito à mão para envelhecer: rota nova aparece aqui sozinha; o teste confere que toda rota do registro está no
 * documento e que toda rota do app (src/app/api/v1) está no registro.
 */
type Json = Record<string, unknown>;
const semDollar = (s: Json) => { const { $schema: _, ...rest } = s; return rest; };
const esquema = (s: z.ZodType, io: "input" | "output") => semDollar(z.toJSONSchema(s, { io, unrepresentable: "any", target: "draft-2020-12" }) as Json);

function parametros(obj: z.ZodObject<z.ZodRawShape> | undefined, onde: "path" | "query"): Json[] {
  if (!obj) return [];
  const s = esquema(obj, "input") as { properties?: Record<string, Json>; required?: string[] };
  return Object.entries(s.properties ?? {}).map(([name, schema]) => {
    const { description, ...resto } = schema as { description?: string };
    return { name, in: onde, required: onde === "path" || (s.required ?? []).includes(name), ...(description ? { description } : {}), schema: resto };
  });
}

const ERROS: Record<string, string> = {
  "400": "Entrada inválida (o texto diz qual campo).",
  "401": "Sem chave, chave inválida, revogada, vencida ou pessoa desativada.",
  "403": "A chave não tem o escopo ou a pessoa da chave não tem a permissão (ou a conversa é de outra pessoa).",
  "404": "Não encontrado.",
  "409": "Conflito com o estado atual.",
  "429": "Passou de um limite de uso (da chave, da pessoa, da Casa ou do IP); veja o cabeçalho Retry-After.",
};

export function montarOpenApi(rotas: readonly RotaApi[], servidor = "/"): Json {
  const paths: Record<string, Record<string, Json>> = {};
  const tags = new Set<string>();
  for (const r of rotas) {
    tags.add(r.grupo);
    const caminho = `/api/v1${r.caminho}`;
    const perm = r.perm === null ? `nenhuma (${r.semPerm})` : typeof r.perm === "string" ? r.perm : r.perm.join(" ou ");
    const content: Json = {};
    if (r.corpo) content["application/json"] = { schema: esquema(r.corpo, "input") };
    if (r.multipart) content["multipart/form-data"] = { schema: esquema(r.multipart, "input") };
    const ok = String(r.status ?? 200);
    paths[caminho] ??= {};
    paths[caminho][r.metodo.toLowerCase()] = {
      operationId: `${r.metodo.toLowerCase()}${r.caminho.replace(/\{(\w+)\}/g, "_$1").replace(/[^a-zA-Z0-9_]+/g, "_")}`,
      tags: [r.grupo],
      summary: r.resumo,
      description: [r.descricao, `**Escopo da chave:** \`${r.escopo}\`. **Permissão do perfil:** ${perm}.`].filter(Boolean).join("\n\n"),
      "x-escopo": r.escopo,
      "x-permissao": r.perm,
      parameters: [...parametros(r.params, "path"), ...parametros(r.query, "query")],
      ...(Object.keys(content).length ? { requestBody: { required: true, content } } : {}),
      responses: {
        [ok]: { description: "Sucesso.", content: { "application/json": { schema: esquema(r.resposta, "output") } } },
        ...Object.fromEntries(Object.entries(ERROS).map(([s, d]) => [s, { description: d, content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } }])),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "API do CRM da Casa Fiaes",
      version: "1.0.0",
      description: [
        "Leitura e escrita no CRM por scripts e integrações. Autenticação: `Authorization: Bearer cf_…` (chave criada em Configurações › API).",
        "A chave age em nome de uma pessoa da equipe: valem as permissões do perfil dela E os escopos da chave (`ler`, `escrever`, `enviar`).",
        `Limite por chave: ${LIMITE_GERAL} pedidos por minuto e ${LIMITE_ENVIOS} envios de WhatsApp por minuto. Envios também: ${LIMITE_ENVIOS_PESSOA} por minuto por pessoa (somando as chaves dela) e, na Casa toda pela API, ${LIMITE_ENVIOS_GLOBAL_MIN} por minuto e ${LIMITE_ENVIOS_GLOBAL_DIA} por dia (429 com Retry-After).`,
        "Datas em ISO 8601 com fuso; a Casa usa -03:00 (America/Bahia). Listas: `?limite=` (até 200) e `?cursor=` (o `proximo_cursor` da resposta).",
        "Erros: `{ \"erro\": \"texto\" }` com o status certo.",
      ].join("\n\n"),
    },
    servers: [{ url: servidor }],
    security: [{ chave: [] }],
    tags: [...tags].map((name) => ({ name })),
    components: {
      securitySchemes: { chave: { type: "http", scheme: "bearer", description: "Chave da API: cf_… (Configurações › API)." } },
      schemas: { Erro: esquema(zErro, "output") },
    },
    paths,
  };
}

let guardado: string | null = null;
/**
 * O documento das rotas do registro, montado UMA vez por processo e guardado já em texto (o registro não muda com o servidor no ar).
 * O servidor é o APP_URL (o endereço do CRM), nunca o Host de quem pede.
 */
export function documentoOpenApi(): string {
  guardado ??= JSON.stringify(montarOpenApi(ROTAS, process.env.APP_URL || "/"));
  return guardado;
}
