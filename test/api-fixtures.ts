import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/server/db";
import { profiles, users } from "@/server/db/schema";
import { criarChave, type Escopo } from "@/server/api/chaves";
import type { RotaApi } from "@/server/api/rota";

/** Pessoa da equipe com um perfil de sistema ("gestao", "atendente"…) ou com uma lista de permissões (perfil próprio). */
export async function pessoa(perfil: string[] | "gestao" | "atendente" | "recepcao", nome = "Pessoa Teste") {
  const [profile] = typeof perfil === "string"
    ? await db.select().from(profiles).where(eq(profiles.key, perfil))
    : await db.insert(profiles).values({ name: `Teste ${Math.random()}`, permissions: perfil }).returning();
  const [u] = await db.insert(users).values({ name: nome, email: `${Math.random()}@teste.com`, passwordHash: "x", profileId: profile.id }).returning();
  return u;
}

/** Chave da API para a pessoa (todos os escopos, se não disser). Devolve o segredo. */
export async function chaveDe(userId: string, escopos: Escopo[] = ["ler", "escrever", "enviar"], extra: { expiraEm?: Date } = {}) {
  return (await criarChave({ nome: "Teste", userId, escopos, expiraEm: extra.expiraEm ?? null }, userId)).chave;
}

type Opcoes = { chave?: string | null; params?: Record<string, string>; query?: Record<string, string>; body?: unknown; form?: FormData; headers?: Record<string, string> };

/**
 * Chama o route handler exportado com `new Request(...)`, como o Next faria. Toda resposta de sucesso é conferida contra o schema de
 * saída declarado na rota (o mesmo do OpenAPI): a documentação não pode mentir.
 */
export async function chamar(rota: RotaApi, o: Opcoes = {}) {
  const caminho = rota.caminho.replace(/\{(\w+)\}/g, (_, k: string) => o.params?.[k] ?? `{${k}}`);
  const url = new URL(`http://localhost/api/v1${caminho}`);
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { ...(o.chave ? { authorization: `Bearer ${o.chave}` } : {}), ...o.headers };
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) { body = JSON.stringify(o.body); headers["content-type"] = "application/json"; }
  const req = new Request(url, { method: rota.metodo, headers, body });
  const res = await rota.handler(req, { params: Promise.resolve(o.params ?? {}) });
  const json = await res.json() as { dados?: unknown; erro?: string; proximo_cursor?: string | null } & Record<string, unknown>;
  if (res.status < 300) {
    const r = rota.resposta.safeParse(json);
    expect(r.success, `resposta de ${rota.metodo} ${rota.caminho} fora do schema: ${r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3))}`).toBe(true);
  } else {
    expect(Object.keys(json)).toEqual(["erro"]);
  }
  return { status: res.status, json, headers: res.headers };
}
