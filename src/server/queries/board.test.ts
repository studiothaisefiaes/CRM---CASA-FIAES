import { describe, it, expect, beforeEach } from "vitest";
import { permsFor } from "../../../test/perms";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, clientPackages, contacts, deals, messages, stages, users } from "../db/schema";
import { recordInbound } from "../domain/deals";
import { resetDb } from "../../../test/db";
import { etapasAntigasAtivas } from "../../../test/legacy-stages"; // histórico de antes da nova organização (16/10)
import { getBoard, getOrigins } from "./board";

const ids = (b: Awaited<ReturnType<typeof getBoard>>) => b.flatMap((s) => s.cards.map((c) => c.id));

describe("getBoard: filtros de drill-down dos relatórios", () => {
  let late: string, calm: string;
  beforeEach(async () => {
    await resetDb(); await etapasAntigasAtivas();
    const mk = async (n: number) => { const r = await recordInbound({ channelId: null, externalId: `B${n}`, phoneRaw: `7199977000${n}`, body: "oi" }); if (!("dealId" in r)) throw new Error(); return r.dealId; };
    late = await mk(1); calm = await mk(2);
    await db.insert(alerts).values({ dealId: late, type: "sem_resposta_minutos", message: "x", dedupeKey: "k1", waitKey: `${late}:espera` });
  });

  it("card de áudio traz duração e transcrição para a prévia", async () => {
    const [d] = await db.select().from(deals).where(eq(deals.id, calm));
    await db.insert(messages).values({ dealId: calm, contactId: d.contactId, direction: "in", kind: "audio", mediaDurationSec: 42, transcript: "Queria marcar escova", transcriptStatus: "pronta", createdAt: new Date() });
    const card = (await getBoard()).flatMap((s) => s.cards).find((c) => c.id === calm)!;
    expect(card).toMatchObject({ lastMessageKind: "audio", lastMessageDurationSec: 42, lastMessageTranscript: "Queria marcar escova" });
  });

  it("card traz quem escreveu por último e 'respondida por' quando não é a dona", async () => {
    const [ana] = await db.insert(users).values({ name: "Ana Souza", email: "a2@c.com", role: "atendente", passwordHash: "x" }).returning();
    const [bia] = await db.insert(users).values({ name: "Bia Lima", email: "b2@c.com", role: "atendente", passwordHash: "x", signature: "BIA" }).returning();
    const [d] = await db.select().from(deals).where(eq(deals.id, calm));
    await db.update(deals).set({ ownerId: ana.id, lastReplyById: bia.id, lastReplyVia: "crm" }).where(eq(deals.id, calm));
    await db.insert(messages).values({ dealId: calm, contactId: d.contactId, direction: "out", body: "Oi", sentByUserId: bia.id, sentVia: "crm", createdAt: new Date() });
    const card = (await getBoard()).flatMap((s) => s.cards).find((c) => c.id === calm)!;
    expect(card).toMatchObject({ ownerName: "Ana Souza", ownerShort: "Ana Souza", lastAuthorName: "Bia", repliedByName: "Bia" });
  });

  it("atrasados: só quem tem alerta de espera aberto", async () => {
    expect(ids(await getBoard({ filtro: "atrasados" }))).toEqual([late]);
    await db.update(alerts).set({ resolvedAt: new Date() }).where(eq(alerts.dealId, late));
    expect(ids(await getBoard({ filtro: "atrasados" }))).toEqual([]);
  });

  it("esperando: quem aguarda resposta; sem filtro mostra todos", async () => {
    expect((ids(await getBoard({ filtro: "esperando" }))).sort()).toEqual([late, calm].sort());
    await db.update(deals).set({ awaitingReplySince: null }).where(eq(deals.id, calm));
    expect(ids(await getBoard({ filtro: "esperando" }))).toEqual([late]);
    expect(ids(await getBoard({}))).toHaveLength(2);
  });

  it("parados: além do limite de dias da etapa, e por etapa", async () => {
    await db.update(stages).set({ staleDays: 2 }).where(eq(stages.key, "lead"));
    await db.update(deals).set({ stageEnteredAt: new Date(Date.now() - 5 * 86_400_000) }).where(eq(deals.id, calm));
    expect(ids(await getBoard({ filtro: "parados" }))).toEqual([calm]);
    expect(ids(await getBoard({ filtro: "parados", etapa: "lead" }))).toEqual([calm]);
    expect(ids(await getBoard({ filtro: "parados", etapa: "atendimento" }))).toEqual([]);
  });

  it("origem real: 'Não identificada' filtra os leads sem origem", async () => {
    await db.update(deals).set({ origin: "Instagram", sourceLabel: "Instagram" }).where(eq(deals.id, late));
    await db.update(deals).set({ origin: "WhatsApp", sourceLabel: null }).where(eq(deals.id, calm));
    expect(ids(await getBoard({ filtro: "esperando", source: "Instagram" }))).toEqual([late]);
    expect(ids(await getBoard({ filtro: "esperando", source: "Não identificada" }))).toEqual([calm]);
  });

  it("o cartão e o filtro de origem mostram a origem real, nunca o canal (\"WhatsApp\")", async () => {
    await db.update(deals).set({ origin: "Instagram", sourceLabel: "Instagram" }).where(eq(deals.id, late));
    await db.update(deals).set({ origin: "WhatsApp", sourceLabel: null }).where(eq(deals.id, calm));
    const cards = (await getBoard({})).flatMap((s) => s.cards);
    expect(cards.find((c) => c.id === late)?.origin).toBe("Instagram");
    expect(cards.find((c) => c.id === calm)?.origin).toBe("Não identificada");
    expect(await getOrigins()).toEqual(["Instagram", "Não identificada"]);
    expect(ids(await getBoard({ origin: "Não identificada" }))).toEqual([calm]);
  });
});

describe("getBoard: escopo, arquivados e ordem de urgência", () => {
  const mk = async (n: number, over: { owner?: string | null; ignored?: boolean; archived?: boolean; awaiting?: Date | null; stage?: string } = {}) => {
    const r = await recordInbound({ channelId: null, externalId: `S${n}`, phoneRaw: `71998100${String(n).padStart(3, "0")}`, pushName: `Cliente ${n}`, body: "oi" });
    if (!("dealId" in r)) throw new Error();
    const [st] = await db.select().from(stages).where(eq(stages.key, over.stage ?? "lead"));
    await db.update(deals).set({
      ownerId: over.owner ?? null, awaitingReplySince: over.awaiting === undefined ? new Date(Date.now() - 60_000) : over.awaiting,
      archivedAt: over.archived ? new Date() : null, stageId: st.id,
    }).where(eq(deals.id, r.dealId));
    if (over.ignored) await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, (await db.select().from(deals).where(eq(deals.id, r.dealId)))[0].contactId));
    return r.dealId;
  };
  const person = async (name: string, role: "atendente" | "gestor") =>
    (await db.insert(users).values({ name, email: `${name}@c.com`, role, passwordHash: "x" }).returning())[0];
  const asUser = (u: { id: string; role: "atendente" | "gestor" }) => ({ id: u.id, perms: permsFor(u.role) });

  beforeEach(async () => { await resetDb(); await etapasAntigasAtivas(); });

  it("arquivados e contatos ignorados ficam fora do Quadro, até para a gestão", async () => {
    const ok = await mk(1); await mk(2, { archived: true }); await mk(3, { ignored: true });
    const gestora = await person("Gestora", "gestor");
    expect(ids(await getBoard({}, asUser(gestora)))).toEqual([ok]);
    expect(ids(await getBoard({}))).toEqual([ok]);
  });

  it("atendente vê os leads dela e os sem dono; gestão vê todos", async () => {
    const ana = await person("Ana", "atendente"), bia = await person("Bia", "atendente"), gestora = await person("Gestora", "gestor");
    const dela = await mk(1, { owner: ana.id }), semDono = await mk(2), deBia = await mk(3, { owner: bia.id });
    expect(ids(await getBoard({}, asUser(ana))).sort()).toEqual([dela, semDono].sort());
    expect(ids(await getBoard({}, asUser(gestora))).sort()).toEqual([dela, semDono, deBia].sort());
  });

  it("com filtro de relatório a atendente vê só os dela (como na tela de relatórios)", async () => {
    const ana = await person("Ana", "atendente");
    const dela = await mk(1, { owner: ana.id }); await mk(2);
    expect(ids(await getBoard({ filtro: "esperando" }, asUser(ana)))).toEqual([dela]);
  });

  it("a atendente não escapa do escopo pedindo o dono de outra pessoa", async () => {
    const ana = await person("Ana", "atendente"), bia = await person("Bia", "atendente");
    await mk(1, { owner: bia.id });
    expect(ids(await getBoard({ ownerId: bia.id }, asUser(ana)))).toEqual([]);
  });

  it("dono malformado é ignorado, nunca vira erro do banco", async () => {
    const a = await mk(1);
    expect(ids(await getBoard({ ownerId: "-".repeat(36) }))).toEqual([a]);
  });

  it("dentro da coluna: atrasado (alerta aberto), perto do prazo, aguardando, e por fim quem não espera", async () => {
    // Lead: prazo da etapa em minutos; "perto" = metade dele (horário de expediente, então o teste fixa o relógio dentro do expediente).
    await db.update(stages).set({ slaMinutes: 10 }).where(eq(stages.key, "lead"));
    const now = new Date("2026-10-07T14:00:00-03:00"); // quarta-feira, 14h em Salvador
    const at = (min: number) => new Date(now.getTime() - min * 60_000);
    const idle = await mk(1, { awaiting: null });
    const espera = await mk(2, { awaiting: at(2) });
    const perto = await mk(3, { awaiting: at(6) });
    const atrasadoCurto = await mk(4, { awaiting: at(11) });
    const atrasadoLongo = await mk(5, { awaiting: at(40) });
    for (const [i, id] of [atrasadoCurto, atrasadoLongo].entries()) await db.insert(alerts).values({ dealId: id, type: "sem_resposta_minutos", message: "x", dedupeKey: `kk${i}`, waitKey: `${id}:espera` });
    const board = await getBoard({}, undefined, now);
    const lead = board.find((s) => s.key === "lead")!;
    expect(lead.cards.map((c) => c.id)).toEqual([atrasadoLongo, atrasadoCurto, perto, espera, idle]);
    expect(lead.cards.map((c) => c.urgency)).toEqual(["late", "late", "near", "waiting", "idle"]);
  });
});

describe("getBoard: Lote 1C", () => {
  beforeEach(async () => { await resetDb(); await etapasAntigasAtivas(); });
  const mk = async (n: number) => { const r = await recordInbound({ channelId: null, externalId: `E${n}`, phoneRaw: `7199977100${n}`, pushName: `Cli ${n}`, body: "oi" }); if (!("dealId" in r)) throw new Error(); return r.dealId; };

  it("conversa encerrada sai do Quadro enquanto o lead está aberto; Fechado com conversa encerrada continua na coluna", async () => {
    const encerrada = await mk(1), fechada = await mk(2), aberta = await mk(3);
    await db.update(deals).set({ conversationArchivedAt: new Date() }).where(eq(deals.id, encerrada));
    const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
    await db.update(deals).set({ conversationArchivedAt: new Date(), stageId: fechado.id, closedAt: new Date() }).where(eq(deals.id, fechada));
    const b = await getBoard({});
    expect(ids(b)).not.toContain(encerrada);
    expect(ids(b)).toContain(aberta);
    expect(b.find((s) => s.kind === "fechado")!.cards.map((c) => c.id)).toEqual([fechada]);
  });

  it("card traz a tentativa e o pacote ativo (esgotado não conta)", async () => {
    const id = await mk(4);
    const [fu] = await db.select().from(stages).where(eq(stages.key, "followup_1"));
    await db.update(deals).set({ stageId: fu.id, followupAttempt: 2 }).where(eq(deals.id, id));
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    await db.insert(clientPackages).values([
      { contactId: d.contactId, packageName: "Hidratação 10x", totalSessions: 10, usedSessions: 3, externalKey: "t:pk1" },
      { contactId: d.contactId, packageName: "Antigo", totalSessions: 4, usedSessions: 4, externalKey: "t:pk2" },
    ]);
    const card = (await getBoard({})).flatMap((s) => s.cards).find((c) => c.id === id)!;
    expect(card.followupAttempt).toBe(2);
    expect(card.pkg).toEqual({ used: 3, total: 10 });
  });

  it("pacote do Avec em várias linhas (uma por serviço) é uma compra: maior usado e maior total entre os serviços", async () => {
    const id = await mk(4);
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    const combo = { contactId: d.contactId, packageName: "Combo Manutenção Método Fiaes", totalSessions: 4, priceCents: 800000, purchasedOn: "2025-12-09", validUntil: "2099-12-09" };
    await db.insert(clientPackages).values([1, 2, 3, 1].map((used, i) => ({ ...combo, usedSessions: used, serviceLabel: `Serviço ${i}`, externalKey: `t:combo${i}` })));
    expect((await getBoard({})).flatMap((s) => s.cards).find((c) => c.id === id)!.pkg).toEqual({ used: 3, total: 4 });
    // Um serviço da compra esgotado = a compra esgotada (não pega outro serviço da mesma compra como "pacote em uso").
    await db.update(clientPackages).set({ usedSessions: 4 }).where(eq(clientPackages.externalKey, "t:combo2"));
    expect((await getBoard({})).flatMap((s) => s.cards).find((c) => c.id === id)!.pkg).toBeNull();
  });
});
