import { z } from "zod";
import { can, type Perm } from "@/lib/permissions";
import { db } from "../db";
import { auditLog } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { OUT_OF_SCOPE } from "../domain/deal-scope";
import { ReopenConflict } from "../domain/deals";
import { NotSentError, SendError, UNCERTAIN_SEND_MESSAGE, UncertainSendError } from "../domain/send";
import { ProviderError } from "../whatsapp/provider";
import { GENERIC_ERROR, userErrorMessage } from "../user-error";
import { autenticarChave, type ChaveAutenticada, type Escopo } from "./chaves";
import { API_MAX_BYTES, JSON_MAX_BYTES, TEXTO_CORPO_GRANDE, TEXTO_JSON_GRANDE } from "./corpo";
import { clientIp } from "../auth/client-ip";
import { onClientHost } from "@/lib/client-host";
import { contar, contarTodos, DIA_MS, LIMITE_ENVIOS, LIMITE_ENVIOS_GLOBAL_DIA, LIMITE_ENVIOS_GLOBAL_MIN, LIMITE_ENVIOS_PESSOA, LIMITE_GERAL, LIMITE_IP_SEM_CHAVE } from "./limite";

/**
 * Cada rota da API v1 é declarada UMA vez aqui (`rotaApi`): método, caminho, escopo da chave, permissão do perfil, schemas zod de
 * entrada e saída e a descrição em PT-BR. Daí saem o route handler do Next (src/app/api/v1/**) e o OpenAPI (/api/v1/openapi.json).
 * A ordem das travas é sempre a mesma: host da cliente (404) → https (403) → chave (401; sem chave válida, limite por IP, 429) →
 * limite geral (429) → escopo da chave (403) → permissão do perfil (403) → entrada (400, corpo com teto: 413) → função de domínio.
 * O que manda WhatsApp chama `exigirEnvio()` depois de conferir tudo e logo antes de mandar (limites de envio, 429): pedido recusado
 * não gasta o limite de ninguém. Toda escrita autenticada vai para o audit_log (entity "api", entityId = id da chave), com a rota,
 * o status, o alvo e quem criou a chave (criada_por).
 */
export type Metodo = "GET" | "POST" | "PATCH";

/** Erro com status e texto pronto (PT-BR) para quem chama. */
export class ApiErro extends Error {
  constructor(public readonly status: number, message: string, public readonly headers: Record<string, string> = {}) { super(message); }
}

type Obj = z.ZodObject<z.ZodRawShape>;
export type CtxRota<P, Q, B> = {
  req: Request;
  user: SessionUser;
  chave: ChaveAutenticada["chave"];
  params: P; query: Q; body: B;
  /** Corpo multipart (envio de arquivo), quando a rota aceita e o pedido veio assim. */
  form: FormData | null;
  /** O registro (id) em que a escrita mexeu: vai para a auditoria. */
  alvo: (id: string | null | undefined) => void;
  /**
   * Esta escrita vai mandar WhatsApp para a cliente: exige o escopo "enviar" e conta nos limites de envio (da chave, da pessoa e da Casa
   * toda; lança 403/429). Chamar depois de conferir tudo e antes de mandar. Rota com escopo "enviar" PRECISA chamar.
   */
  exigirEnvio: () => void;
};
/** `periodo`: os relatórios dizem o período que valeu. */
export type Resposta = { dados: unknown; proximo_cursor?: string | null; periodo?: unknown };

export type DefRota<P extends Obj | undefined, Q extends Obj | undefined, B extends z.ZodType | undefined> = {
  metodo: Metodo;
  /** Caminho depois de /api/v1, com {param} (estilo OpenAPI). */
  caminho: string;
  /** Escopo da chave: GET = "ler"; criar/alterar = "escrever"; o que manda WhatsApp para cliente = "enviar". */
  escopo: Escopo;
  /** Permissão do perfil (uma, ou qualquer uma da lista). null só com `semPerm` dizendo por quê (dado da própria pessoa). */
  perm: Perm | readonly Perm[] | null;
  semPerm?: string;
  grupo: string;
  resumo: string;
  descricao?: string;
  params?: P; query?: Q; corpo?: B;
  /** Aceita também multipart/form-data (envio de arquivo). O schema documenta os campos; quem lê o FormData é o handler. */
  multipart?: Obj;
  resposta: z.ZodType;
  /** Status de sucesso (padrão 200; criar = 201). */
  status?: number;
  handler: (ctx: CtxRota<P extends Obj ? z.output<P> : Record<string, never>, Q extends Obj ? z.output<Q> : Record<string, never>, B extends z.ZodType ? z.output<B> : undefined>) => Promise<Resposta>;
};

type DefGeral = DefRota<Obj | undefined, Obj | undefined, z.ZodType | undefined>;
export type RotaApi = Omit<DefGeral, "handler"> & {
  /** O route handler do Next. */
  handler: (req: Request, ctx: { params: Promise<Record<string, string | string[] | undefined>> }) => Promise<Response>;
  executar: DefGeral["handler"];
};

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" };
export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(paraJson(body)), { status, headers: { ...HEADERS, ...extra } });
const erro = (status: number, mensagem: string, extra: Record<string, string> = {}) => json({ erro: mensagem }, status, extra);

/** Datas sempre com o fuso da Casa (America/Bahia, -03:00, sem horário de verão): "2026-10-26T14:00:00-03:00". */
export const isoBahia = (d: Date) => `${new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;
/** Troca toda Date (em qualquer profundidade) pelo ISO da Casa. */
export function paraJson(v: unknown): unknown {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : isoBahia(v);
  if (Array.isArray(v)) return v.map(paraJson);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, paraJson(x)]));
  return v;
}

const PT = z.locales.pt();
/** O primeiro problema da entrada, em português, com o nome do campo. */
function textoZod(e: z.ZodError, onde: string): string {
  const i = e.issues[0];
  if (!i) return "Entrada inválida.";
  const campo = i.path.length ? i.path.join(".") : onde;
  return `${campo}: ${i.message}`;
}
const validar = <S extends z.ZodType>(s: S, v: unknown, onde: string): z.output<S> => {
  const r = s.safeParse(v, { error: PT.localeError });
  if (!r.success) throw new ApiErro(400, textoZod(r.error, onde));
  return r.data;
};

/** O que a API diz quando o provedor do WhatsApp recusou (nunca o texto dele). */
export const TEXTO_WHATSAPP_RECUSOU = "O WhatsApp não aceitou a mensagem.";
/** O campo `erro` de uma mensagem para fora: o texto do envio incerto é nosso e importa (conferir antes de reenviar); o resto é do provedor. */
export const erroParaFora = (erro: string | null) => (erro === null ? null : erro === UNCERTAIN_SEND_MESSAGE ? erro : TEXTO_WHATSAPP_RECUSOU);

/** Erro do domínio → status. O texto é o mesmo que a tela mostraria (userErrorMessage); erro de sistema vira 500 com texto genérico. */
export function statusDoErro(e: unknown): { status: number; mensagem: string; headers?: Record<string, string> } {
  if (e instanceof ApiErro) return { status: e.status, mensagem: e.message, headers: e.headers };
  if (e instanceof z.ZodError) return { status: 400, mensagem: textoZod(e, "entrada") };
  const mensagem = userErrorMessage(e, "api");
  if (mensagem === GENERIC_ERROR && !(e instanceof Error && e.message === GENERIC_ERROR)) return { status: 500, mensagem };
  // Recusa por quem a pessoa é ("não tem permissão", "Só a gestão…", a conversa de outra pessoa): 403.
  if (mensagem === OUT_OF_SCOPE || /permissão/i.test(mensagem) || /^Só a gestão/.test(mensagem)) return { status: 403, mensagem };
  if (e instanceof ReopenConflict) return { status: 409, mensagem };
  // O WhatsApp não aceitou, não respondeu ou está desconectado: 502 (o pedido estava certo). Os outros SendError são a entrada (400).
  // Revisão de segurança 26/10: o que o provedor disse (texto bruto da Evolution) não sai pela API; os nossos textos (incerto,
  // desconectado) saem como estão.
  if (e instanceof UncertainSendError) return { status: 502, mensagem };
  if (e instanceof NotSentError || e instanceof ProviderError || (e instanceof SendError && /^Não foi possível enviar/.test(mensagem))) return { status: 502, mensagem: TEXTO_WHATSAPP_RECUSOU };
  if (e instanceof SendError && /desconectado|Nenhum WhatsApp conectado|ainda não envia/.test(mensagem)) return { status: 502, mensagem };
  if (/não existe|não encontrad|não foi encontrad/i.test(mensagem)) return { status: 404, mensagem };
  return { status: 400, mensagem };
}

/**
 * Lê o corpo com teto: confere o Content-Length antes de ler e conta os bytes lidos (o cabeçalho pode faltar ou mentir). Passou: 413,
 * sem ler o resto.
 */
async function lerCorpo(req: Request, max: number, texto: string): Promise<Uint8Array<ArrayBuffer>> {
  const declarado = req.headers.get("content-length");
  if (declarado !== null && !(Number(declarado) <= max)) throw new ApiErro(413, texto);
  if (!req.body) return new Uint8Array(0);
  const partes: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw new ApiErro(413, texto); }
    partes.push(value);
  }
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.byteLength; }
  return out;
}

const temPerm = (user: SessionUser, perm: DefRota<Obj | undefined, Obj | undefined, z.ZodType | undefined>["perm"]) =>
  perm === null || (typeof perm === "string" ? can(user.perms, perm) : perm.some((p) => can(user.perms, p)));
const nomesPerm = (perm: Perm | readonly Perm[]) => (typeof perm === "string" ? perm : perm.join(" ou "));

/** Texto do 429 dos envios: qual limite barrou. */
function textoLimiteEnvio(regra: string, retry: number): string {
  const quando = `Tente de novo em ${retry} s.`;
  if (regra.startsWith("envio-pessoa:")) return `Muitos envios de WhatsApp por pessoa, somando as chaves dela (máximo ${LIMITE_ENVIOS_PESSOA} por minuto). ${quando}`;
  if (regra === "envio-casa:min") return `Muitos envios de WhatsApp pela API na Casa toda (máximo ${LIMITE_ENVIOS_GLOBAL_MIN} por minuto, somando todas as chaves da Casa). ${quando}`;
  if (regra === "envio-casa:dia") return `A API já mandou o máximo de WhatsApp do dia da Casa toda (${LIMITE_ENVIOS_GLOBAL_DIA} em 24 h). ${quando}`;
  return `Muitos envios de WhatsApp com esta chave (máximo ${LIMITE_ENVIOS} por minuto). ${quando}`;
}

export const TEXTO_USE_HTTPS = "Use https: a chave da API só vale em conexão segura (https://). Se ela passou por http, revogue e crie outra em Configurações › API.";

/** Texto do 403 quando falta o escopo: diz qual escopo e como resolver. */
export const textoSemEscopo = (e: Escopo) => `Esta chave não tem o escopo "${e}". Crie uma chave com esse escopo em Configurações › API.`;

export function rotaApi<P extends Obj | undefined = undefined, Q extends Obj | undefined = undefined, B extends z.ZodType | undefined = undefined>(def: DefRota<P, Q, B>): RotaApi {
  if (def.perm === null && !def.semPerm) throw new Error(`rota ${def.metodo} ${def.caminho}: perm null sem motivo`);
  const geral = def as unknown as DefRota<Obj | undefined, Obj | undefined, z.ZodType | undefined>;
  const handler = async (req: Request, ctx: { params: Promise<Record<string, string | string[] | undefined>> }): Promise<Response> => {
    // O endereço só da cliente (CLIENT_LINK_URL) não tem API (o proxy já desvia; aqui é a segunda trava, para quem o proxy não viu).
    if (onClientHost(req.headers)) return erro(404, "Não encontrado.");
    // Chave que chegou ao Caddy sem https: recusa (a chave passou em texto aberto e quem chama precisa saber).
    const proto = req.headers.get("x-forwarded-proto");
    if (req.headers.has("authorization") && proto && proto.split(",")[0].trim().toLowerCase() !== "https") return erro(403, TEXTO_USE_HTTPS);
    const auth = await autenticarChave(req.headers.get("authorization"));
    if ("erro" in auth) {
      // Sem chave ou com chave que não vale: limite por IP (o que o Caddy acrescentou ao x-forwarded-for, ver auth/client-ip.ts).
      const ip = contar(`ip:${clientIp(req.headers)}`, LIMITE_IP_SEM_CHAVE);
      if (!ip.ok) return erro(429, `Muitos pedidos sem chave válida deste endereço (máximo ${LIMITE_IP_SEM_CHAVE} por minuto). Tente de novo em ${ip.retryAfter} s.`, { "retry-after": String(ip.retryAfter) });
      return erro(401, auth.erro, { "www-authenticate": 'Bearer realm="api"' });
    }
    const { user, chave } = auth;
    const limite = contar(`geral:${chave.id}`, LIMITE_GERAL);
    if (!limite.ok) return erro(429, `Muitos pedidos com esta chave (máximo ${LIMITE_GERAL} por minuto). Tente de novo em ${limite.retryAfter} s.`, { "retry-after": String(limite.retryAfter) });

    const escrita = def.metodo !== "GET";
    let status = 500, alvo: string | null = null;
    const rota = new URL(req.url).pathname;
    try {
      if (!chave.escopos.includes(def.escopo)) throw new ApiErro(403, textoSemEscopo(def.escopo));
      if (!temPerm(user, def.perm)) throw new ApiErro(403, `A pessoa desta chave (${user.name}) não tem a permissão para isso no perfil dela (${nomesPerm(def.perm!)}).`);
      const params = def.params ? validar(def.params, await ctx.params, "params") : {};
      const query = def.query ? validar(def.query, Object.fromEntries(new URL(req.url).searchParams), "query") : {};
      let body: unknown = undefined, form: FormData | null = null;
      const tipo = req.headers.get("content-type") ?? "";
      if (def.multipart && /^multipart\/form-data/i.test(tipo)) {
        const bytes = await lerCorpo(req, API_MAX_BYTES, TEXTO_CORPO_GRANDE);
        try { form = await new Response(bytes, { headers: { "content-type": tipo } }).formData(); } catch { throw new ApiErro(400, "Corpo multipart inválido."); }
      } else if (def.corpo) {
        const bytes = await lerCorpo(req, JSON_MAX_BYTES, TEXTO_JSON_GRANDE);
        let cru: unknown;
        try { const txt = new TextDecoder().decode(bytes); cru = txt ? JSON.parse(txt) : {}; } catch { throw new ApiErro(400, "Corpo JSON inválido."); }
        body = validar(def.corpo, cru, "corpo");
      }
      let envioContado = false;
      const exigirEnvio = () => {
        if (!chave.escopos.includes("enviar")) throw new ApiErro(403, textoSemEscopo("enviar"));
        if (envioContado) return;
        const l = contarTodos([
          { chave: `envio:${chave.id}`, max: LIMITE_ENVIOS },
          { chave: `envio-pessoa:${user.id}`, max: LIMITE_ENVIOS_PESSOA },
          { chave: "envio-casa:min", max: LIMITE_ENVIOS_GLOBAL_MIN },
          { chave: "envio-casa:dia", max: LIMITE_ENVIOS_GLOBAL_DIA, janela: DIA_MS },
        ]);
        if (!l.ok) throw new ApiErro(429, textoLimiteEnvio(l.regra, l.retryAfter), { "retry-after": String(l.retryAfter) });
        envioContado = true;
      };
      const r = await geral.handler({ req, user, chave, params, query, body, form, alvo: (id: string | null | undefined) => { alvo = id ?? null; }, exigirEnvio } as never);
      // Rota de envio que esqueceu de contar: fica no log (o teste de cada rota de envio confere o 429).
      if (def.escopo === "enviar" && !envioContado) console.error(`[api] ${def.metodo} ${def.caminho}: rota de envio sem exigirEnvio()`);
      status = def.status ?? 200;
      return json(r, status);
    } catch (e) {
      const s = statusDoErro(e);
      status = s.status;
      return erro(s.status, s.mensagem, s.headers);
    } finally {
      if (escrita) {
        // A auditoria nunca derruba a resposta: se falhar, fica no log do servidor.
        await db.insert(auditLog).values({ userId: user.id, action: `${def.metodo} ${def.caminho}`, entity: "api", entityId: chave.id, data: { rota, metodo: def.metodo, status, alvo, chave: chave.prefixo, criada_por: chave.criadaPor } })
          .catch((e: unknown) => console.error("[api] auditoria", e));
      }
    }
  };
  return { ...geral, handler, executar: geral.handler };
}

// ---------- Schemas comuns ----------

export const zUuid = z.uuid({ error: "id inválido (esperava um UUID)." });
export const zId = z.object({ id: zUuid });

/** Instante na entrada: ISO 8601 COM fuso ("2026-10-26T14:00:00-03:00" ou "...Z"). Sem fuso é recusado (evita hora trocada). */
export const zInstante = z.iso.datetime({ offset: true, error: "Data e hora em ISO 8601 com fuso (ex.: 2026-10-26T14:00:00-03:00)." }).transform((s) => new Date(s));
/** Dia (no fuso da Casa) ou instante. Dia vira 00:00 de Salvador; `fimDoDia` no `ate` vira o fim daquele dia. */
export const zDiaOuInstante = z.union([z.iso.date(), z.iso.datetime({ offset: true })], { error: "Use um dia (2026-10-26) ou data e hora com fuso (2026-10-26T14:00:00-03:00)." });
export const inicioDe = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00-03:00`) : new Date(s));
export const fimDe = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(new Date(`${s}T00:00:00-03:00`).getTime() + 86_400_000) : new Date(s));

/** Instante na saída (documentação): sempre com -03:00. */
export const zInstanteSaida = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/).meta({ format: "date-time", description: "ISO 8601 no fuso da Casa (-03:00)." });

export const LIMITE_MAX = 200;
export const zPaginacao = {
  limite: z.coerce.number().int().min(1).max(LIMITE_MAX).default(50).meta({ description: `Quantos itens por página (1 a ${LIMITE_MAX}; padrão 50).` }),
  cursor: z.string().max(300).optional().meta({ description: "O `proximo_cursor` da página anterior." }),
};

/** Cursor opaco (base64url de [instante ISO, id]): pagina por (data, id) sem pular nem repetir quando chega coisa nova. */
export function fazerCursor(em: Date, id: string): string {
  return Buffer.from(JSON.stringify([em.toISOString(), id])).toString("base64url");
}
export function lerCursor(c: string | undefined): { em: Date; id: string } | null {
  if (!c) return null;
  try {
    const [em, id] = JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as [string, string];
    const d = new Date(em);
    if (Number.isNaN(d.getTime()) || !zUuid.safeParse(id).success) throw new Error();
    return { em: d, id };
  } catch { throw new ApiErro(400, "cursor inválido: use o proximo_cursor da página anterior."); }
}
/** Corta a página (a consulta busca `limite + 1`) e monta o próximo cursor pelo último item. */
export function pagina<T>(rows: T[], limite: number, chave: (r: T) => { em: Date; id: string }): { dados: T[]; proximo_cursor: string | null } {
  const dados = rows.slice(0, limite);
  const ultimo = dados.at(-1);
  return { dados, proximo_cursor: rows.length > limite && ultimo ? fazerCursor(chave(ultimo).em, chave(ultimo).id) : null };
}

export const zErro = z.object({ erro: z.string() });
export const zLista = <T extends z.ZodType>(item: T) => z.object({ dados: z.array(item), proximo_cursor: z.string().nullable() });
export const zUm = <T extends z.ZodType>(item: T) => z.object({ dados: item });
