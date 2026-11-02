import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db";
import { contacts } from "../db/schema";
import { importClients, parseCsv, previewImport, previewImportWithDb, importLimitError } from "./import";
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

describe("prévia da importação", () => {
  beforeEach(resetDb);
  it("prévia aponta duplicado pelo telefone normalizado e linha inválida", () => {
    expect(previewImport("nome;telefone\nAna;71 99999-0001\nAna B;(71)999990001\nX;123")).toMatchObject({ rows: 1, duplicates: 1, invalid: [{ line: 4, value: "123" }] });
  });
  it("lê vírgula e BOM, avisa sem coluna de telefone e não grava nada", async () => {
    expect(previewImport("\ufeffNome,Celular\nAna,71988880000")).toMatchObject({ rows: 1, duplicates: 0, invalid: [] });
    expect(previewImport("Nome;Cidade\nAna;Salvador")).toMatchObject({ missingPhoneColumn: true });
    await previewImportWithDb("nome;telefone\nAna;71 99999-0001");
    expect(await db.select().from(contacts)).toHaveLength(0);
  });
  it("conta quem já existe no banco", async () => {
    await db.insert(contacts).values({ phoneE164: "+5571999990001" });
    expect(await previewImportWithDb("nome;telefone\nAna;71 99999-0001\nBia;71 99999-0002")).toMatchObject({ rows: 2, existing: 1 });
  });
  it("limites: 10 MB e 10.000 linhas, com mensagem clara", () => {
    expect(importLimitError(11 * 1024 * 1024)).toMatch(/10 MB/);
    expect(importLimitError(100, "telefone\n" + Array(10001).fill("71999990001").join("\n"))).toMatch(/10\.000/);
    expect(importLimitError(100, "telefone\n" + Array(6400).fill("71999990001").join("\n"))).toBeNull();
  });

  it("cadastro do Avec: Celular antes de Telefone, aniversário sem ano, 'Cadastrado', 'Como Conheceu' e nome sem prefixo estranho", async () => {
    const AVEC = `Cliente;Código;Aniversário;Telefone;Celular;E-mail;Sexo;Como Conheceu;Cadastrado
": Elissandra Morais";3482;07/8/1981;;71990000005;ellis@x.com;F;Instagram;24/02/2024
(LOLI)Maria Iolanda;6430;25/3;;7190000006;;F;amiga de thaise;22/08/2026
Só Telefone;7000;;(71) 3333-4444;;;F;;01/01/2025`;
    const r = await importClients(AVEC);
    expect(r).toMatchObject({ total: 3, imported: 3 });
    const all = await db.select().from(contacts);
    const eli = all.find((c) => c.phoneE164 === "+5571990000005")!;
    expect(eli).toMatchObject({ name: "Elissandra Morais", birthDay: 7, birthMonth: 8, birthYear: 1981, isClient: true });
    expect(eli.clientSince?.toISOString().slice(0, 10)).toBe("2024-02-24");
    expect(eli.importedFields?.avec).toMatchObject({ comoConheceu: "Instagram", codigo: "3482" });
    const loli = all.find((c) => c.phoneE164 === "+5571990000006")!; // celular de 8 dígitos ganha o 9
    expect(loli).toMatchObject({ birthDay: 25, birthMonth: 3, birthYear: null, name: "(LOLI)Maria Iolanda" });
    expect(all.find((c) => c.name === "Só Telefone")?.phoneE164).toBe("+557133334444");
  });

  it("não apaga o que a equipe já tinha: nome e campos do ChatGuru continuam", async () => {
    await db.insert(contacts).values({ phoneE164: "+5571990000005", name: "Elis (cliente fiel)", importedFields: { chatguru: { responsavel: "Sara" } } });
    await importClients(`Cliente;Celular;Como Conheceu\nElissandra;71990000005;Instagram`);
    const [c] = await db.select().from(contacts);
    expect(c.name).toBe("Elis (cliente fiel)");
    expect(c.importedFields).toMatchObject({ chatguru: { responsavel: "Sara" }, avec: { comoConheceu: "Instagram" } });
  });
});
