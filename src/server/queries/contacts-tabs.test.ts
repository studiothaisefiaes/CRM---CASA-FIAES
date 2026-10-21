import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { appointments, clientPackages, contactTags, contacts, salesItems, tags } from "../db/schema";
import { resetDb } from "../../../test/db";
import { contactTabCounts, listContacts } from "./contacts";
import { contactListQuery, parseContactListParams } from "../../lib/contact-list-params";

const NOW = new Date("2026-10-15T15:00:00Z");
let seq = 0;
const cliente = async (name: string, isClient = true) =>
  (await db.insert(contacts).values({ name, phoneE164: `+5571968${String(++seq).padStart(6, "0")}`, isClient }).returning())[0].id;
const nomes = async (tab: "metodo" | "gerais" | null) => (await listContacts({ tab, now: NOW, sort: "nome" })).rows.map((r) => r.name);

beforeEach(async () => { seq = 0; await resetDb(); });

it("abas Todas · Método Fiaes · Serviços gerais: Método pelo serviço, pacote, horário ou etiqueta (com ou sem acento); o resto das clientes é Serviços gerais", async () => {
  const servico = await cliente("A Serviço Avec");
  await db.insert(salesItems).values({ contactId: servico, soldOn: "2026-09-01", item: "METODO FIAES - MANUTENÇÃO", kind: "servico", externalKey: "t:s1" });
  const pacote = await cliente("B Pacote Só Comprado");
  await db.insert(clientPackages).values({ contactId: pacote, packageName: "Pacote Método Fiaes 4x", totalSessions: 4, usedSessions: 0, externalKey: "t:mf" });
  const horario = await cliente("C Horário");
  await db.insert(appointments).values({ contactId: horario, startsAt: new Date("2026-10-20T13:00:00Z"), status: "agendado", serviceLabel: "Método fiaes", externalKey: "t:h" });
  const etiqueta = await cliente("D Etiqueta", false);
  const [t] = await db.insert(tags).values({ name: "Método Fiaes" }).returning();
  await db.insert(contactTags).values({ contactId: etiqueta, tagId: t.id });
  const geral = await cliente("E Escova");
  await db.insert(salesItems).values({ contactId: geral, soldOn: "2026-09-01", item: "Escova", kind: "servico", externalKey: "t:s2" });
  await cliente("F Lead Que Nunca Veio", false);

  expect(await nomes("metodo")).toEqual(["A Serviço Avec", "B Pacote Só Comprado", "C Horário", "D Etiqueta"]);
  expect(await nomes("gerais")).toEqual(["E Escova"]);
  expect((await nomes(null))).toHaveLength(6);
  expect(await contactTabCounts({ now: NOW })).toEqual({ todas: 6, metodo: 4, gerais: 1 });
});

it("a aba vai e volta pela URL (?aba=metodo | gerais)", () => {
  const p = parseContactListParams(new URLSearchParams("aba=metodo&q=ana"));
  expect(p.tab).toBe("metodo");
  expect(contactListQuery(p)).toBe("?q=ana&aba=metodo");
  expect(parseContactListParams(new URLSearchParams("aba=xx")).tab).toBeNull();
});
