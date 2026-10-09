import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db";
import { contacts } from "../db/schema";
import { importClients, parseCsv } from "./import";
import { recordInbound } from "./deals";
import { resetDb } from "../../../test/db";

const CSV = `﻿Nome;Celular;E-mail;Data de nascimento;Último atendimento;Cliente desde
"Fernanda Reis";(71) 99555-1234;fe@x.com;14/11/1990;02/09/2026;10/03/2019
Aline Moura;71 98888-0000;;05/01;;
Sem telefone;abc;;;;
"Duplicada; com ponto e vírgula";71995551234;;;15/09/2026;`;

describe("importação do histórico de clientes", () => {
  beforeEach(resetDb);

  it("lê CSV com ; aspas e BOM", () => {
    const r = parseCsv(CSV);
    expect(r[0][0]).toBe("Nome");
    expect(r[4][0]).toBe("Duplicada; com ponto e vírgula");
  });

  it("importa, reporta linhas inválidas e é idempotente", async () => {
    const r1 = await importClients(CSV);
    expect(r1).toMatchObject({ total: 4, imported: 2, updated: 0 });
    expect(r1.invalid).toEqual([{ line: 4, value: "abc" }]);
    const all = await db.select().from(contacts);
    const fe = all.find((c) => c.phoneE164 === "+5571995551234")!;
    expect(fe.name).toBe("Duplicada; com ponto e vírgula"); // a última linha do mesmo telefone vence dentro do arquivo
    expect(fe.isClient).toBe(true);
    expect(fe.lastServiceAt?.toISOString().slice(0, 10)).toBe("2026-09-15");
    const r2 = await importClients(CSV);
    expect(r2).toMatchObject({ imported: 0, updated: 2 });
    expect((await db.select().from(contacts)).length).toBe(2);
  });

  it("lead que chega de cliente importado vem marcado como 'Já é cliente'", async () => {
    await importClients(CSV);
    const r = await recordInbound({ channelId: null, externalId: "x1", phoneRaw: "5571988880000@s.whatsapp.net", body: "oi" });
    expect("created" in r && r.created).toBe(true);
    const deals = await db.query.deals.findMany();
    expect(deals[0].origin).toBe("Já é cliente");
  });

  it("sem coluna de telefone avisa", async () => {
    expect(await importClients("Nome;Cidade\nAna;Salvador")).toMatchObject({ missingPhoneColumn: true });
  });
});
