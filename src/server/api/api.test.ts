import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { apiKeys, auditLog, deals, users } from "@/server/db/schema";
import { recordInbound } from "@/server/domain/deals";
import { OUT_OF_SCOPE, setStrictScope } from "@/server/domain/deal-scope";
import { PERMS } from "@/lib/permissions";
import proxy from "@/proxy";
import { resetDb } from "../../../test/db";
import { chamar, chaveDe, pessoa } from "../../../test/api-fixtures";
import { autenticarChave, criarChave, hashChave, listarChaves, revogarChave, TEXTO_CHAVE_INVALIDA, TEXTO_CHAVE_REVOGADA, TEXTO_CHAVE_VENCIDA, TEXTO_SEM_CHAVE, TEXTO_SO_GESTAO_OUTRA, TEXTO_USUARIO_INATIVO } from "./chaves";
import { __zerarLimites, LIMITE_GERAL, LIMITE_IP_SEM_CHAVE } from "./limite";
import { isoBahia, TEXTO_USE_HTTPS, textoSemEscopo } from "./rota";
import { API_MAX_BYTES, JSON_MAX_BYTES } from "./corpo";
import { novaConversa } from "./rotas/conversas";
import { documentoOpenApi, montarOpenApi } from "./openapi";
import { ROTAS } from "./rotas";
import { eu } from "./rotas/eu";
import { alterarConversa, listarConversas, verConversa } from "./rotas/conversas";
import { GET as OPENAPI } from "@/app/api/v1/openapi.json/route";

beforeEach(async () => { await resetDb(); __zerarLimites(); });

const lead = async (phone: string) => {
  const r = await recordInbound({ channelId: null, externalId: `L-${phone}-${Math.random()}`, phoneRaw: phone, pushName: "Cliente Teste", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  // Sem dona (o rodízio pode ter dado a conversa para alguém da equipe de teste): cada teste diz de quem ela é.
  await db.update(deals).set({ ownerId: null }).where(eq(deals.id, r.dealId));
  return r.dealId;
};

describe("chaves", () => {
  it("guarda só o hash e o prefixo; a chave aparece uma vez, no formato cf_ + 43", async () => {
    const u = await pessoa("gestao");
    const r = await criarChave({ nome: "Planilha", userId: u.id, escopos: ["ler"] }, u.id);
    expect(r.chave).toMatch(/^cf_[A-Za-z0-9_-]{43}$/);
    expect(r.prefixo).toBe(r.chave.slice(0, 8));
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, r.id));
    expect(row.keyHash).toBe(hashChave(r.chave));
    expect(JSON.stringify(row)).not.toContain(r.chave);
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.entity, "api"), eq(auditLog.action, "criou_chave")));
    expect(JSON.stringify(audit.data)).not.toContain(r.chave);
    expect((await listarChaves())[0]).toMatchObject({ id: r.id, nome: "Planilha", prefixo: r.prefixo, escopos: ["ler"], userName: "Pessoa Teste" });
  });

  it("recusa nome vazio, sem escopo, validade no passado e pessoa desativada", async () => {
    const u = await pessoa("gestao");
    await expect(criarChave({ nome: " ", userId: u.id, escopos: ["ler"] }, u.id)).rejects.toThrow(/nome/);
    await expect(criarChave({ nome: "x", userId: u.id, escopos: [] }, u.id)).rejects.toThrow(/escopo/);
    await expect(criarChave({ nome: "x", userId: u.id, escopos: ["ler"], expiraEm: new Date(Date.now() - 1000) }, u.id)).rejects.toThrow(/futuro/);
    await db.update(users).set({ active: false }).where(eq(users.id, u.id));
    await expect(criarChave({ nome: "x", userId: u.id, escopos: ["ler"] }, u.id)).rejects.toThrow(/desativada/);
  });

  it("revogar é idempotente e fica na auditoria", async () => {
    const u = await pessoa("gestao");
    const r = await criarChave({ nome: "x", userId: u.id, escopos: ["ler"] }, u.id);
    expect(await revogarChave(r.id, u.id)).toEqual({ revogada: true });
    expect(await revogarChave(r.id, u.id)).toEqual({ revogada: false });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "revogou_chave"))).toHaveLength(1);
  });

  it("em nome de outra pessoa: só a Gestão, sem mexer em quem é da Gestão por fora, e sem dar permissão que quem cria não tem", async () => {
    const gestora = await pessoa("gestao", "Gestora");
    const ana = await pessoa("atendente", "Ana");
    const bia = await pessoa("atendente", "Bia");
    // Quem cria para si mesma: sempre (a action já exigiu api.gerir).
    await expect(criarChave({ nome: "minha", userId: ana.id, escopos: ["ler"] }, ana.id)).resolves.toMatchObject({ prefixo: expect.any(String) });
    // Quem não é da Gestão não cria em nome de outra pessoa.
    await expect(criarChave({ nome: "x", userId: bia.id, escopos: ["ler"] }, ana.id)).rejects.toThrow(TEXTO_SO_GESTAO_OUTRA);
    await expect(criarChave({ nome: "x", userId: gestora.id, escopos: ["ler"] }, ana.id)).rejects.toThrow(TEXTO_SO_GESTAO_OUTRA);
    // A Gestão cria para a atendente (o "receber no rodízio" não é coisa que a chave faça e não conta).
    await expect(criarChave({ nome: "da Ana", userId: ana.id, escopos: ["ler"] }, gestora.id)).resolves.toBeTruthy();
    // A pessoa tem uma permissão que a gestora não tem (mensagem em massa é opcional na Gestão): recusa, dizendo qual.
    const massa = await pessoa(["atendimento.ver", "mensagem.massa"], "Carla");
    await expect(criarChave({ nome: "x", userId: massa.id, escopos: ["ler"] }, gestora.id)).rejects.toThrow(/Mandar mensagem em massa/);
    // Pelo terminal do servidor (sem autor) escolhe qualquer pessoa.
    await expect(criarChave({ nome: "terminal", userId: massa.id, escopos: ["ler"] }, null)).resolves.toBeTruthy();
    expect(await db.select().from(apiKeys)).toHaveLength(3);
  });

  it("último uso gravado no máximo uma vez por minuto", async () => {
    const u = await pessoa("gestao");
    const k = await chaveDe(u.id);
    const t0 = new Date("2026-10-26T13:00:00Z");
    await autenticarChave(`Bearer ${k}`, t0);
    await autenticarChave(`Bearer ${k}`, new Date(t0.getTime() + 30_000));
    expect((await db.select().from(apiKeys))[0].lastUsedAt).toEqual(t0);
    const t2 = new Date(t0.getTime() + 61_000);
    await autenticarChave(`Bearer ${k}`, t2);
    expect((await db.select().from(apiKeys))[0].lastUsedAt).toEqual(t2);
  });
});

describe("autenticação (401)", () => {
  it("sem chave, chave errada, revogada, vencida e pessoa desativada", async () => {
    const u = await pessoa("gestao");
    const sem = await chamar(eu);
    expect(sem).toMatchObject({ status: 401, json: { erro: TEXTO_SEM_CHAVE } });
    expect(sem.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect((await chamar(eu, { chave: "cf_" + "x".repeat(43) })).json).toEqual({ erro: TEXTO_CHAVE_INVALIDA });
    expect((await chamar(eu, { chave: "qualquer" })).json).toEqual({ erro: TEXTO_CHAVE_INVALIDA });

    const r = await criarChave({ nome: "x", userId: u.id, escopos: ["ler"] }, u.id);
    expect((await chamar(eu, { chave: r.chave })).status).toBe(200);
    await revogarChave(r.id, u.id);
    expect(await chamar(eu, { chave: r.chave })).toMatchObject({ status: 401, json: { erro: TEXTO_CHAVE_REVOGADA } });

    const vence = await chaveDe(u.id, ["ler"], { expiraEm: new Date(Date.now() + 60_000) });
    await db.update(apiKeys).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(apiKeys.keyHash, hashChave(vence)));
    expect(await chamar(eu, { chave: vence })).toMatchObject({ status: 401, json: { erro: TEXTO_CHAVE_VENCIDA } });

    const k = await chaveDe(u.id);
    await db.update(users).set({ active: false }).where(eq(users.id, u.id));
    expect(await chamar(eu, { chave: k })).toMatchObject({ status: 401, json: { erro: TEXTO_USUARIO_INATIVO } });
  });

  it("GET /eu: a pessoa, os escopos e as permissões do perfil (lidas a cada pedido)", async () => {
    const u = await pessoa(["atendimento.ver", "contatos.ver"], "Ana Teste");
    const k = await chaveDe(u.id, ["ler", "escrever"]);
    const r = await chamar(eu, { chave: k });
    expect(r.status).toBe(200);
    expect(r.json.dados).toMatchObject({ usuario: { id: u.id, nome: "Ana Teste" }, chave: { escopos: ["ler", "escrever"] }, permissoes: ["atendimento.ver", "contatos.ver"] });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("escopo da chave e permissão do perfil (403)", () => {
  it("GET exige 'ler'; escrever exige 'escrever'", async () => {
    const u = await pessoa("gestao");
    const id = await lead("71999990001");
    const soEscrever = await chaveDe(u.id, ["escrever"]);
    expect(await chamar(listarConversas, { chave: soEscrever })).toMatchObject({ status: 403, json: { erro: textoSemEscopo("ler") } });
    const soLer = await chaveDe(u.id, ["ler"]);
    expect(await chamar(alterarConversa, { chave: soLer, params: { id }, body: { status: "aguardando" } })).toMatchObject({ status: 403, json: { erro: textoSemEscopo("escrever") } });
    expect((await chamar(listarConversas, { chave: soLer })).status).toBe(200);
  });

  it("falta a permissão no perfil da pessoa: 403 com o nome da permissão", async () => {
    const u = await pessoa(["relatorios.ver"]);
    const k = await chaveDe(u.id);
    const r = await chamar(listarConversas, { chave: k });
    expect(r.status).toBe(403);
    expect(r.json.erro).toMatch(/atendimento\.ver/);
  });

  it("conversa de outra pessoa com 'só as próprias' ligada: 403 no GET e na escrita; sem dona e a própria passam", async () => {
    const gestao = await pessoa("gestao");
    await setStrictScope(true, gestao.id);
    const ana = await pessoa("atendente", "Ana");
    const bia = await pessoa("atendente", "Bia");
    const k = await chaveDe(ana.id);
    const daBia = await lead("71999990002");
    await db.update(deals).set({ ownerId: bia.id }).where(eq(deals.id, daBia));
    expect(await chamar(verConversa, { chave: k, params: { id: daBia } })).toMatchObject({ status: 403, json: { erro: OUT_OF_SCOPE } });
    expect(await chamar(alterarConversa, { chave: k, params: { id: daBia }, body: { status: "aguardando" } })).toMatchObject({ status: 403, json: { erro: OUT_OF_SCOPE } });
    const semDona = await lead("71999990003");
    expect((await chamar(verConversa, { chave: k, params: { id: semDona } })).status).toBe(200);
    // A lista (como a Fila) sem "Ver conversas de todas": só as dela e as sem dona.
    const lista = await chamar(listarConversas, { chave: k });
    expect((lista.json.dados as { id: string }[]).map((c) => c.id)).toEqual([semDona]);
    // A gestão vê todas.
    const kg = await chaveDe(gestao.id);
    expect((await chamar(verConversa, { chave: kg, params: { id: daBia } })).status).toBe(200);
  });

  it("entrada inválida: 400 com o campo; id que não existe: 404", async () => {
    const u = await pessoa("gestao");
    const k = await chaveDe(u.id);
    const r = await chamar(verConversa, { chave: k, params: { id: "xyz" } });
    expect(r.status).toBe(400);
    expect(r.json.erro).toMatch(/^id: /);
    expect((await chamar(listarConversas, { chave: k, query: { limite: "500" } })).json.erro).toMatch(/^limite: /);
    expect((await chamar(listarConversas, { chave: k, query: { cursor: "lixo" } })).json.erro).toMatch(/cursor/);
    expect((await chamar(verConversa, { chave: k, params: { id: "00000000-0000-4000-8000-000000000000" } })).status).toBe(404);
    expect((await chamar(alterarConversa, { chave: k, params: { id: "00000000-0000-4000-8000-000000000000" }, body: {} })).json.erro).toMatch(/pelo menos um campo/);
  });
});

describe("limite de uso (429)", () => {
  it(`${LIMITE_GERAL} pedidos por minuto por chave; o 121º recebe 429 com Retry-After; outra chave não é afetada`, async () => {
    const u = await pessoa("gestao");
    const k = await chaveDe(u.id);
    for (let i = 0; i < LIMITE_GERAL; i++) expect((await chamar(eu, { chave: k })).status).toBe(200);
    const r = await chamar(eu, { chave: k });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(r.json.erro).toMatch(/Muitos pedidos/);
    expect((await chamar(eu, { chave: await chaveDe(u.id) })).status).toBe(200);
  });
});

describe("transporte e endereço", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("pedido com chave que chegou ao Caddy sem https (x-forwarded-proto) é recusado, dizendo para usar https", async () => {
    const u = await pessoa("gestao");
    const k = await chaveDe(u.id);
    const r = await chamar(eu, { chave: k, headers: { "x-forwarded-proto": "http" } });
    expect(r).toMatchObject({ status: 403, json: { erro: TEXTO_USE_HTTPS } });
    expect(r.json.erro).toMatch(/https/);
    expect((await chamar(eu, { chave: k, headers: { "x-forwarded-proto": "https" } })).status).toBe(200);
    // Sem o cabeçalho (sem o Caddy na frente, como no dev): segue.
    expect((await chamar(eu, { chave: k })).status).toBe(200);
  });

  it("no endereço só da cliente (CLIENT_LINK_URL) a API não existe: 404", async () => {
    vi.stubEnv("APP_URL", "https://crm.casa.test");
    vi.stubEnv("CLIENT_LINK_URL", "https://agenda.casa.test");
    const u = await pessoa("gestao");
    const k = await chaveDe(u.id);
    const r = await chamar(eu, { chave: k, headers: { host: "agenda.casa.test" } });
    expect(r.status).toBe(404);
    expect((await chamar(eu, { chave: k, headers: { host: "crm.casa.test" } })).status).toBe(200);
  });
});

describe("limite por IP sem chave válida (429)", () => {
  it(`${LIMITE_IP_SEM_CHAVE} pedidos por minuto por IP sem chave ou com chave inválida; outro IP e chave válida do mesmo IP seguem`, async () => {
    const u = await pessoa("gestao");
    const k = await chaveDe(u.id);
    // O IP é o que o Caddy acrescentou (o último do x-forwarded-for, TRUSTED_PROXY_HOPS=1); o que vem antes é forjável.
    const de = (ip: string, forjado = "1.1.1.1") => ({ "x-forwarded-for": `${forjado}, ${ip}` });
    for (let i = 0; i < LIMITE_IP_SEM_CHAVE; i++) {
      const r = await chamar(eu, { chave: i % 2 ? "cf_" + "x".repeat(43) : null, headers: de("200.1.1.1", `9.9.9.${i}`) });
      expect(r.status).toBe(401);
    }
    const r = await chamar(eu, { headers: de("200.1.1.1") });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(r.json.erro).toMatch(/Muitos pedidos sem chave válida/);
    expect((await chamar(eu, { headers: de("200.1.1.2") })).status).toBe(401);
    expect((await chamar(eu, { chave: k, headers: de("200.1.1.1") })).status).toBe(200);
  });
});

describe("auditoria", () => {
  it("toda escrita autenticada vai para o audit_log (entity api, id da chave, rota, status e alvo); leitura não", async () => {
    const u = await pessoa("gestao");
    const r = await criarChave({ nome: "x", userId: u.id, escopos: ["ler", "escrever"] }, u.id);
    const id = await lead("71999990004");
    await chamar(listarConversas, { chave: r.chave });
    await chamar(alterarConversa, { chave: r.chave, params: { id }, body: { status: "aguardando" } });
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.entity, "api"), eq(auditLog.entityId, r.id)));
    const escritas = rows.filter((x) => x.action !== "criou_chave");
    expect(escritas).toHaveLength(1);
    expect(escritas[0]).toMatchObject({ userId: u.id, action: "PATCH /conversas/{id}", data: { rota: `/api/v1/conversas/${id}`, metodo: "PATCH", status: 200, alvo: id, chave: r.prefixo, criada_por: u.id } });
  });

  it("a escrita grava também quem criou a chave (a gestora que criou para a atendente)", async () => {
    const gestora = await pessoa("gestao", "Gestora");
    const ana = await pessoa("atendente", "Ana");
    const r = await criarChave({ nome: "da Ana", userId: ana.id, escopos: ["ler", "escrever"] }, gestora.id);
    const id = await lead("71999990005");
    await chamar(alterarConversa, { chave: r.chave, params: { id }, body: { status: "aguardando" } });
    const [row] = await db.select().from(auditLog).where(and(eq(auditLog.entity, "api"), eq(auditLog.action, "PATCH /conversas/{id}")));
    expect(row).toMatchObject({ userId: ana.id, entityId: r.id, data: { criada_por: gestora.id } });
  });
});

describe("datas", () => {
  it("saem sempre com o fuso da Casa", () => {
    expect(isoBahia(new Date("2026-10-26T17:05:09.123Z"))).toBe("2026-10-26T14:05:09-03:00");
  });
});

describe("OpenAPI e registro", () => {
  it("GET /api/v1/openapi.json: 3.1, com todas as rotas do registro, escopo e permissão", async () => {
    const res = OPENAPI(new Request("http://localhost/api/v1/openapi.json"));
    expect(res.status).toBe(200);
    const doc = await res.json() as { openapi: string; paths: Record<string, Record<string, { "x-escopo": string; operationId: string; responses: Record<string, unknown> }>>; components: { securitySchemes: unknown } };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.securitySchemes).toBeTruthy();
    for (const r of ROTAS) {
      const op = doc.paths[`/api/v1${r.caminho}`]?.[r.metodo.toLowerCase()];
      expect(op, `${r.metodo} ${r.caminho}`).toBeTruthy();
      expect(op["x-escopo"]).toBe(r.escopo);
      expect(op.responses[String(r.status ?? 200)]).toBeTruthy();
    }
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    expect(new Set(ops).size).toBe(ops.length);
    expect(JSON.parse(JSON.stringify(montarOpenApi(ROTAS)))).toBeTruthy();
  });

  it("o openapi.json é montado uma vez e guardado (e não usa o Host de quem pede)", async () => {
    expect(documentoOpenApi()).toBe(documentoOpenApi());
    const a = await OPENAPI(new Request("http://evil.example/api/v1/openapi.json")).text();
    const b = await OPENAPI(new Request("http://localhost/api/v1/openapi.json")).text();
    expect(a).toBe(b);
    expect(a).not.toContain("evil.example");
  });

  it("cada rota do registro: método+caminho únicos, permissão conhecida (ou motivo), descrição em PT-BR", () => {
    const vistos = new Set<string>();
    for (const r of ROTAS) {
      const k = `${r.metodo} ${r.caminho}`;
      expect(vistos.has(k), k).toBe(false);
      vistos.add(k);
      if (r.perm === null) expect(r.semPerm, k).toBeTruthy();
      else for (const p of typeof r.perm === "string" ? [r.perm] : r.perm) expect(PERMS, k).toContain(p);
      expect(r.metodo === "GET" ? r.escopo === "ler" : r.escopo !== "ler", `${k}: GET é "ler" e escrita não é`).toBe(true);
      expect(r.resumo.length).toBeGreaterThan(3);
    }
  });

  it("todo route.ts de src/app/api/v1 exporta o handler de uma rota do registro, e toda rota do registro tem o seu route.ts", async () => {
    const base = path.resolve(__dirname, "../../app/api/v1");
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const files = walk(base).filter((f) => f.endsWith("route.ts") && !f.includes("openapi.json"));
    const achadas = new Set<string>();
    for (const f of files) {
      const caminho = "/" + path.relative(base, path.dirname(f)).split(path.sep).map((s) => s.replace(/^\[(\w+)\]$/, "{$1}")).join("/");
      const mod = await import(f) as Record<string, unknown>;
      for (const m of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
        if (!mod[m]) continue;
        const rota = ROTAS.find((r) => r.metodo === m && r.caminho === caminho);
        expect(rota, `${m} ${caminho} (${f}) fora do registro`).toBeTruthy();
        expect(mod[m], `${m} ${caminho}: route.ts não exporta o handler do registro`).toBe(rota!.handler);
        achadas.add(`${m} ${caminho}`);
      }
    }
    expect(ROTAS.map((r) => `${r.metodo} ${r.caminho}`).filter((k) => !achadas.has(k))).toEqual([]);
  });

  it("o proxy recusa corpo grande (413) e POST/PATCH sem Content-Length (411) em /api/v1; o 413 das Server Actions continua", async () => {
    const pedido = (caminho: string, method: string, headers: Record<string, string> = {}) => proxy(new NextRequest(`http://localhost${caminho}`, { method, headers }));
    const grande = pedido("/api/v1/conversas/x/mensagens", "POST", { "content-length": String(API_MAX_BYTES + 1), "content-type": "multipart/form-data; boundary=x" });
    expect(grande.status).toBe(413);
    expect(await grande.json()).toEqual({ erro: expect.stringMatching(/17 MB/) });
    const semTamanho = pedido("/api/v1/conversas", "POST", { "content-type": "application/json" });
    expect(semTamanho.status).toBe(411);
    expect(await semTamanho.json()).toEqual({ erro: expect.stringMatching(/Content-Length/) });
    expect(pedido("/api/v1/conversas/x", "PATCH", { "transfer-encoding": "chunked" }).status).toBe(411);
    // Dentro do limite, e GET sem corpo: passam.
    expect(pedido("/api/v1/conversas", "POST", { "content-length": "40" }).headers.get("x-middleware-next")).toBe("1");
    expect(pedido("/api/v1/eu", "GET").headers.get("x-middleware-next")).toBe("1");
    // Server Action fora de Respostas prontas e Biblioteca: o 413 de antes (20 MB).
    expect(pedido("/conversas", "POST", { "next-action": "abc", "content-length": String(21 * 1024 * 1024), cookie: "cf_session=x" }).status).toBe(413);
  });

  it(`corpo JSON da API: até ${JSON_MAX_BYTES / 1024} KB, pelo tamanho declarado (antes de ler) e pelos bytes lidos`, async () => {
    const u = await pessoa("gestao");
    const k = await chaveDe(u.id);
    const nome = "x".repeat(JSON_MAX_BYTES);
    // Sem Content-Length (chamada direta, sem o proxy): conta os bytes lidos.
    const lido = await chamar(novaConversa, { chave: k, body: { telefone: "71999990009", nome } });
    expect(lido.status).toBe(413);
    expect(lido.json.erro).toMatch(/64 KB/);
    // Declarado grande: recusa antes de ler.
    const declarado = await chamar(novaConversa, { chave: k, body: { telefone: "71999990009" }, headers: { "content-length": String(JSON_MAX_BYTES + 1) } });
    expect(declarado.status).toBe(413);
    expect((await chamar(novaConversa, { chave: k, body: { telefone: "71999990009" } })).status).toBe(201);
  });

  it("o proxy deixa /api/v1 passar sem cookie (a trava é a chave)", () => {
    const r = proxy(new NextRequest("http://localhost/api/v1/eu"));
    expect(r.headers.get("location")).toBeNull();
    expect(proxy(new NextRequest("http://localhost/api/v2/eu")).headers.get("location")).toMatch(/\/login/);
  });
});
