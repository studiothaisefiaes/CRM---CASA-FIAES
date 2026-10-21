import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { alerts, deals, messages, outbox, users } from "@/server/db/schema";
import { recordInbound } from "@/server/domain/deals";
import { OUT_OF_SCOPE, setStrictScope } from "@/server/domain/deal-scope";
import { resetDb } from "../../../../test/db";
import { permsFor } from "../../../../test/perms";

/**
 * Revisão de segurança 17/10 (M1): as ações de uma conversa conferem o escopo das listas. Atendente: só as próprias e as sem dono.
 * Gestão (atendimento.todas): todas, como antes. A sessão é trocada aqui; o resto (banco, domínio) é o de verdade.
 */
const { who } = vi.hoisted(() => ({ who: { current: null as null | { id: string; name: string; perms: string[] } } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/lib/permissions");
  const { UserFacingError } = await import("@/server/domain/errors");
  const me = () => { if (!who.current) throw new UserFacingError("Sua sessão expirou. Entre de novo."); return who.current; };
  return {
    assertUser: async () => me(),
    assertPerm: async (p: string) => { const u = me(); if (!can(u.perms, p as never)) throw new UserFacingError("Você não tem permissão para isso."); return u; },
    assertAnyPerm: async (...ps: string[]) => { const u = me(); if (!ps.some((p) => can(u.perms, p as never))) throw new UserFacingError("Você não tem permissão para isso."); return u; },
  };
});
import * as conversa from "./actions";
import * as funil from "../funil/actions";
import * as ia from "./ai-actions";
import * as atendimento from "../atendimento/actions";

const mkUser = async (name: string, perms: string[]) => ({ id: (await db.insert(users).values({ name, email: `${name}-${Math.random()}@c.com`, passwordHash: "x" }).returning())[0].id, name, perms });
const mkDeal = async (phone: string, ownerId: string | null) => {
  const r = await recordInbound({ channelId: null, externalId: `A-${phone}-${Math.random()}`, phoneRaw: phone, pushName: "Cliente", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId }).where(eq(deals.id, r.dealId));
  return r.dealId;
};
const ownerOf = async (id: string) => (await db.select({ ownerId: deals.ownerId }).from(deals).where(eq(deals.id, id)))[0].ownerId;

let ana: Awaited<ReturnType<typeof mkUser>>, bia: Awaited<ReturnType<typeof mkUser>>, gestora: Awaited<ReturnType<typeof mkUser>>;
beforeEach(async () => {
  await resetDb();
  ana = await mkUser("ana", permsFor("atendente"));
  bia = await mkUser("bia", permsFor("atendente"));
  gestora = await mkUser("gestora", permsFor("gestor"));
  await setStrictScope(true, gestora.id); // a regra nova só vale com a chave ligada (nasce desligada)
});

describe("atendente com a conversa de uma colega: recusa", () => {
  it("nenhuma ação mexe na conversa da colega", async () => {
    const d = await mkDeal("71999960001", bia.id);
    const [m] = await db.insert(messages).values({ dealId: d, contactId: (await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, d)))[0].c, direction: "out", kind: "text", body: "oi", status: "sent", externalId: "X1" }).returning({ id: messages.id });
    const [o] = await db.insert(outbox).values({ dealId: d, kind: "text", text: "oi", options: { source: "agendada" } }).returning({ id: outbox.id });
    who.current = ana;
    const calls: [string, () => Promise<{ ok: boolean; error?: string }>][] = [
      ["nota", () => conversa.addNoteAction({ dealId: d, body: "x", mentions: [] })],
      ["agendar mensagem", () => conversa.scheduleMessageAction({ dealId: d, text: "x", at: new Date(Date.now() + 86_400_000).toISOString(), cancelIfReply: false })],
      ["cancelar programada", () => conversa.cancelScheduledAction(o.id)],
      ["enviar programada agora", () => conversa.sendScheduledNowAction(o.id)],
      ["resolver", () => conversa.resolveAction(d)],
      ["status", () => conversa.setConversationStatusAction(d, "resolvido")],
      ["retomada", () => conversa.resumeAction(d, { dueAt: new Date(Date.now() + 86_400_000).toISOString() })],
      ["apagar para todos", () => conversa.deleteForEveryoneAction(m.id)],
      ["responder", () => funil.sendMessageAction(d, "oi")],
      ["editar lead", () => funil.updateDealAction(d, { observations: "x" })],
      ["arquivar conversa", () => funil.archiveConversationAction(d)],
      ["assumir", () => funil.claimAction(d)],
      ["transferir para si", () => funil.transferAction(d, ana.id)],
      ["não é cliente (um só)", () => funil.archiveAction([d])],
      ["etiqueta", () => funil.addTagAction(d, "vip")],
      ["sugestão da IA (ler)", () => ia.getAiSuggestionAction(d)],
      ["sugestão da IA (pedir)", () => ia.requestAiSuggestionAction(d, "primeira")],
      ["retomada proposta pela IA", () => ia.programarRetomadaAction({ id: "00000000-0000-4000-8000-000000000000", dealId: d })],
      ["folha do lead", () => atendimento.getDealForSheet(d)],
    ];
    for (const [nome, call] of calls) expect(await call(), nome).toEqual({ ok: false, error: OUT_OF_SCOPE });
    expect(await ownerOf(d)).toBe(bia.id);
    const [ainda] = await db.select({ deletedAt: messages.deletedAt }).from(messages).where(eq(messages.id, m.id));
    expect(ainda.deletedAt).toBeNull();
    const [prog] = await db.select({ status: outbox.status }).from(outbox).where(eq(outbox.id, o.id));
    expect(prog.status).toBe("pending");
  });
});

describe("aceita", () => {
  it("atendente com conversa sem dono", async () => {
    const d = await mkDeal("71999960002", null);
    who.current = ana;
    expect(await conversa.addNoteAction({ dealId: d, body: "x", mentions: [] })).toMatchObject({ ok: true });
    expect(await funil.archiveConversationAction(d)).toEqual({ ok: true });
  });
  it("atendente com a própria conversa", async () => {
    const d = await mkDeal("71999960003", ana.id);
    who.current = ana;
    expect(await conversa.addNoteAction({ dealId: d, body: "x", mentions: [] })).toMatchObject({ ok: true });
  });
  it("gestão com a conversa de uma atendente (atendimento.todas: nada muda)", async () => {
    const d = await mkDeal("71999960004", bia.id);
    who.current = gestora;
    expect(await conversa.addNoteAction({ dealId: d, body: "x", mentions: [] })).toMatchObject({ ok: true });
    expect(await funil.archiveConversationAction(d)).toEqual({ ok: true });
    expect(await funil.claimAction(d)).toEqual({ ok: true });
    expect(await ownerOf(d)).toBe(gestora.id);
  });
});

it("Assumir pela oferta da distribuição: a atendente assume a conversa da colega que não respondeu", async () => {
  const d = await mkDeal("71999960005", bia.id);
  await db.insert(alerts).values({ dealId: d, userId: ana.id, type: "oferta", message: "A dona não respondeu. Pode assumir?", dedupeKey: `oferta:${d}:${ana.id}`, waitKey: `oferta:${d}` });
  who.current = ana;
  expect(await funil.claimAction(d)).toEqual({ ok: true });
  expect(await ownerOf(d)).toBe(ana.id);
});

it("chave desligada (o padrão): a atendente responde, resolve e arquiva a conversa da colega, como antes", async () => {
  await setStrictScope(false, gestora.id);
  const d = await mkDeal("71999960006", bia.id);
  who.current = ana;
  expect(await conversa.addNoteAction({ dealId: d, body: "x", mentions: [] })).toMatchObject({ ok: true });
  expect(await conversa.resolveAction(d)).toMatchObject({ ok: true });
  expect(await funil.archiveConversationAction(d)).toEqual({ ok: true });
  expect(await atendimento.getDealForSheet(d)).toMatchObject({ ok: true });
});
