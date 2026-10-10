import { it, expect, beforeEach, describe } from "vitest";
import { db } from "../db";
import { contacts, messages, users } from "../db/schema";
import { recordInbound } from "../domain/deals";
import { archiveDeals } from "../domain/archive";
import { resetDb } from "../../../test/db";
import { listContacts } from "./contacts";

const names = async (opts: Parameters<typeof listContacts>[0]) => (await listContacts(opts)).rows.map((r) => r.name);
let dealIds: Record<string, string> = {};

beforeEach(async () => {
  await resetDb();
  dealIds = {};
  const data: [string, string, string][] = [
    ["Mariana Souza", "71999110001", "Oi, quero fazer progressiva na sexta"],
    ["Carla Mendes", "71999110002", "Qual o preço da escova?"],
    ["Bianca Teles", "71999110003", "Tem horário para hidratação 100% natural?"],
    ["Dora Lins", "71988220004", "Bom dia"],
  ];
  for (const [i, [name, phone, body]] of data.entries()) {
    const r = await recordInbound({ channelId: null, externalId: `Q${i}`, phoneRaw: phone, pushName: name, body });
    if ("dealId" in r) dealIds[name] = r.dealId;
  }
});

describe("busca de contatos", () => {
  it("acha por nome, sem diferenciar maiúsculas, e por pedaço do nome", async () => {
    expect(await names({ q: "MARIANA" })).toEqual(["Mariana Souza"]);
    expect(await names({ q: "mende" })).toEqual(["Carla Mendes"]);
  });

  it("acha por nome parecido (erro de digitação)", async () => {
    expect(await names({ q: "Marianna Sousa" })).toContain("Mariana Souza");
  });

  it("acha por telefone, com ou sem formatação", async () => {
    expect(await names({ q: "99911-0002" })).toEqual(["Carla Mendes"]);
    expect(await names({ q: "(71) 98822" })).toEqual(["Dora Lins"]);
  });

  it("acha por um trecho de mensagem e devolve o trecho para destacar", async () => {
    const r = await listContacts({ q: "progressiva" });
    expect(r.rows.map((x) => x.name)).toEqual(["Mariana Souza"]);
    expect(r.rows[0].snippet?.text).toContain("progressiva");
    expect(r.rows[0].snippet?.at).toBeTruthy();
    expect((await listContacts({ q: "escova" })).rows[0].name).toBe("Carla Mendes");
  });

  it("% e _ valem como texto, não como curinga", async () => {
    expect(await names({ q: "100%" })).toEqual(["Bianca Teles"]);
    expect(await names({ q: "%%%" })).toEqual([]);
    expect(await names({ q: "_ _ _" })).toEqual([]);
  });

  it("mensagem apagada pela cliente não é achada", async () => {
    await db.update(messages).set({ deletedAt: new Date() });
    expect(await names({ q: "progressiva" })).toEqual([]);
  });

  it("quem tem nome E mensagem com o termo aparece uma vez só", async () => {
    await recordInbound({ channelId: null, externalId: "Q9", phoneRaw: "71999110001", body: "Mariana de novo, sobre a progressiva" });
    const r = await listContacts({ q: "mariana" });
    expect(r.rows).toHaveLength(1);
    expect(r.total).toBe(1);
  });

  it("sem termo lista todos, com o total e a página", async () => {
    const r = await listContacts({});
    expect(r.total).toBe(4);
    expect(r.rows).toHaveLength(4);
  });

  it("termo de 1 ou 2 letras busca só nome e telefone (não varre as mensagens)", async () => {
    expect(await names({ q: "ma" })).toEqual(["Mariana Souza"]); // "ma" aparece em mensagens de outros, mas não conta
  });
});

describe("contato 'Não é cliente'", () => {
  beforeEach(async () => {
    const [u] = await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning();
    await archiveDeals([dealIds["Carla Mendes"]], u.id);
  });

  it("fica fora da lista e da busca padrão", async () => {
    expect(await names({})).not.toContain("Carla Mendes");
    expect(await names({ q: "escova" })).toEqual([]);
    expect(await names({ q: "Carla" })).toEqual([]);
  });

  it("aparece, marcado, quando pedido", async () => {
    const r = await listContacts({ q: "Carla", includeIgnored: true });
    expect(r.rows.map((x) => [x.name, x.ignored])).toEqual([["Carla Mendes", true]]);
    expect((await listContacts({ includeIgnored: true })).total).toBe(4);
  });
});

it("devolve o lead aberto e o dono de cada contato", async () => {
  const [c] = await db.select().from(contacts).limit(1);
  const r = await listContacts({ q: c.phoneE164.slice(-8) });
  expect(r.rows[0].openDealId).toBeTruthy();
});
