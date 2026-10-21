import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  agendaBlocks, appointments, avecReports, clientPackages, contactTags, contacts, deals, lists, packageUses, professionals, salesItems, salesPayments, tags,
} from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { applyAvecFile, applyAvecFiles, type AvecFileInput } from "./apply";
import { buildXlsx, readXlsx } from "./xlsx";
import { emptySummary } from "./context";

// Planilhas SINTÉTICAS (nomes e telefones inventados), com os cabeçalhos dos formatos reais (docs/avec-formatos.json).
type Cell = string | number | null;
const sheet = async (fileName: string, rows: Cell[][]): Promise<AvecFileInput> => ({ fileName, rows: await readXlsx(await buildXlsx(rows)) });

const H = {
  profissionais: ["ID", "Nome", "Cargo", "CPF", "Apelido", "Especialidade", "Contratação", "Grupo de acesso", "Data Cadastro"],
  reservas: ["Data Cadastro Reserva", "Data Reserva", "Hora", "Cliente", "Celular", "Data Cadastro Cliente", "E-mail", "Profissional", "Serviço", "Origem", "Status", "Observação", "Data Comanda", "Número", "Quem Cadastrou"],
  clientes: ["Cliente", "Código", "Aniversário", "Telefone", "Celular", "E-mail", "Sexo", "Como Conheceu", "CPF", "CEP", "Endereço", "Número", "Estado", "Cidade", "Complemento", "Bairro", "Profissão", "Cadastrado", "Obs", "RG"],
  itens: ["Data", "Comanda", "Item", "Tipo", "Categoria", "Profissional", "Assistente 1", "Assistente 2", "Comissão (%)", "Cliente", "Email", "Telefone", "Celular", "Valor", "Desconto", "Qtd.", "Custo", "Comissão", "Líquido", "UA"],
  itensSemProf: ["Cliente", "Data", "Comanda N°", "Serviço", "Valor R$", "Custo", "Quantidade"],
  pagamentos: ["Data Comanda", "Comanda", "Cliente", "CPF", "Valor", "Forma de Pagamento", "Detalhe", "Data Pagamento", "Caixa", "Abertura"],
  pacotes: ["Cliente", "Pacote", "Serviço", "Total", "Utilizados", "Valor de venda", "Validade", "Compra"],
  usos: ["Data", "Número", "Cliente", "Item", "Qtd.", "Profissional", "Valor com Desconto", "Do Pacote", "Data Venda", "Número Venda", "Unidade Venda", "Profissional Venda"],
  bloqueios: ["Data inicial", "Data final", "Hora inicial", "Hora final", "Profissional", "Titulo", "obs", "Serviço", "Periodo da semana"],
  espera: ["Data", "Cliente", "Telefone", "Profissional", "Serviço", "Obs", "Responsavel", "Responsavel última atualização", "Data Cadastro", "Última atualização"],
  cancelamentos: ["Data", "Cliente", "Telefone", "Profissional", "Serviço", "Valor total", "Obs", "Responsável Cancelamento", "Cancelamento", "Responsavel", "Data Cadastro"],
};

const profissionaisFile = () => sheet("profissionais.xlsx", [
  H.profissionais,
  [11, "MAIARA DA SILVA TESTE", "Cabeleireira", "000.000.000-00", "MAIARA", "Cortes", "CLT", "Profissional", "01/01/2025"],
  [12, "JOANA PEREIRA TESTE", "Manicure", "111.111.111-11", "JO", "", "", "", ""],
]);
const reservasFile = (status = "Agendado") => sheet("reservas.xlsx", [
  H.reservas,
  ["01/10/2026 10:00", "20/10/2026", "09:30", "Ana Teste (T. USO DE IMAGEM)", 71988880001, "05/03/2024", "ana@teste.com", "MAIARA", "Corte Feminino", "Interno", status, "trazer foto", "", "", "Recepção"],
  ["01/10/2026 10:05", "02/10/2026", "14:00", "Bia Teste", 71988880002, "", "", "JO", "Manicure", "Online", "Pago", "", "02/10/2026", 501, "Recepção"],
]);

beforeEach(async () => { await resetDb(); });

describe("applyAvecFile", () => {
  it("reserva com a coluna Tipo: Preferencial → escolhida, Sem Preferência → sem_preferencia, outro tipo fica sem informar (6.11)", async () => {
    const head = [...H.reservas, "Tipo"];
    const linha = (hora: string, cliente: string, tipo: string) => ["01/10/2026 10:00", "20/10/2026", hora, cliente, "", "", "", "MAIARA", "Corte Feminino", "Interno", "Agendado", "", "", "", "Recepção", tipo];
    await applyAvecFile(await sheet("reservas-tipo.xlsx", [head, linha("09:00", "Ana Teste", "Preferencial"), linha("10:00", "Bia Teste", "Sem Preferência"), linha("11:00", "Cris Teste", "Encaixe")]));
    const rows = await db.select({ name: appointments.clientName, preference: appointments.preference }).from(appointments).orderBy(appointments.startsAt);
    expect(rows).toEqual([{ name: "Ana Teste", preference: "escolhida" }, { name: "Bia Teste", preference: "sem_preferencia" }, { name: "Cris Teste", preference: null }]);
  });

  it("visita (17/10): a reserva já entra com a visita da cliente no dia (uma por cliente e dia); espera e cancelamento sem hora ficam de fora", async () => {
    const linha = (hora: string, servico: string, pro: string) => ["01/10/2026 10:00", "20/10/2026", hora, "Cris Teste", 71988880009, "", "", pro, servico, "Interno", "Agendado", "", "", "", "Recepção"];
    await applyAvecFile(await sheet("reservas-visita.xlsx", [H.reservas, linha("09:00", "Luzes e Mechas", "THAISE"), linha("09:00", "Coloração", "SIDNEY"), linha("14:00", "Escova", "MAIARA")]));
    await applyAvecFile(await sheet("espera.xlsx", [H.espera, ["20/10/2026", "Cris Teste", 71988880009, "THAISE", "Luzes e Mechas", "", "", "", "", ""]]));
    await applyAvecFile(await sheet("cancelamentos.xlsx", [H.cancelamentos, ["20/10/2026", "Cris Teste", 71988880009, "MAIARA", "Hidratação", "", "", "", "", "", ""]]));
    const rows = await db.select({ status: appointments.status, visitId: appointments.visitId, key: appointments.externalKey }).from(appointments);
    const reservas = rows.filter((r) => r.status === "agendado");
    expect(reservas).toHaveLength(3);
    expect(new Set(reservas.map((r) => r.visitId)).size).toBe(1);
    expect(reservas[0].visitId).not.toBeNull();
    expect(rows.filter((r) => r.status !== "agendado").map((r) => r.visitId)).toEqual([]); // o 0248 e o cancelamento sem par não gravam horário
    // Reimportar não cria outra visita.
    await applyAvecFile(await sheet("reservas-visita-2.xlsx", [H.reservas, linha("10:00", "Hidratação", "MAIARA")]));
    expect(new Set((await db.select({ visitId: appointments.visitId }).from(appointments).where(eq(appointments.status, "agendado"))).map((r) => r.visitId)).size).toBe(1);
  });

  it("profissionais: cadastra pelo apelido, com nome completo, cargo e ID do Avec; CPF não é guardado em lugar nenhum", async () => {
    const r = await applyAvecFile(await profissionaisFile());
    expect(r.title).toBe("Profissionais");
    expect(r.summary.profissionais).toBe(2);
    expect(r.summary.contatosNovos).toBe(0); // profissional não vira contato
    const pros = await db.select().from(professionals).orderBy(professionals.name);
    expect(pros.map((p) => [p.name, p.fullName, p.role, p.avecId])).toEqual([["JO", "JOANA PEREIRA TESTE", "Manicure", "12"], ["MAIARA", "MAIARA DA SILVA TESTE", "Cabeleireira", "11"]]);
    const [rep] = await db.select().from(avecReports);
    expect(rep.columns).not.toContain("CPF");
    expect(JSON.stringify(rep.rows)).not.toContain("000.000.000-00");
    expect(r.removedColumns).toEqual(["CPF"]);
  });

  it("profissional que já existe (cadastrada à mão) só ganha os campos vazios; o nome de tela não muda", async () => {
    await db.insert(professionals).values({ name: "Maiara" });
    await applyAvecFile(await profissionaisFile());
    const pros = await db.select().from(professionals);
    expect(pros.find((p) => p.avecId === "11")).toMatchObject({ name: "Maiara", fullName: "MAIARA DA SILVA TESTE" });
    expect(pros).toHaveLength(2);
  });

  it("reservas: contato pelo telefone, nome sem o parêntese, campo Uso de imagem, status mapeado, profissional e serviço ligados", async () => {
    await applyAvecFile(await profissionaisFile());
    await applyAvecFile(await sheet("cadastro-servicos.xlsx", [["Serviço", "Descrição", "Categoria", "Valor"], ["Corte Feminino", "", "Cabelo", 150]]));
    const r = await applyAvecFile(await reservasFile());
    expect(r.title).toBe("Reservas");
    expect(r.summary).toMatchObject({ contatosNovos: 2, agendamentos: 2, servicos: 0 });
    const [ana] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571988880001"));
    expect(ana).toMatchObject({ name: "Ana Teste", email: "ana@teste.com", isClient: false });
    expect(ana.clientSince?.toISOString().slice(0, 10)).toBe("2024-03-05");
    // 0081: o "(T. USO DE IMAGEM)" do Avec vira o campo Uso de imagem; a importação não cria mais a etiqueta.
    expect(ana.imageUse).toBe("sim");
    expect(await db.select().from(contactTags).where(eq(contactTags.contactId, ana.id))).toEqual([]);
    expect(await db.select().from(tags).where(eq(tags.name, "Uso de imagem"))).toEqual([]);
    const apps = await db.select().from(appointments).orderBy(appointments.startsAt);
    expect(apps.map((a) => [a.clientName, a.serviceLabel, a.status, a.startsAt.toISOString()])).toEqual([
      ["Bia Teste", "Manicure", "compareceu", "2026-10-02T17:00:00.000Z"],
      ["Ana Teste", "Corte Feminino", "agendado", "2026-10-20T12:30:00.000Z"],
    ]);
    const maiara = (await db.select().from(professionals).where(eq(professionals.name, "MAIARA")))[0];
    expect(apps[1]).toMatchObject({ contactId: ana.id, professionalId: maiara.id, notes: "trazer foto", createdByName: "Recepção", origin: "avec" });
    expect(apps[1].externalKey).toBe("avec:res:2026-10-20T09:30|ana teste|corte feminino");
    expect(apps[1].serviceId).not.toBeNull();
    // Pago = compareceu: a Bia vira cliente, com o atendimento como último
    const [bia] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571988880002"));
    expect(bia.isClient).toBe(true);
    expect(bia.lastServiceAt?.toISOString().slice(0, 10)).toBe("2026-10-02");
    // importar não mexe em leads
    expect(await db.select().from(deals)).toHaveLength(0);
  });

  it("importar o mesmo arquivo de novo não cria nem muda nada (e o relatório não é guardado 2x)", async () => {
    await applyAvecFile(await profissionaisFile());
    const first = await applyAvecFile(await reservasFile());
    const again = await applyAvecFile({ ...(await reservasFile()), fileName: "reservas (1).xlsx" });
    expect(first.newReport).toBe(true);
    expect(again.newReport).toBe(false);
    expect(again.reportId).toBe(first.reportId);
    expect(again.summary).toEqual(emptySummary());
    expect(await db.select().from(appointments)).toHaveLength(2);
    expect(await db.select().from(avecReports)).toHaveLength(2);
  });

  it("status só avança: relatório antigo (Agendado) não desfaz o novo (Pago); cancelado avança", async () => {
    await applyAvecFile(await reservasFile("Pago"));
    const back = await applyAvecFile(await reservasFile("Agendado"));
    expect(back.summary.agendamentos).toBe(0);
    const [a] = await db.select().from(appointments).where(eq(appointments.clientName, "Ana Teste"));
    expect(a.status).toBe("compareceu");
    const unknown = await applyAvecFile(await sheet("r.xlsx", [H.reservas, ["", "21/10/2026", "10:00", "Cris Teste", "", "", "", "", "Escova", "", "Aguardando sinal", "", "", "", ""]]));
    expect(unknown.summary.agendamentos).toBe(1);
    const [cris] = await db.select().from(appointments).where(eq(appointments.clientName, "Cris Teste"));
    expect(cris).toMatchObject({ status: "conferir", avecStatus: "Aguardando sinal", contactId: null }); // 17/10: desconhecido é neutro, não agendado
  });

  it("lista de clientes: nunca sobrescreve nome/e-mail preenchidos, completa os vazios e tira endereço/CPF/RG", async () => {
    await db.insert(contacts).values([
      { name: "Nome do CRM", phoneE164: "+5571988880003", email: "crm@teste.com" },
      { name: null, phoneE164: "+5571988880004" },
    ]);
    const r = await applyAvecFile(await sheet("clientes.xlsx", [
      H.clientes,
      ["Outro Nome", 1, "15/04/1990", "", 71988880003, "avec@teste.com", "F", "Instagram", "000.000.000-00", "40000-000", "Rua Teste", 45, "BA", "Salvador", "ap 1", "Centro", "", "10/01/2025", "", "99"],
      ["Dora Teste (T.USO DE IMAGEM)", 2, "02/09", 7133330000, 71988880004, "dora@teste.com", "F", "", "", "", "", "", "", "", "", "", "", "11/02/2025", "", ""],
      ["Eva Teste", 3, "", "", 71988880005, "", "F", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]));
    expect(r.summary).toMatchObject({ contatosNovos: 1, contatosCompletados: 2 });
    const all = await db.select().from(contacts).orderBy(contacts.phoneE164);
    expect(all.map((c) => [c.name, c.email, c.birthDay, c.birthMonth, c.birthYear, c.isClient])).toEqual([
      ["Nome do CRM", "crm@teste.com", 15, 4, 1990, false],
      ["Dora Teste", "dora@teste.com", 2, 9, null, false],
      ["Eva Teste", null, null, null, null, false],
    ]);
    const [rep] = await db.select().from(avecReports);
    for (const c of ["CPF", "RG", "CEP", "Endereço", "Número", "Estado", "Cidade", "Complemento", "Bairro"]) expect(rep.columns).not.toContain(c);
    expect(JSON.stringify(rep.rows)).not.toMatch(/Rua Teste|40000-000|Salvador/);
    expect((await applyAvecFile(await sheet("clientes.xlsx", [H.clientes, ["Eva Teste", 3, "", "", 71988880005, "", "F", "", "", "", "", "", "", "", "", "", "", "", "", ""]]))).summary.contatosCompletados).toBe(0);
  });

  it("itens de comanda: profissional pelo nome completo, serviço com categoria, cliente vira cliente; preço = valor que mais se repete", async () => {
    await applyAvecFile(await profissionaisFile());
    await applyAvecFile(await sheet("cadastro-servicos.xlsx", [["Serviço", "Descrição", "Categoria", "Valor"], ["Corte Feminino", "", "", ""]])); // no cadastro, sem preço
    const r = await applyAvecFile(await sheet("itens.xlsx", [
      H.itens,
      ["01/10/2026", 1001, "Corte Feminino", "Serviço", "Cabelo", "MAIARA DA SILVA TESTE", "", "", 40, "Ana Teste", "", "", 71988880001, 150, 0, 1, 0, 60, 90, "2026-10-01 10:28:39"],
      ["01/10/2026", 1001, "Shampoo Teste", "Produto", "Revenda", "MAIARA DA SILVA TESTE", "", "", 10, "Ana Teste", "", "", 71988880001, 80, 10, 1, 30, 8, 42, "2026-10-01 10:28:39"],
      ["03/10/2026", 1002, "Corte Feminino", "Serviço", "Cabelo", "MAIARA DA SILVA TESTE", "", "", 40, "Bia Teste", "", "", 71988880002, 150, 0, 1, 0, 60, 90, ""],
      ["04/10/2026", 1003, "Corte Feminino", "Serviço", "Cabelo", "MAIARA DA SILVA TESTE", "", "", 40, "Cris Teste", "", "", "", 120, 0, 1, 0, 48, 72, ""],
    ]));
    expect(r.summary).toMatchObject({ itensVenda: 4, contatosNovos: 2 });
    const items = await db.select().from(salesItems).orderBy(salesItems.soldOn, salesItems.item);
    const maiara = (await db.select().from(professionals).where(eq(professionals.name, "MAIARA")))[0];
    expect(items[0]).toMatchObject({ item: "Corte Feminino", kind: "servico", category: "Cabelo", professionalId: maiara.id, valueCents: 15000, comanda: "1001", soldOn: "2026-10-01" });
    expect(items[1]).toMatchObject({ item: "Shampoo Teste", kind: "produto", discountCents: 1000 });
    const [corte] = await db.select().from(lists).where(eq(lists.label, "Corte Feminino"));
    expect(corte).toMatchObject({ kind: "service", category: "Cabelo", priceCents: 15000 });
    expect((await db.select().from(lists).where(eq(lists.label, "Shampoo Teste")))).toHaveLength(0); // produto não vira serviço
    const [ana] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571988880001"));
    expect(ana.isClient).toBe(true);
    expect(ana.lastServiceAt?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("total do item = valor − desconto: no Avec o Valor já é o total da linha (Corte, Qtd. 2, R$ 300, Líquido 300; mega hair em gramas)", async () => {
    await applyAvecFile(await sheet("itens.xlsx", [H.itens, ["01/10/2026", 1001, "Corte", "Serviço", "Cabelo", "", "", "", 0, "Ana Teste", "", "", 71988880001, 300, 20, 2, 0, 0, 280, ""]]));
    const [i] = await db.select().from(salesItems);
    expect([i.valueCents, i.discountCents, Number(i.qty), i.totalCents]).toEqual([30000, 2000, 2, 28000]);
  });

  it("o mesmo item visto por outro relatório (sem profissional) não duplica", async () => {
    await applyAvecFile(await sheet("itens.xlsx", [H.itens, ["01/10/2026", 1001, "Corte Feminino", "Serviço", "Cabelo", "MAIARA DA SILVA TESTE", "", "", 40, "Ana Teste", "", "", 71988880001, 150, 0, 1, 0, 60, 90, ""]]));
    const r = await applyAvecFile(await sheet("servicos-cliente.xlsx", [H.itensSemProf, ["Ana Teste", "01/10/2026", 1001, "CORTE FEMININO", 150, 0, 1]]));
    expect(r.summary.itensVenda).toBe(0);
    expect(await db.select().from(salesItems)).toHaveLength(1);
  });

  it("itens de comanda trazem a comissão do Avec (% e valor); importar de novo completa a linha antiga sem comissão", async () => {
    const linha = ["01/10/2026", 1001, "Corte Feminino", "Serviço", "Cabelo", "MAIARA DA SILVA TESTE", "", "", 40, "Ana Teste", "", "", 71988880001, 150, 0, 1, 0, 60, 90, ""];
    await applyAvecFile(await sheet("itens.xlsx", [H.itens, linha]));
    const [a] = await db.select().from(salesItems);
    expect([a.commissionPct, a.commissionCents]).toEqual([40, 6000]);
    await db.update(salesItems).set({ commissionPct: null, commissionCents: null }); // como as linhas importadas antes do Lote 3
    await applyAvecFile(await sheet("itens.xlsx", [H.itens, linha]));
    const all = await db.select().from(salesItems);
    expect(all).toHaveLength(1);
    expect([all[0].commissionPct, all[0].commissionCents]).toEqual([40, 6000]);
  });

  it("serviço só nasce do cadastro de serviços; reserva e comanda com nome que não está no cadastro guardam o texto, sem criar serviço", async () => {
    await applyAvecFile(await sheet("cadastro-servicos.xlsx", [["Serviço", "Descrição", "Categoria", "Valor"], ["Corte Feminino", "", "Cabelo", 150]]));
    await applyAvecFile(await reservasFile());
    await applyAvecFile(await sheet("itens.xlsx", [H.itens, ["01/10/2026", 1001, "progressiva organica 340", "Serviço", "Cabelo", "", "", "", 0, "Ana Teste", "", "", 71988880001, 340, 0, 1, 0, 0, 340, ""]]));
    const svc = await db.select().from(lists).where(eq(lists.kind, "service"));
    const corte = svc.find((x) => x.label === "Corte Feminino")!;
    expect([corte.priceCents, corte.category]).toEqual([15000, "Cabelo"]);
    expect(svc.map((x) => x.label)).not.toContain("Manicure");
    expect(svc.map((x) => x.label)).not.toContain("progressiva organica 340");
    const ap = await db.select().from(appointments).orderBy(appointments.startsAt);
    expect(ap.map((a) => [a.serviceLabel, a.serviceId === corte.id, a.serviceId === null])).toEqual([["Manicure", false, true], ["Corte Feminino", true, false]]);
  });

  it("profissional do cadastro fica ativa; nome que só aparece no histórico (agenda antiga, bloqueio) entra inativa", async () => {
    await applyAvecFile(await profissionaisFile());
    await applyAvecFile(await sheet("bloqueios.xlsx", [H.bloqueios, ["01/02/2021", "01/02/2021", "09:00", "18:00", "ANTIGA TESTE", "Folga", "", "", ""]]));
    const pros = await db.select().from(professionals).orderBy(professionals.name);
    expect(pros.map((p) => [p.name, p.active])).toEqual([["ANTIGA TESTE", false], ["JO", true], ["MAIARA", true]]);
  });

  it("relatório de comissão (lista histórica com apelido e cargo) não deixa ex-profissional ativa; só o cadastro de profissionais ativa", async () => {
    await applyAvecFile(await profissionaisFile());
    await applyAvecFile(await sheet("comissao.xlsx", [["Profissional", "Apelido", "Cargo", "Comissão Total"], ["ANTIGA DA SILVA TESTE", "ANTIGA", "Cabeleireiro", 1000], ["MAIARA DA SILVA TESTE", "MAIARA", "Cabeleireira", 500]]));
    const pros = await db.select().from(professionals).orderBy(professionals.name);
    expect(pros.map((p) => [p.name, p.active])).toEqual([["ANTIGA", false], ["JO", true], ["MAIARA", true]]);
  });

  it("contato que já estava com '(T. USO DE IMAGEM)' no nome (cadastro antigo) fica com o nome limpo e o campo Uso de imagem", async () => {
    const [c] = await db.insert(contacts).values({ name: "Maria Sol Teste (T. USO DE IMAGEM)", phoneE164: "+5571988880077" }).returning();
    await applyAvecFile(await reservasFile());
    const [after] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(after.name).toBe("Maria Sol Teste");
    expect(after.imageUse).toBe("sim");
    expect(await db.select().from(contactTags).where(eq(contactTags.contactId, c.id))).toEqual([]);
  });

  it("nome '(T. USO DE IMAGEM)' do Avec vira image_use 'sim' e não cria a etiqueta; quem já estava 'nao' no CRM não muda", async () => {
    const [dora] = await db.insert(contacts).values({ name: "Ana Teste", phoneE164: "+5571988880001", imageUse: "nao" }).returning();
    await applyAvecFile(await reservasFile());
    const [after] = await db.select().from(contacts).where(eq(contacts.id, dora.id));
    expect(after.imageUse).toBe("nao");
    const [bia] = await db.select().from(contacts).where(eq(contacts.name, "Bia Teste"));
    expect(bia?.imageUse ?? null).toBeNull();
    expect(await db.select().from(tags).where(eq(tags.name, "Uso de imagem"))).toEqual([]);
  });

  it("cliente sem telefone: casa pelo nome só se houver exatamente uma", async () => {
    const [rita] = await db.insert(contacts).values({ name: "Rita Teste (VIP)", phoneE164: "+5571988880010" }).returning();
    await db.insert(contacts).values([{ name: "Sol Teste", phoneE164: "+5571988880011" }, { name: "sol  teste", phoneE164: "+5571988880012" }]);
    await applyAvecFile(await sheet("itens.xlsx", [
      H.itens,
      ["05/10/2026", 2001, "Escova", "Serviço", "Cabelo", "", "", "", 0, "Rita Teste", "", "", "", 60, 0, 1, 0, 0, 60, ""],
      ["05/10/2026", 2002, "Escova", "Serviço", "Cabelo", "", "", "", 0, "Sol Teste", "", "", "", 60, 0, 1, 0, 0, 60, ""],
    ]));
    const items = await db.select().from(salesItems).orderBy(salesItems.comanda);
    expect(items.map((i) => i.contactId)).toEqual([rita.id, null]);
    expect(items[1].clientName).toBe("Sol Teste");
  });

  it("pagamentos: CPF fora, dois pagamentos iguais na mesma comanda contam como dois, e reimportar não duplica", async () => {
    const file = await sheet("pagamentos.xlsx", [
      H.pagamentos,
      ["01/10/2026", 1001, "Ana Teste", "000.000.000-00", 100, "Cartão de Crédito", "Visa", "01/10/2026", "Caixa 1", "01/10/2026 08:00"],
      ["01/10/2026", 1001, "Ana Teste", "000.000.000-00", 100, "Cartão de Crédito", "Visa", "01/10/2026", "Caixa 1", "01/10/2026 08:00"],
      ["01/10/2026", 1001, "Ana Teste", "000.000.000-00", 30, "Pix", "", "01/10/2026", "Caixa 1", "01/10/2026 08:00"],
    ]);
    expect((await applyAvecFile(file)).summary.pagamentos).toBe(3);
    expect((await applyAvecFile(file)).summary.pagamentos).toBe(0);
    const pays = await db.select().from(salesPayments).orderBy(salesPayments.valueCents);
    expect(pays.map((p) => [p.method, p.valueCents, p.comanda, p.paidOn])).toEqual([
      ["Pix", 3000, "1001", "2026-10-01"], ["Cartão de Crédito (Visa)", 10000, "1001", "2026-10-01"], ["Cartão de Crédito (Visa)", 10000, "1001", "2026-10-01"],
    ]);
    const [rep] = await db.select().from(avecReports);
    expect(rep.columns).not.toContain("CPF");
  });

  it("pacotes e uso de sessões: sessões usadas só avançam; o uso é ligado ao pacote da cliente", async () => {
    await applyAvecFile(await sheet("clientes.xlsx", [H.clientes, ["Ana Teste", 1, "", "", 71988880001, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]));
    const pk = (used: number) => sheet(`pacotes-${used}.xlsx`, [H.pacotes, ["Ana Teste", "Pacote Hidratação 5x", "Hidratação", 5, used, 400, "31/03/2027", "01/09/2026"]]);
    expect((await applyAvecFile(await pk(2))).summary.pacotes).toBe(1);
    expect((await applyAvecFile(await pk(1))).summary.pacotes).toBe(0);
    expect((await applyAvecFile(await pk(3))).summary.pacotes).toBe(1);
    const [p] = await db.select().from(clientPackages);
    expect(p).toMatchObject({ packageName: "Pacote Hidratação 5x", serviceLabel: "Hidratação", totalSessions: 5, usedSessions: 3, priceCents: 40000, validUntil: "2027-03-31", purchasedOn: "2026-09-01" });
    expect(p.contactId).not.toBeNull();
    const r = await applyAvecFile(await sheet("uso.xlsx", [H.usos, ["10/10/2026", 3001, "Ana Teste", "Hidratação", 1, "MAIARA", 0, "Pacote Hidratação 5x", "01/09/2026", 900, "Casa", "JO"]]));
    expect(r.summary.usosPacote).toBe(1);
    const [u] = await db.select().from(packageUses);
    expect(u).toMatchObject({ clientPackageId: p.id, contactId: p.contactId, usedOn: "2026-10-10", comanda: "3001", professionalName: "MAIARA" });
  });

  it("bloqueios: dias da semana ('Terça,'), profissional pelo apelido e reimportar não duplica", async () => {
    await applyAvecFile(await profissionaisFile());
    const file = await sheet("bloqueios.xlsx", [
      H.bloqueios,
      ["01/10/2026", "31/12/2026", "12:00", "13:00", "MAIARA", "Almoço", "", "", "Terça,"],
      ["15/10/2026", "15/10/2026", "08:00", "18:00", "JO", "Folga", "médico", "", ""],
    ]);
    expect((await applyAvecFile(file)).summary.bloqueios).toBe(2);
    expect((await applyAvecFile(file)).summary.bloqueios).toBe(0);
    const blocks = await db.select().from(agendaBlocks).orderBy(agendaBlocks.startsOn);
    expect(blocks.map((b) => [b.title, b.startsOn, b.endsOn, b.startTime, b.endTime, b.weekdays, b.notes])).toEqual([
      ["Almoço", "2026-10-01", "2026-12-31", "12:00", "13:00", [2], null], ["Folga", "2026-10-15", "2026-10-15", "08:00", "18:00", null, "médico"],
    ]);
    expect(blocks.every((b) => b.professionalId)).toBe(true);
  });

  it("0248 (Agendado no Avec) não cria horário nem espera: marca a reserva que bate (cliente, dia, profissional, serviço) como sem baixa no Avec", async () => {
    await applyAvecFile(await reservasFile());
    const antes = await db.select().from(appointments);
    const linha = (dia: string, cliente: string, fone: number, pro: string, servico: string) => [dia, cliente, fone, pro, servico, "", "Recepção", "", "", ""];
    const w = await applyAvecFile(await sheet("agendados.xlsx", [H.espera,
      linha("20/10/2026", "Ana Teste", 71988880001, "MAIARA", "Corte Feminino"), // a reserva das 09:30: par seguro
      linha("25/10/2026", "Fe Teste", 71988880009, "MAIARA", "Coloração"), // sem reserva: não cria nada
    ]));
    expect(w.summary).toMatchObject({ agendamentos: 0, semBaixa: 1 });
    const depois = await db.select().from(appointments);
    expect(depois).toHaveLength(antes.length);
    expect(depois.filter((a) => a.status === "espera")).toHaveLength(0);
    expect(depois.filter((a) => a.avecUnclosedAt).map((a) => a.externalKey)).toEqual(["avec:res:2026-10-20T09:30|ana teste|corte feminino"]);
    // O 0248 seguinte (do mesmo período) sem ela: o sinal sai.
    await applyAvecFile(await sheet("agendados-2.xlsx", [H.espera, linha("20/10/2026", "Outra Pessoa", 71988880007, "MAIARA", "Escova")]));
    expect((await db.select().from(appointments)).filter((a) => a.avecUnclosedAt)).toHaveLength(0);
  });

  it("cancelamento sem hora cancela a reserva do mesmo dia, cliente e serviço", async () => {
    await applyAvecFile(await reservasFile());
    const c = await applyAvecFile(await sheet("cancel.xlsx", [H.cancelamentos, ["20/10/2026", "Ana Teste (T. USO DE IMAGEM)", 71988880001, "MAIARA", "Corte Feminino", 150, "", "Recepção", "05/10/2026", "Recepção", ""]]));
    expect(c.summary.agendamentos).toBe(1);
    const ana = await db.select().from(appointments).where(eq(appointments.clientName, "Ana Teste"));
    expect(ana.map((a) => [a.status, a.startsAt.toISOString()])).toEqual([["cancelado", "2026-10-20T12:30:00.000Z"]]);
  });
});

describe("applyAvecFiles", () => {
  it("6B: reserva que já existe no CRM vira gêmea do horário do CRM", async () => {
    const [c] = await db.insert(contacts).values({ name: "Ana Teste", phoneE164: "+5571988880001" }).returning();
    const [crm] = await db.insert(appointments).values({ contactId: c.id, serviceLabel: "Corte Feminino", startsAt: new Date("2026-10-20T12:30:00Z"), status: "agendado", origin: "crm", externalKey: "crm:teste", crmTouchedAt: new Date() }).returning();
    await applyAvecFiles([await reservasFile()]);
    const [avec] = await db.select().from(appointments).where(eq(appointments.externalKey, "avec:res:2026-10-20T09:30|ana teste|corte feminino"));
    expect(avec.avecTwinOf).toBe(crm.id);
  });

  it("profissionais e serviços primeiro, depois contatos, depois o resto; soma o resumo; arquivo vazio volta com erro sem parar o lote", async () => {
    const res = await applyAvecFiles([
      await sheet("itens.xlsx", [H.itens, ["01/10/2026", 1001, "Corte Feminino", "Serviço", "Cabelo", "MAIARA DA SILVA TESTE", "", "", 40, "Ana Teste", "", "", 71988880001, 150, 0, 1, 0, 60, 90, ""]]),
      { fileName: "vazio.xlsx", rows: [] },
      await profissionaisFile(),
    ]);
    expect(res.files.map((f) => f.fileName)).toEqual(["profissionais.xlsx", "itens.xlsx", "vazio.xlsx"]);
    expect(res.files[2].error).toMatch(/vazio/);
    const [item] = await db.select().from(salesItems);
    expect(item.professionalId).not.toBeNull();
    expect(res.summary).toMatchObject({ profissionais: 2, itensVenda: 1, contatosNovos: 1 });
  });

  it("cancelamento enviado antes das reservas não duplica o horário; uso de pacote enviado antes dos pacotes fica ligado ao pacote", async () => {
    await applyAvecFiles([
      await sheet("uso.xlsx", [H.usos, ["10/10/2026", 3001, "Ana Teste", "Hidratação", 1, "MAIARA", 0, "Pacote Hidratação 5x", "01/09/2026", 900, "Casa", "JO"]]),
      await sheet("cancel.xlsx", [H.cancelamentos, ["20/10/2026", "Ana Teste (T. USO DE IMAGEM)", 71988880001, "MAIARA", "Corte Feminino", 150, "", "Recepção", "05/10/2026", "Recepção", ""]]),
      await sheet("pacotes.xlsx", [H.pacotes, ["Ana Teste", "Pacote Hidratação 5x", "Hidratação", 5, 1, 400, "31/03/2027", "01/09/2026"]]),
      await reservasFile(),
    ]);
    const ana = await db.select().from(appointments).where(eq(appointments.clientName, "Ana Teste"));
    expect(ana.map((a) => [a.status, a.startsAt.toISOString()])).toEqual([["cancelado", "2026-10-20T12:30:00.000Z"]]);
    const [p] = await db.select().from(clientPackages);
    const [u] = await db.select().from(packageUses);
    expect(u.clientPackageId).toBe(p.id);
  });
});

describe("várias pessoas no mesmo número (0051): mãe e filha no mesmo celular", () => {
  const reserva = (cliente: string, dia: string, celular: number) => ["01/10/2026 10:00", dia, "09:30", cliente, celular, "", "", "MAIARA", "Corte Feminino", "Interno", "Agendado", "", "", "", "Recepção"];

  it("reservas com dois nomes no mesmo celular: a segunda vira pessoa a mais do número, com os horários dela; reimportar não duplica", async () => {
    const file = () => sheet("reservas.xlsx", [H.reservas, reserva("Marta Teste", "20/10/2026", 71988880011), reserva("Bruna Teste", "21/10/2026", 71988880011), reserva("MARTA TESTE", "22/10/2026", 71988880011)]);
    const r = await applyAvecFile(await file());
    expect(r.summary).toMatchObject({ contatosNovos: 2, agendamentos: 3 });
    const [mae] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571988880011"));
    const [filha] = await db.select().from(contacts).where(eq(contacts.sharesPhoneWith, mae.id));
    expect([mae.name, filha.name]).toEqual(["Marta Teste", "Bruna Teste"]);
    const apps = await db.select().from(appointments).orderBy(appointments.startsAt);
    expect(apps.map((a) => a.contactId)).toEqual([mae.id, filha.id, mae.id]);
    expect((await applyAvecFile(await file())).summary).toMatchObject({ contatosNovos: 0, agendamentos: 0 });
    expect(await db.select().from(contacts)).toHaveLength(2);
  });

  it("lista de clientes: a filha ganha ficha com os dados DELA; os dela nunca completam a da mãe", async () => {
    await db.insert(contacts).values({ name: "Marta Teste", phoneE164: "+5571988880012" });
    await applyAvecFile(await sheet("clientes.xlsx", [
      H.clientes,
      ["Bruna Teste", 7, "14/11/2005", "", 71988880012, "bruna@teste.com", "F", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["Marta Teste", 8, "15/04/1970", "", 71988880012, "", "F", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]));
    const [mae] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571988880012"));
    const [filha] = await db.select().from(contacts).where(eq(contacts.sharesPhoneWith, mae.id));
    expect([mae.name, mae.email, mae.birthDay, mae.birthMonth]).toEqual(["Marta Teste", null, 15, 4]);
    expect([filha.name, filha.email, filha.birthDay, filha.birthMonth, filha.birthYear]).toEqual(["Bruna Teste", "bruna@teste.com", 14, 11, 2005]);
  });

  it("ficha com o nome do WhatsApp (que não é nenhum nome do Avec): na dúvida, tudo fica nela, como antes", async () => {
    await db.insert(contacts).values({ name: "Mãezinha 💕", phoneE164: "+5571988880013" });
    await applyAvecFile(await sheet("reservas.xlsx", [H.reservas, reserva("Rita Teste", "20/10/2026", 71988880013), reserva("Joana Teste", "21/10/2026", 71988880013)]));
    expect(await db.select().from(contacts)).toHaveLength(1);
    const [c] = await db.select().from(contacts);
    expect((await db.select().from(appointments)).every((a) => a.contactId === c.id)).toBe(true);
  });
});

describe("(completar cadastro) sai do nome e vira etiqueta (17/10)", () => {
  it("contato antigo com o sufixo: nome limpo, etiqueta, recado na observação, auditoria; reimportar não devolve", async () => {
    const { auditLog } = await import("../../db/schema");
    const [velho] = await db.insert(contacts).values({ name: "JOANA SOUZA (MÃE AMIGA - COMPLETAR CADASTRO)", phoneE164: "+5571988880077", notes: "cliente antiga" }).returning();
    const [novo] = await db.insert(contacts).values({ name: "MARIA LIMA COMPLETAR", phoneE164: "+5571988880078" }).returning();
    const reservas = () => sheet("r.xlsx", [H.reservas,
      ["01/10/2026 10:00", "20/10/2026", "09:30", "JOANA SOUZA (COMPLETAR CADASTRO)", 71988880077, "", "", "MAIARA", "Corte", "Interno", "Agendado", "", "", "", "Recepção"],
      ["01/10/2026 10:00", "20/10/2026", "10:30", "PAULA NOVA (COMPLETAR CADASTRO)", 71988880079, "", "", "MAIARA", "Corte", "Interno", "Agendado", "", "", "", "Recepção"]]);
    await applyAvecFile(await reservas());
    const c = async (id: string) => (await db.select().from(contacts).where(eq(contacts.id, id)))[0];
    expect(await c(velho.id)).toMatchObject({ name: "JOANA SOUZA", notes: "cliente antiga\nDo Avec: MÃE AMIGA" });
    expect((await c(novo.id)).name).toBe("MARIA LIMA");
    const tagged = await db.select({ contactId: contactTags.contactId }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(tags.name, "Completar cadastro"));
    expect(tagged.length).toBe(3); // Joana e Maria (sufixo no CRM) e Paula (o Reservas traz celular: virou contato já com a etiqueta)
    expect((await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571988880079")))[0].name).toBe("PAULA NOVA");
    expect((await db.select().from(auditLog)).filter((l) => l.action === "corrigiu_nome")).toHaveLength(2);
    await applyAvecFile(await reservas());
    expect((await c(velho.id)).name).toBe("JOANA SOUZA");
  });
});
