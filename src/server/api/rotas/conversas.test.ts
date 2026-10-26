import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog, channels, contactNotes, deals, messages, outbox, settings, stages, users } from "@/server/db/schema";
import { setStrictScope } from "@/server/domain/deal-scope";
import { recordInbound } from "@/server/domain/deals";
import { setWhatsappProvider } from "@/server/whatsapp/evolution";
import { ProviderError } from "@/server/whatsapp/provider";
import { resetDb } from "../../../../test/db";
import { chamar, chaveDe, pessoa } from "../../../../test/api-fixtures";
import { __zerarLimites, contarTodos, LIMITE_ENVIOS, LIMITE_ENVIOS_GLOBAL_DIA, LIMITE_ENVIOS_GLOBAL_MIN, LIMITE_ENVIOS_PESSOA } from "../limite";
import { textoSemEscopo } from "../rota";
import { TEXTO_CONVERSA_DE_OUTRA, TEXTO_FORA_DA_JANELA, TEXTO_WHATSAPP_RECUSOU } from "./conversas";
import { OUT_OF_SCOPE } from "@/server/domain/deal-scope";
import { alterarConversa, enviarMensagem, listarConversas, listarMensagens, novaConversa, novaNota, verConversa } from "./conversas";

const enviados: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _t: string, text: string) => { enviados.push(`text:${text}`); return { externalId: `OUT-${enviados.length}` }; },
  sendMedia: async (_i: string, _t: string, f: { mime: string }) => { enviados.push(`media:${f.mime}`); return { externalId: `OUT-${enviados.length}` }; },
  sendAudio: async () => { enviados.push("audio"); return { externalId: `OUT-${enviados.length}` }; },
  markRead: async () => {},
};

let canal = "";
beforeEach(async () => {
  await resetDb(); __zerarLimites(); enviados.length = 0;
  [{ id: canal }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
  setWhatsappProvider(fake);
});
afterEach(() => setWhatsappProvider(null));

const lead = async (phone: string, body = "oi", name = "Cliente Teste") => {
  const r = await recordInbound({ channelId: canal, externalId: `L-${phone}-${Math.random()}`, phoneRaw: phone, pushName: name, body });
  if (!("dealId" in r)) throw new Error("sem lead");
  // Sem dona (o rodízio pode ter dado a conversa para alguém da equipe de teste): cada teste diz de quem ela é.
  await db.update(deals).set({ ownerId: null }).where(eq(deals.id, r.dealId));
  return r.dealId;
};
const ids = (j: { dados?: unknown }) => (j.dados as { id: string }[]).map((x) => x.id);

describe("GET /conversas", () => {
  it("filtra por etapa, dona, busca e abertas; pagina com cursor sem repetir", async () => {
    const g = await pessoa("gestao", "Gestora");
    const k = await chaveDe(g.id, ["ler"]);
    const a = await lead("71999990011", "oi", "Marina Teste");
    const b = await lead("71999990012", "oi", "Joana Teste");
    const c = await lead("71999990013", "oi", "Paula Teste");
    await db.update(deals).set({ ownerId: g.id }).where(eq(deals.id, b));
    await db.update(deals).set({ conversationArchivedAt: new Date() }).where(eq(deals.id, c));

    expect(ids((await chamar(listarConversas, { chave: k })).json).sort()).toEqual([a, b].sort());
    expect(ids((await chamar(listarConversas, { chave: k, query: { abertas: "false" } })).json)).toHaveLength(3);
    expect(ids((await chamar(listarConversas, { chave: k, query: { dona: "eu" } })).json)).toEqual([b]);
    expect(ids((await chamar(listarConversas, { chave: k, query: { dona: "sem" } })).json)).toEqual([a]);
    expect(ids((await chamar(listarConversas, { chave: k, query: { q: "marina" } })).json)).toEqual([a]);
    expect(ids((await chamar(listarConversas, { chave: k, query: { q: "(71) 99999-0012" } })).json)).toEqual([b]);
    const [st] = await db.select({ key: stages.key }).from(stages).innerJoin(deals, eq(deals.stageId, stages.id)).where(eq(deals.id, a));
    expect(ids((await chamar(listarConversas, { chave: k, query: { etapa: st.key } })).json).sort()).toEqual([a, b].sort());

    const p1 = await chamar(listarConversas, { chave: k, query: { limite: "2", abertas: "false" } });
    expect(ids(p1.json)).toHaveLength(2);
    expect(p1.json.proximo_cursor).toBeTruthy();
    const p2 = await chamar(listarConversas, { chave: k, query: { limite: "2", abertas: "false", cursor: p1.json.proximo_cursor as string } });
    expect(ids(p2.json)).toHaveLength(1);
    expect(p2.json.proximo_cursor).toBeNull();
    expect(new Set([...ids(p1.json), ...ids(p2.json)]).size).toBe(3);
  });

  it("valores só para quem vê dinheiro; telefone em E.164; datas com -03:00", async () => {
    const id = await lead("71999990014");
    await db.update(deals).set({ valueCents: 38000 }).where(eq(deals.id, id));
    const semDinheiro = await chaveDe((await pessoa(["atendimento.ver"])).id);
    const gestao = await chaveDe((await pessoa("gestao")).id);
    const s = (await chamar(verConversa, { chave: semDinheiro, params: { id } })).json.dados as { valor_centavos: number | null; contato: { telefone: string }; criada_em: string };
    const g = (await chamar(verConversa, { chave: gestao, params: { id } })).json.dados as { valor_centavos: number | null };
    expect(s.valor_centavos).toBeNull();
    expect(g.valor_centavos).toBe(38000);
    expect(s.contato.telefone).toBe("+5571999990014");
    expect(s.criada_em).toMatch(/-03:00$/);
  });
});

describe("POST /conversas e PATCH /conversas/{id}", () => {
  it("abre a conversa pelo telefone (sem enviar nada) e acha a mesma na segunda vez", async () => {
    const k = await chaveDe((await pessoa("atendente")).id);
    const r1 = await chamar(novaConversa, { chave: k, body: { telefone: "71 98888-0001", nome: "Nova Cliente" } });
    expect(r1.status).toBe(201);
    expect(r1.json.dados).toMatchObject({ criada: true, contato_novo: true });
    const r2 = await chamar(novaConversa, { chave: k, body: { telefone: "+55 71 98888-0001" } });
    expect(r2.json.dados).toMatchObject({ id: (r1.json.dados as { id: string }).id, criada: false, contato_novo: false });
    expect(enviados).toEqual([]);
  });

  it("muda a etapa pelo moveDeal (recusa as que pedem dados), assume, transfere (com permissão) e resolve", async () => {
    const ana = await pessoa("atendente", "Ana");
    const bia = await pessoa("atendente", "Bia");
    const k = await chaveDe(ana.id, ["ler", "escrever"]);
    const id = await lead("71999990021");
    const [atend] = await db.select({ key: stages.key }).from(stages).where(eq(stages.kind, "atendimento")).limit(1);
    const r = await chamar(alterarConversa, { chave: k, params: { id }, body: { etapa: atend.key } });
    expect(r.status).toBe(200);
    expect((r.json.dados as { etapa: { chave: string } }).etapa.chave).toBe(atend.key);
    const [fechado] = await db.select({ key: stages.key }).from(stages).where(eq(stages.kind, "fechado")).limit(1);
    expect((await chamar(alterarConversa, { chave: k, params: { id }, body: { etapa: fechado.key } })).json.erro).toMatch(/pede dados/);

    const claim = await chamar(alterarConversa, { chave: k, params: { id }, body: { dona_id: ana.id } });
    expect((claim.json.dados as { dona: { id: string } }).dona.id).toBe(ana.id);
    expect((await chamar(alterarConversa, { chave: k, params: { id }, body: { dona_id: bia.id } })).status).toBe(200);

    // Agora é da Bia: a Ana (sem "Ver conversas de todas") não mexe mais.
    expect((await chamar(alterarConversa, { chave: k, params: { id }, body: { status: "aguardando" } })).status).toBe(403);

    // Status do cabeçalho (setConversationStatus): aguardando tira a espera sem mandar nada; aberto volta a esperar a Casa.
    const kb = await chaveDe(bia.id, ["ler", "escrever"]);
    expect((await chamar(alterarConversa, { chave: kb, params: { id }, body: { status: "aguardando" } })).json.dados).toMatchObject({ status: "aguardando", aguardando_resposta_desde: null });
    expect((await chamar(alterarConversa, { chave: kb, params: { id }, body: { status: "aberto" } })).json.dados).toMatchObject({ status: "aberto" });
    // Tudo é conferido antes: transferir sem permissão não deixa a etapa mudada pela metade.
    const semTransferir = await chaveDe((await pessoa(["atendimento.ver", "atendimento.todas"])).id);
    const [lead0] = await db.select({ key: stages.key }).from(stages).where(eq(stages.kind, "lead")).limit(1);
    expect((await chamar(alterarConversa, { chave: semTransferir, params: { id }, body: { etapa: lead0.key, dona_id: ana.id } })).status).toBe(403);
    expect((await chamar(verConversa, { chave: kb, params: { id } })).json.dados).toMatchObject({ etapa: { chave: atend.key } });
  });

  it("resolver: sem a Mensagem ao resolver ligada basta 'escrever'; ligada, exige 'enviar' (e então põe a mensagem na fila)", async () => {
    const u = await pessoa("gestao");
    const soEscrever = await chaveDe(u.id, ["ler", "escrever"]);
    const a = await lead("71999990031");
    const r = await chamar(alterarConversa, { chave: soEscrever, params: { id: a }, body: { status: "resolvido" } });
    expect(r.status).toBe(200);
    expect(r.json.dados).toMatchObject({ status: "resolvido" });
    expect((await chamar(alterarConversa, { chave: soEscrever, params: { id: a }, body: { status: "aberto" } })).json.dados).toMatchObject({ status: "aberto" });

    await db.insert(settings).values({ key: "msg_encerramento", value: { enabled: true, text: "Obrigada, {nome}!" } });
    const b = await lead("71999990032");
    expect(await chamar(alterarConversa, { chave: soEscrever, params: { id: b }, body: { status: "resolvido" } })).toMatchObject({ status: 403, json: { erro: textoSemEscopo("enviar") } });
    const [d] = await db.select({ at: deals.conversationArchivedAt }).from(deals).where(eq(deals.id, b));
    expect(d.at).toBeNull();
    const comEnviar = await chaveDe(u.id, ["escrever", "enviar"]);
    expect((await chamar(alterarConversa, { chave: comEnviar, params: { id: b }, body: { status: "resolvido" } })).status).toBe(200);
    expect(await db.select().from(outbox).where(eq(outbox.dealId, b))).toHaveLength(1);
  });
});

describe("escopo por id (o mesmo filtro da lista)", () => {
  it("sem 'Ver conversas de todas', a conversa de outra pessoa dá 403 no GET, mensagens, notas e PATCH (mesmo com 'só as próprias' desligado)", async () => {
    const ana = await pessoa("atendente", "Ana");
    const bia = await pessoa("atendente", "Bia");
    const k = await chaveDe(ana.id);
    const daBia = await lead("71999990101");
    await db.update(deals).set({ ownerId: bia.id }).where(eq(deals.id, daBia));
    const nega = { status: 403, json: { erro: OUT_OF_SCOPE } };
    expect(await chamar(verConversa, { chave: k, params: { id: daBia } })).toMatchObject(nega);
    expect(await chamar(listarMensagens, { chave: k, params: { id: daBia } })).toMatchObject(nega);
    expect(await chamar(novaNota, { chave: k, params: { id: daBia }, body: { texto: "oi" } })).toMatchObject(nega);
    expect(await chamar(alterarConversa, { chave: k, params: { id: daBia }, body: { status: "aguardando" } })).toMatchObject(nega);
    expect(await chamar(enviarMensagem, { chave: k, params: { id: daBia }, body: { texto: "oi" } })).toMatchObject(nega);
    expect(enviados).toEqual([]);
    const semDona = await lead("71999990102");
    expect((await chamar(verConversa, { chave: k, params: { id: semDona } })).status).toBe(200);
    expect((await chamar(verConversa, { chave: await chaveDe((await pessoa("gestao")).id), params: { id: daBia } })).status).toBe(200);
  });

  it("POST /conversas com o telefone da cliente de outra pessoa: 409 sem o id (a gestão recebe o id)", async () => {
    const ana = await pessoa("atendente", "Ana");
    const bia = await pessoa("atendente", "Bia");
    const daBia = await lead("71999990103", "oi", "Cliente da Bia");
    await db.update(deals).set({ ownerId: bia.id }).where(eq(deals.id, daBia));
    const r = await chamar(novaConversa, { chave: await chaveDe(ana.id), body: { telefone: "71 99999-0103", nome: "Outro Nome" } });
    expect(r).toMatchObject({ status: 409, json: { erro: TEXTO_CONVERSA_DE_OUTRA } });
    expect(JSON.stringify(r.json)).not.toContain(daBia);
    const g = await chamar(novaConversa, { chave: await chaveDe((await pessoa("gestao")).id), body: { telefone: "71 99999-0103" } });
    expect(g.json.dados).toMatchObject({ id: daBia, criada: false });
  });
});

describe("PATCH /conversas/{id}: tudo conferido antes da primeira escrita", () => {
  it("'só as próprias' ligado: transferir a própria responde 200 (não grava e depois dá 403); a de outra pessoa dá 403 sem gravar", async () => {
    const g = await pessoa("gestao");
    await setStrictScope(true, g.id);
    const ana = await pessoa("atendente", "Ana");
    const bia = await pessoa("atendente", "Bia");
    const k = await chaveDe(ana.id, ["ler", "escrever"]);
    const minha = await lead("71999990091");
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, minha));
    const r = await chamar(alterarConversa, { chave: k, params: { id: minha }, body: { dona_id: bia.id } });
    expect(r.status).toBe(200);
    expect(r.json.dados).toMatchObject({ dona: { id: bia.id } });
    const [a] = await db.select({ data: auditLog.data }).from(auditLog).where(and(eq(auditLog.entity, "api"), eq(auditLog.action, "PATCH /conversas/{id}")));
    expect(a.data).toMatchObject({ status: 200, alvo: minha });
    // Agora é da Bia: a Ana não mexe mais (e nada muda).
    expect((await chamar(alterarConversa, { chave: k, params: { id: minha }, body: { dona_id: ana.id } })).status).toBe(403);
    const [d] = await db.select({ ownerId: deals.ownerId }).from(deals).where(eq(deals.id, minha));
    expect(d.ownerId).toBe(bia.id);
  });

  it("transferir para quem não está mais na equipe: recusa antes de mudar a etapa", async () => {
    const g = await pessoa("gestao");
    const saiu = await pessoa("atendente", "Saiu");
    await db.update(users).set({ active: false }).where(eq(users.id, saiu.id));
    const k = await chaveDe(g.id, ["ler", "escrever"]);
    const id = await lead("71999990092");
    const [antes] = await db.select({ stageId: deals.stageId }).from(deals).where(eq(deals.id, id));
    const [atend] = await db.select({ key: stages.key, id: stages.id }).from(stages).where(eq(stages.kind, "atendimento")).limit(1);
    expect(atend.id).not.toBe(antes.stageId);
    const r = await chamar(alterarConversa, { chave: k, params: { id }, body: { etapa: atend.key, dona_id: saiu.id } });
    expect(r.status).toBe(400);
    expect(r.json.erro).toMatch(/não está mais na equipe/);
    const [depois] = await db.select({ stageId: deals.stageId, ownerId: deals.ownerId }).from(deals).where(eq(deals.id, id));
    expect(depois).toEqual({ stageId: antes.stageId, ownerId: null });
  });
});

describe("mensagens", () => {
  it("GET: as do número, mais novas primeiro, sem as apagadas só aqui, com cursor", async () => {
    const k = await chaveDe((await pessoa("atendente")).id, ["ler"]);
    const id = await lead("71999990041", "primeira");
    await recordInbound({ channelId: canal, externalId: "M2", phoneRaw: "71999990041", body: "segunda" });
    await recordInbound({ channelId: canal, externalId: "M3", phoneRaw: "71999990041", body: "escondida" });
    await db.update(messages).set({ hiddenAt: new Date(), deletedAt: new Date() }).where(eq(messages.externalId, "M3"));
    const r = await chamar(listarMensagens, { chave: k, params: { id }, query: { limite: "1" } });
    expect((r.json.dados as { texto: string; direcao: string }[])).toMatchObject([{ texto: "segunda", direcao: "entrada" }]);
    const r2 = await chamar(listarMensagens, { chave: k, params: { id }, query: { limite: "1", cursor: r.json.proximo_cursor as string } });
    expect((r2.json.dados as { texto: string }[])[0].texto).toBe("primeira");
    expect(r2.json.proximo_cursor).toBeNull();
  });

  it("POST texto: vai pela Evolution (fake) assinado, grava como enviada pelo CRM; exige o escopo 'enviar'", async () => {
    const u = await pessoa("atendente", "Ana");
    const id = await lead("71999990051");
    const semEnviar = await chaveDe(u.id, ["ler", "escrever"]);
    expect(await chamar(enviarMensagem, { chave: semEnviar, params: { id }, body: { texto: "Oi!" } })).toMatchObject({ status: 403, json: { erro: textoSemEscopo("enviar") } });
    expect(enviados).toEqual([]);
    const k = await chaveDe(u.id, ["enviar"]);
    const r = await chamar(enviarMensagem, { chave: k, params: { id }, body: { texto: "Oi! Tudo bem?" } });
    expect(r.status).toBe(201);
    expect(r.json.dados).toMatchObject({ direcao: "saida", status: "sent", via: "crm", enviada_por: { id: u.id } });
    expect(enviados).toEqual(["text:*ANA - CASA FIAES:*\nOi! Tudo bem?"]);
    const [d] = await db.select({ w: deals.awaitingReplySince }).from(deals).where(eq(deals.id, id));
    expect(d.w).toBeNull();
    expect((await chamar(enviarMensagem, { chave: k, params: { id }, body: { texto: "" } })).status).toBe(400);
  });

  it("POST multipart: arquivo conferido pelos bytes (PDF passa, HTML disfarçado não); acima de 16 MB recusa", async () => {
    const k = await chaveDe((await pessoa("atendente")).id, ["enviar"]);
    const id = await lead("71999990061");
    const form = new FormData();
    form.set("arquivo", new File([Buffer.from("%PDF-1.7 teste")], "tabela.pdf", { type: "application/pdf" }));
    form.set("legenda", "Nossa tabela");
    const r = await chamar(enviarMensagem, { chave: k, params: { id }, form });
    expect(r.status).toBe(201);
    expect(r.json.dados).toMatchObject({ tipo: "document", midia: { mime: "application/pdf" } });
    expect(enviados).toEqual(["media:application/pdf"]);
    const falso = new FormData();
    falso.set("arquivo", new File([Buffer.from("<html>")], "foto.jpg", { type: "image/jpeg" }));
    const ruim = await chamar(enviarMensagem, { chave: k, params: { id }, form: falso });
    expect(ruim.status).toBe(400);
    expect(ruim.json.erro).toMatch(/tipo de arquivo/);
    const grande = new FormData();
    grande.set("arquivo", new File([Buffer.alloc(16 * 1024 * 1024 + 1)], "grande.pdf", { type: "application/pdf" }));
    expect((await chamar(enviarMensagem, { chave: k, params: { id }, form: grande })).json.erro).toMatch(/16 MB/);
  });

  it(`limite de envios: ${LIMITE_ENVIOS} por minuto por chave; o seguinte recebe 429 com Retry-After e não sai`, async () => {
    const k = await chaveDe((await pessoa("atendente")).id, ["enviar"]);
    const id = await lead("71999990071");
    for (let i = 0; i < LIMITE_ENVIOS; i++) expect((await chamar(enviarMensagem, { chave: k, params: { id }, body: { texto: `m${i}` } })).status).toBe(201);
    const r = await chamar(enviarMensagem, { chave: k, params: { id }, body: { texto: "uma a mais" } });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(enviados).toHaveLength(LIMITE_ENVIOS);
  });
});

describe("erro do provedor do WhatsApp", () => {
  it("a API devolve o texto genérico, nunca o da Evolution (no 502 e no campo erro da lista)", async () => {
    const BRUTO = "Evolution 400: {\"jid\":\"5571999990111@s.whatsapp.net\",\"exists\":false,\"stack\":\"at /evolution/src/api\"}";
    setWhatsappProvider({ ...fake, sendText: async () => { throw new ProviderError(BRUTO, 400); } });
    const k = await chaveDe((await pessoa("atendente")).id, ["ler", "enviar"]);
    const id = await lead("71999990111");
    const r = await chamar(enviarMensagem, { chave: k, params: { id }, body: { texto: "Oi!" } });
    expect(r).toMatchObject({ status: 502, json: { erro: TEXTO_WHATSAPP_RECUSOU } });
    const lista = await chamar(listarMensagens, { chave: k, params: { id } });
    const falhou = (lista.json.dados as { status: string; erro: string | null }[]).find((m) => m.status === "failed");
    expect(falhou?.erro).toBe(TEXTO_WHATSAPP_RECUSOU);
    expect(JSON.stringify(lista.json)).not.toContain("Evolution 400");
  });
});

describe("limites de envio por pessoa e da Casa toda", () => {
  it(`por pessoa: ${LIMITE_ENVIOS_PESSOA} por minuto somando as chaves dela; recusa não gasta o limite`, async () => {
    const ana = await pessoa("atendente", "Ana");
    const k1 = await chaveDe(ana.id, ["enviar"]);
    const k2 = await chaveDe(ana.id, ["enviar"]);
    const id = await lead("71999990072");
    // Pedido recusado antes do envio (texto vazio) não conta.
    for (let i = 0; i < 5; i++) expect((await chamar(enviarMensagem, { chave: k1, params: { id }, body: { texto: "" } })).status).toBe(400);
    for (let i = 0; i < LIMITE_ENVIOS_PESSOA; i++) expect((await chamar(enviarMensagem, { chave: i % 2 ? k1 : k2, params: { id }, body: { texto: `m${i}` } })).status).toBe(201);
    const r = await chamar(enviarMensagem, { chave: await chaveDe(ana.id, ["enviar"]), params: { id }, body: { texto: "uma a mais" } });
    expect(r.status).toBe(429);
    expect(r.json.erro).toMatch(/por pessoa/);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(enviados).toHaveLength(LIMITE_ENVIOS_PESSOA);
  });

  it(`teto da Casa: ${LIMITE_ENVIOS_GLOBAL_MIN} envios pela API por minuto, somando todas as pessoas`, async () => {
    // Responder assume a conversa sem dona: cada uma escreve na sua.
    const id = await lead("71999990073");
    const id2 = await lead("71999990075");
    const ka = await chaveDe((await pessoa("atendente", "Ana")).id, ["enviar"]);
    const kb = await chaveDe((await pessoa("atendente", "Bia")).id, ["enviar"]);
    for (let i = 0; i < LIMITE_ENVIOS_PESSOA; i++) expect((await chamar(enviarMensagem, { chave: ka, params: { id }, body: { texto: `a${i}` } })).status).toBe(201);
    for (let i = 0; i < LIMITE_ENVIOS_GLOBAL_MIN - LIMITE_ENVIOS_PESSOA; i++) expect((await chamar(enviarMensagem, { chave: kb, params: { id: id2 }, body: { texto: `b${i}` } })).status).toBe(201);
    const r = await chamar(enviarMensagem, { chave: kb, params: { id: id2 }, body: { texto: "uma a mais" } });
    expect(r.status).toBe(429);
    expect(r.json.erro).toMatch(/da Casa/);
    expect(enviados).toHaveLength(LIMITE_ENVIOS_GLOBAL_MIN);
  });

  it(`teto da Casa por dia: ${LIMITE_ENVIOS_GLOBAL_DIA}; regra que não cabe não gasta as outras`, () => {
    const t0 = Date.UTC(2026, 9, 26, 12);
    const regras = (now: number) => [{ chave: "x:min", max: LIMITE_ENVIOS_GLOBAL_MIN, janela: 60_000, now }, { chave: "x:dia", max: LIMITE_ENVIOS_GLOBAL_DIA, janela: 86_400_000, now }];
    // Um por minuto ao longo do dia: o 501º do dia é recusado mesmo com o minuto livre.
    for (let i = 0; i < LIMITE_ENVIOS_GLOBAL_DIA; i++) expect(contarTodos(regras(t0 + i * 61_000)).ok).toBe(true);
    const r = contarTodos(regras(t0 + LIMITE_ENVIOS_GLOBAL_DIA * 61_000));
    expect(r).toMatchObject({ ok: false, regra: "x:dia" });
    // A regra do minuto não foi gasta pela tentativa recusada; 24 h depois do primeiro, volta a caber.
    expect(contarTodos(regras(t0 + 86_400_000 + 1)).ok).toBe(true);
  });
});

describe("conversa sem mensagem da cliente nas últimas 24 h", () => {
  it("pede a permissão de mensagem em massa (texto e arquivo); com ela, sai; nunca escreveu também conta", async () => {
    const ana = await pessoa("atendente", "Ana");
    const k = await chaveDe(ana.id, ["escrever", "enviar"]);
    const id = await lead("71999990074");
    await db.update(messages).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(messages.dealId, id));
    expect(await chamar(enviarMensagem, { chave: k, params: { id }, body: { texto: "Oi, sumida!" } })).toMatchObject({ status: 403, json: { erro: TEXTO_FORA_DA_JANELA } });
    const form = new FormData();
    form.set("arquivo", new File([Buffer.from("%PDF-1.7 teste")], "tabela.pdf", { type: "application/pdf" }));
    expect(await chamar(enviarMensagem, { chave: k, params: { id }, form })).toMatchObject({ status: 403, json: { erro: TEXTO_FORA_DA_JANELA } });
    // Nunca escreveu: a conversa aberta pela API para um número novo.
    const nova = await chamar(novaConversa, { chave: k, body: { telefone: "71 98888-0074" } });
    expect((await chamar(enviarMensagem, { chave: k, params: { id: (nova.json.dados as { id: string }).id }, body: { texto: "Olá!" } })).status).toBe(403);
    expect(enviados).toEqual([]);
    // Com a permissão de mensagem em massa, sai (outra cliente sumida, para a de cima continuar sem dona).
    const sumida = await lead("71999990076");
    await db.update(messages).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(messages.dealId, sumida));
    const massa = await chaveDe((await pessoa(["atendimento.ver", "mensagem.massa"], "Gestora")).id, ["enviar"]);
    expect((await chamar(enviarMensagem, { chave: massa, params: { id: sumida }, body: { texto: "Oi, sumida!" } })).status).toBe(201);
    expect(enviados).toHaveLength(1);
    // Escreveu agora: volta a valer só o escopo 'enviar'.
    await recordInbound({ channelId: canal, externalId: "J-74", phoneRaw: "71999990074", body: "oi de novo" });
    expect((await chamar(enviarMensagem, { chave: k, params: { id }, body: { texto: "Oi!" } })).status).toBe(201);
  });
});

describe("POST /conversas/{id}/notas", () => {
  it("grava a nota interna (não vai para a cliente) e avisa quem foi mencionada", async () => {
    const ana = await pessoa("atendente", "Ana");
    const bia = await pessoa("atendente", "Bia");
    const k = await chaveDe(ana.id, ["escrever"]);
    const id = await lead("71999990081");
    const r = await chamar(novaNota, { chave: k, params: { id }, body: { texto: "Pode conferir o Pix?", mencoes: [bia.id] } });
    expect(r.status).toBe(201);
    expect(r.json.dados).toMatchObject({ avisadas: 1 });
    const [n] = await db.select().from(contactNotes).where(and(eq(contactNotes.dealId, id)));
    expect(n).toMatchObject({ body: "Pode conferir o Pix?", authorId: ana.id });
    expect(enviados).toEqual([]);
    expect((await chamar(novaNota, { chave: k, params: { id }, body: { texto: "x".repeat(2001) } })).status).toBe(400);
  });
});
