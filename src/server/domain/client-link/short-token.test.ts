import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import { appointments, clientLinks, contacts } from "../../db/schema";
import { resetDb } from "../../../../test/db";

// Os códigos sorteados vêm desta fila (para provar que um código repetido é trocado por outro).
const queue = vi.hoisted(() => ({ next: [] as string[] }));
vi.mock("../../auth/tokens", async (orig) => {
  const real = await orig<typeof import("../../auth/tokens")>();
  return { ...real, newShortToken: () => queue.next.shift() ?? real.newShortToken() };
});
const { hashToken, newShortToken, SHORT_ALPHABET } = await vi.importActual<typeof import("../../auth/tokens")>("../../auth/tokens");
const { createClientLink } = await import("./links");

const NOW = new Date("2026-10-14T12:00:00-03:00");

describe("código curto do link da cliente", () => {
  it("8 símbolos legíveis (sem 0/O/1/l/I), 57 símbolos = mais de 46 bits", () => {
    expect(SHORT_ALPHABET).toHaveLength(57);
    expect(SHORT_ALPHABET).not.toMatch(/[0O1lI]/);
    expect(new Set(SHORT_ALPHABET).size).toBe(57);
    expect(8 * Math.log2(SHORT_ALPHABET.length)).toBeGreaterThan(46);
    for (let i = 0; i < 2000; i++) expect(newShortToken()).toMatch(/^[2-9A-HJ-NP-Za-km-z]{8}$/);
  });

  it("imprevisível: 50 mil códigos sem repetição e todos os 57 símbolos aparecem em proporção parecida", () => {
    const seen = new Set<string>();
    const freq = new Map<string, number>();
    for (let i = 0; i < 50_000; i++) {
      const t = newShortToken();
      seen.add(t);
      for (const c of t) freq.set(c, (freq.get(c) ?? 0) + 1);
    }
    expect(seen.size).toBe(50_000);
    expect(freq.size).toBe(57);
    const expected = (50_000 * 8) / 57;
    for (const n of freq.values()) expect(Math.abs(n - expected) / expected).toBeLessThan(0.08);
  });
});

describe("código repetido no banco", () => {
  beforeEach(resetDb);

  it("sorteia outro: o link novo nunca reaproveita um código que já existe", async () => {
    const [c] = await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571999990001" }).returning();
    const [a] = await db.insert(appointments).values({ contactId: c.id, clientName: "Paula", serviceLabel: "Corte", startsAt: new Date("2026-10-16T10:00:00-03:00"),
      durationMin: 60, status: "agendado", origin: "crm", externalKey: "t:dup" }).returning();
    queue.next = ["AAAAAAAA"];
    const first = await createClientLink({ appointmentId: a.id, via: "agenda", actorId: null, now: NOW });
    expect(first.url).toMatch(/\/c\/AAAAAAAA$/);
    queue.next = ["AAAAAAAA", "AAAAAAAA", "BBBBBBBB"];
    const second = await createClientLink({ appointmentId: a.id, via: "agenda", actorId: null, now: NOW });
    expect(second.url).toMatch(/\/c\/BBBBBBBB$/);
    const hashes = (await db.select({ h: clientLinks.tokenHash }).from(clientLinks)).map((r) => r.h).sort();
    expect(hashes).toEqual([hashToken("AAAAAAAA"), hashToken("BBBBBBBB")].sort());
  });

  it("depois de 5 códigos repetidos seguidos, desiste com erro (não grava nada pela metade)", async () => {
    const [c] = await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571999990001" }).returning();
    const [a] = await db.insert(appointments).values({ contactId: c.id, clientName: "Paula", serviceLabel: "Corte", startsAt: new Date("2026-10-16T10:00:00-03:00"),
      durationMin: 60, status: "agendado", origin: "crm", externalKey: "t:dup2" }).returning();
    queue.next = ["CCCCCCCC"];
    await createClientLink({ appointmentId: a.id, via: "agenda", actorId: null, now: NOW });
    queue.next = Array(5).fill("CCCCCCCC");
    await expect(createClientLink({ appointmentId: a.id, via: "agenda", actorId: null, now: NOW })).rejects.toThrow("código de link livre");
    expect(await db.$count(clientLinks)).toBe(1);
  });
});
