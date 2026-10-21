import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, messages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { formatPhoneClient } from "@/lib/phone-client";
import { isHiddenNumber } from "@/lib/phone-client";

beforeEach(async () => {
  await resetDb();
  await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" });
});
const lidIn = (lid: string, ext: string, body: string, phoneRaw = "") =>
  recordInbound({ channelId: null, externalId: ext, phoneRaw, lid, pushName: "Rita", body });

describe("número oculto (@lid)", () => {
  it("sem número visível, a cliente vira contato e lead normais (não é mais ignorada)", async () => {
    const r = await lidIn("126160788811986", "L1", "oi, quero marcar");
    expect("dealId" in r).toBe(true);
    const [c] = await db.select().from(contacts);
    expect(c).toMatchObject({ phoneE164: "lid:126160788811986", waLid: "126160788811986", name: "Rita" });
    const r2 = await lidIn("126160788811986", "L2", "pode ser amanhã?");
    expect("dealId" in r2 && "dealId" in r && r2.dealId === r.dealId).toBe(true);
    expect(await db.select().from(messages)).toHaveLength(2);
    expect((await db.select().from(deals))[0].awaitingReplySince).not.toBeNull();
  });

  it("quando o número aparece junto, o contato oculto ganha o número de verdade (sem duplicar)", async () => {
    await lidIn("555", "L1", "oi");
    await lidIn("555", "L2", "sou eu de novo", "5571999990001");
    const cs = await db.select().from(contacts);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ phoneE164: "+5571999990001", waLid: "555" });
    await lidIn("555", "L3", "e agora sem número de novo");
    expect(await db.select().from(contacts)).toHaveLength(1);
    expect(await db.select().from(messages)).toHaveLength(3);
  });

  it("contato que já existia pelo número aprende o @lid e recebe as mensagens ocultas", async () => {
    await recordInbound({ channelId: null, externalId: "P1", phoneRaw: "5571999990002", pushName: "Sol", body: "oi" });
    await lidIn("777", "L1", "mensagem com número", "5571999990002");
    await lidIn("777", "L2", "mensagem só com o lid");
    const cs = await db.select().from(contacts);
    expect(cs).toHaveLength(1);
    expect(cs[0].waLid).toBe("777");
    expect(await db.select().from(messages).where(eq(messages.contactId, cs[0].id))).toHaveLength(3);
  });

  it("na tela, sem número visível a linha do telefone fica vazia (nada de \"Número oculto\")", () => {
    expect(formatPhoneClient("lid:126160788811986")).toBe("");
    expect(isHiddenNumber("lid:1")).toBe(true);
    expect(isHiddenNumber("+5571999990001")).toBe(false);
  });
});

describe("responder a número oculto", () => {
  it("o CRM não manda para os dígitos do @lid (seriam outro número): pede para responder pelo celular", async () => {
    const { sendFromCrm } = await import("./send");
    const r = await lidIn("999", "L1", "oi");
    if (!("dealId" in r)) throw new Error();
    const [u] = await db.select().from(users);
    await expect(sendFromCrm(r.dealId, "olá!", u.id)).rejects.toThrow("número oculto");
  });
});
