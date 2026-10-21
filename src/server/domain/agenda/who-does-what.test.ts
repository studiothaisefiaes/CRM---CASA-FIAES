import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, avecReports, lists, professionals, professionalServices, salesItems, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { acceptSuggestions, suggestProfessionalServices } from "./who-does-what";

// Relatório "Serviços por profissional" (6f695f67) SINTÉTICO: nomes inventados, já sem CPF (a importação tira).
const COLS = ["Profissional", "Data Comanda", "Dia da Semana", "Número Comanda", "Serviço", "Categoria", "Cliente", "Telefone", "Celular", "Qtd.", "Valor", "Desconto", "Total", "Pacote"];
const r = (pro: string, dia: string, comanda: string, servico: string) => [pro, dia, "", comanda, servico, "Cabelo", "Cliente Teste", "", "", "1", "100,00", "0,00", "100,00", ""];
let nRep = 0;
const report = (rows: string[][]) => db.insert(avecReports).values({ signature: "6f695f67", title: "Serviços por profissional", fileName: `s${nRep}.xlsx`, fileHash: `h${nRep++}`, columns: COLS, rows, rowCount: rows.length });
const NOW = new Date("2026-10-15T15:00:00Z");

let g = "", maiara = "", jo = "", antiga = "", corte = "", coloracao = "", hidratacao = "";
beforeEach(async () => {
  await resetDb();
  g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
  [maiara, jo, antiga] = (await db.insert(professionals).values([
    { name: "MAIARA", fullName: "MAIARA DA SILVA TESTE" }, { name: "JO" }, { name: "ANTIGA", active: false },
  ]).returning()).map((p) => p.id);
  const svc = Object.fromEntries((await db.select().from(lists).where(eq(lists.kind, "service"))).map((s) => [s.label, s.id]));
  [corte, coloracao, hidratacao] = [svc["Corte"], svc["Coloração"], svc["Hidratação"]];
  await db.insert(professionalServices).values({ professionalId: jo, serviceId: hidratacao }); // feito à mão
  await report([
    r("MAIARA", "01/10/2026", "101", "Corte"),
    r("MAIARA DA SILVA TESTE", "05/09/2026", "102", "CORTE"), // nome completo e caixa diferente: mesma profissional e serviço
    r("MAIARA", "10/10/2026", "103", "Coloração"),
    r("JO", "01/09/2025", "90", "Corte"), // mais de 12 meses: não conta
    r("JO", "20/09/2026", "104", "Corte"),
    r("MAIARA", "01/10/2026", "105", "Escova progressiva"), r("MAIARA", "02/10/2026", "106", "Escova progressiva"),
    r("FULANA NAO CADASTRADA", "01/10/2026", "107", "Corte"),
    r("ANTIGA", "01/10/2026", "108", "Corte"), r("ANTIGA", "02/10/2026", "109", "Corte"), // desativada: fica de fora
    r("JO", "03/10/2026", "110", "Hidratação"), r("JO", "04/10/2026", "111", "Hidratação"), r("JO", "05/10/2026", "112", "Hidratação"), // já ligada
  ]);
  await report([r("MAIARA", "01/10/2026", "101", "Corte")]); // o mesmo atendimento de novo, em outro arquivo
  const item = (professionalId: string, soldOn: string, itemName: string) =>
    ({ professionalId, soldOn, item: itemName, kind: "servico", externalKey: `si:${Math.random()}` });
  await db.insert(salesItems).values([item(jo, "2026-09-25", "Corte"), item(jo, "2026-10-02", "Corte"), item(maiara, "2026-10-03", "Coloração")]);
});

describe("quem faz o quê sugerido pelo histórico do Avec", () => {
  it("2 vezes ou mais em 12 meses vira sugestão, sem contar o mesmo atendimento duas vezes; o que não casou aparece à parte", async () => {
    const s = await suggestProfessionalServices({ now: NOW });
    expect(s.suggestions.map((x) => [x.professionalName, x.serviceLabel, x.count])).toEqual([["JO", "Corte", 2], ["MAIARA", "Corte", 2]]);
    expect(s.unmatched).toEqual([{ kind: "servico", name: "Escova progressiva", count: 2 }, { kind: "profissional", name: "FULANA NAO CADASTRADA", count: 1 }]);
  });
  it("com mínimo 1, a Coloração da Maiara (1 vez no relatório e 1 na venda: o mesmo atendimento) também aparece", async () => {
    const s = await suggestProfessionalServices({ now: NOW, minCount: 1 });
    expect(s.suggestions.find((x) => x.professionalId === maiara && x.serviceId === coloracao)?.count).toBe(1);
  });
  it("aceitar grava como do histórico do Avec, é idempotente e nunca tira vínculo feito à mão", async () => {
    expect(await acceptSuggestions({ now: NOW }, g)).toEqual({ added: 2 });
    expect(await acceptSuggestions({ now: NOW }, g)).toEqual({ added: 0 });
    const links = await db.select().from(professionalServices);
    expect(links.map((l) => [l.professionalId, l.serviceId, l.source]).sort()).toEqual([
      [jo, corte, "avec_historico"], [jo, hidratacao, "manual"], [maiara, corte, "avec_historico"],
    ].sort());
    expect(links.find((l) => l.serviceId === corte)?.createdBy).toBe(g);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "aceitou_sugestoes"))).toHaveLength(1);
    expect((await suggestProfessionalServices({ now: NOW })).suggestions).toEqual([]);
  });
  it("aceitar só as de uma profissional, ou só os pares escolhidos que são sugestão", async () => {
    expect(await acceptSuggestions({ professionalId: maiara, now: NOW }, g)).toEqual({ added: 1 });
    expect(await acceptSuggestions({ pairs: [{ professionalId: jo, serviceId: corte }, { professionalId: jo, serviceId: coloracao }, { professionalId: antiga, serviceId: corte }], now: NOW }, g)).toEqual({ added: 1 });
    expect(await db.select().from(professionalServices).where(and(eq(professionalServices.professionalId, jo), eq(professionalServices.serviceId, coloracao)))).toEqual([]);
  });
});
