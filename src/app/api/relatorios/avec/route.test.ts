import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { avecReports, contacts, profiles, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { buildXlsx } from "@/server/domain/avec/xlsx";
import { resetDb } from "../../../../../test/db";
import { getAvecReport, getAvecReportTable } from "@/server/queries/avec";
import { POST } from "./route";
import { GET as getExcel } from "./[id]/excel/route";
import { GET as getPdf } from "./[id]/pdf/route";

// O Chromium não roda nos testes: o PDF é trocado por um falso, e o teste confere o que foi pedido a ele.
const renderPagePdf = vi.hoisted(() => vi.fn(async () => Buffer.from("%PDF-1.7 falso")));
vi.mock("@/server/reports/pdf", async (orig) => ({ ...(await orig<typeof import("@/server/reports/pdf")>()), renderPagePdf }));

// Planilhas SINTÉTICAS (nomes e telefones inventados), com cabeçalhos no formato do Avec.
const CLIENTES = ["Cliente", "Código", "Aniversário", "Telefone", "Celular", "E-mail", "CPF", "CEP", "Endereço", "Número", "Bairro", "Cadastrado"];
const clientesXlsx = () => buildXlsx([
  CLIENTES,
  ["Ana Teste", 1, "05/03", "", 71988880001, "ana@teste.com", "000.000.000-00", "40000-000", "Rua Inventada", 10, "Centro", "01/10/2026"],
  ["Bia Teste", 2, "", "", 71988880002, "", "111.111.111-11", "", "", "", "", "14/10/2026"],
]);

const profileId = async (key: string) => (await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, key)))[0].id;
async function cookie(key: "gestao" | "atendente", email = `${key}@teste.local`) {
  const [u] = await db.insert(users).values({ name: key === "gestao" ? "Gestora Teste" : "Atendente Teste", email, passwordHash: "x", profileId: await profileId(key) }).returning();
  return { id: u.id, cookie: `cf_session=${(await insertSession(u.id)).token}` };
}
async function upload(c: string | null, files: { name: string; data: Uint8Array | string }[]) {
  const fd = new FormData();
  for (const f of files) fd.append("files", new File([typeof f.data === "string" ? f.data : new Uint8Array(f.data)], f.name));
  return POST(new NextRequest("http://localhost/api/relatorios/avec", { method: "POST", body: fd, headers: c ? { cookie: c } : {} }));
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (path: string, c: string | null) => new NextRequest(`http://localhost${path}`, { headers: c ? { cookie: c } : {} });

beforeEach(async () => { await resetDb(); renderPagePdf.mockClear(); });

describe("POST /api/relatorios/avec (Enviar relatórios do Avec)", () => {
  it("sem sessão: 401; atendente: 403 e nada é gravado", async () => {
    expect((await upload(null, [{ name: "clientes.xlsx", data: await clientesXlsx() }])).status).toBe(401);
    const { cookie: c } = await cookie("atendente");
    const res = await upload(c, [{ name: "clientes.xlsx", data: await clientesXlsx() }]);
    expect(res.status).toBe(403);
    expect(await db.select().from(avecReports)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  it("gestão envia vários: aplica, devolve o resumo, tira CPF/endereço; arquivo estragado não para os outros; reenviar não duplica", async () => {
    const { id, cookie: c } = await cookie("gestao");
    const res = await upload(c, [{ name: "clientes.xlsx", data: await clientesXlsx() }, { name: "estragado.xlsx", data: "isto não é xlsx" }]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.contatosNovos).toBe(2);
    const ok = body.files.find((f: { fileName: string }) => f.fileName === "clientes.xlsx");
    expect(ok).toMatchObject({ rowCount: 2, newReport: true });
    expect(ok.error).toBeUndefined();
    expect(ok.removedColumns).toEqual(expect.arrayContaining(["CPF", "CEP", "Endereço", "Número", "Bairro"]));
    expect(body.files.find((f: { fileName: string }) => f.fileName === "estragado.xlsx").error).toMatch(/Não deu para abrir/);
    const [rep] = await db.select().from(avecReports);
    expect(rep.importedBy).toBe(id);
    expect(JSON.stringify(rep.rows)).not.toContain("000.000.000-00");

    const again = await (await upload(c, [{ name: "clientes (1).xlsx", data: await clientesXlsx() }])).json();
    expect(again.summary.contatosNovos).toBe(0);
    expect(again.files[0].newReport).toBe(false);
    expect(await db.select().from(avecReports)).toHaveLength(1);
  });

  it("envio vindo de outro site (Origin diferente) é recusado", async () => {
    const { cookie: c } = await cookie("gestao");
    const fd = new FormData();
    fd.append("files", new File([new Uint8Array(await clientesXlsx())], "clientes.xlsx"));
    const res = await POST(new NextRequest("http://localhost/api/relatorios/avec", { method: "POST", body: fd, headers: { cookie: c, origin: "https://outro-site.example", host: "localhost" } }));
    expect(res.status).toBe(403);
    expect(await db.select().from(avecReports)).toHaveLength(0);
  });

  it("recusa o que não é .xlsx antes de ler", async () => {
    const { cookie: c } = await cookie("gestao");
    const res = await upload(c, [{ name: "clientes.csv", data: "Cliente;Celular" }]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/não é \.xlsx/);
  });
});

describe("Baixar Excel e PDF de um relatório guardado", () => {
  async function stored() {
    const { cookie: c } = await cookie("gestao");
    const body = await (await upload(c, [{ name: "clientes.xlsx", data: await clientesXlsx() }])).json();
    return { gestao: c, reportId: body.files[0].reportId as string };
  }

  it("Excel: atendente recebe 403; gestão baixa um .xlsx que abre, com a tabela saneada e nome legível", async () => {
    const { gestao, reportId } = await stored();
    const { cookie: atendente } = await cookie("atendente");
    expect((await getExcel(get(`/api/relatorios/avec/${reportId}/excel`, atendente), ctx(reportId))).status).toBe(403);
    expect((await getExcel(get(`/api/relatorios/avec/${reportId}/excel`, null), ctx(reportId))).status).toBe(401);

    const res = await getExcel(get(`/api/relatorios/avec/${reportId}/excel`, gestao), ctx(reportId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="Avec - [^"]+\.xlsx"; filename\*=UTF-8''/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.worksheets[0];
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(["Cliente", "Código", "Aniversário", "Telefone", "Celular", "E-mail", "Cadastrado"]);
    expect(ws.getRow(2).getCell(1).value).toBe("Ana Teste");
    expect(ws.getRow(2).getCell(5).value).toBe("71988880001"); // telefone fica texto (não vira 7,19E+10)
    expect(ws.rowCount).toBe(3);
  });

  it("fichas (0115/0116): o relatório guardado não tem a coluna Valor; tela, Excel e PDF não trazem a resposta da cliente", async () => {
    const { cookie: c } = await cookie("gestao");
    await db.insert(contacts).values({ name: "Ana Teste", phoneE164: "+5571900000001" });
    const MARCADOR = "RESPOSTA-SECRETA-123";
    const xlsx = await buildXlsx([["Cliente", "Campo", "Slug", "Valor", "Data Cadastro"], ["Ana Teste", "Pergunta qualquer", "p", MARCADOR, "05/10/2026"]]);
    const body = await (await upload(c, [{ name: "anamnese.xlsx", data: xlsx }])).json();
    const reportId = body.files[0].reportId as string;
    expect(body.files[0]).toMatchObject({ rowCount: 1, newReport: true });
    expect(body.summary.fichas).toBe(0); // a pergunta não existe na anamnese: nada gravado, mas o arquivo foi lido como ficha
    const [rep] = await db.select().from(avecReports);
    expect(JSON.stringify([rep.columns, rep.rows, rep.applied])).not.toContain(MARCADOR);
    expect(rep.columns).toEqual(["Cliente", "Campo", "Slug", "Data Cadastro"]);
    expect(JSON.stringify(await getAvecReportTable(reportId))).not.toContain(MARCADOR); // a página de impressão (PDF) lê daqui
    const page = await getAvecReport(reportId);
    expect(JSON.stringify(page)).not.toContain(MARCADOR);
    const res = await getExcel(get(`/api/relatorios/avec/${reportId}/excel`, c), ctx(reportId));
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(JSON.stringify(wb.worksheets[0].getSheetValues())).not.toContain(MARCADOR);
    expect((wb.worksheets[0].getRow(1).values as unknown[]).slice(1)).not.toContain("Valor");
    // a mesma planilha de novo continua sendo reconhecida como já guardada
    expect((await (await upload(c, [{ name: "anamnese (1).xlsx", data: xlsx }])).json()).files[0].newReport).toBe(false);
  });

  it("Excel: quem vê Relatórios mas não exporta recebe 403; relatório que não existe, 404", async () => {
    const { reportId } = await stored();
    const [p] = await db.insert(profiles).values({ key: "so-ver", name: "Só ver", permissions: ["relatorios.ver", "relatorios.equipe"] }).returning();
    const [u] = await db.insert(users).values({ name: "Só Ver", email: "so@teste.local", passwordHash: "x", profileId: p.id }).returning();
    const c = `cf_session=${(await insertSession(u.id)).token}`;
    expect((await getExcel(get(`/api/relatorios/avec/${reportId}/excel`, c), ctx(reportId))).status).toBe(403);
    const { cookie: g } = await cookie("gestao", "g2@teste.local");
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await getExcel(get(`/api/relatorios/avec/${missing}/excel`, g), ctx(missing))).status).toBe(404);
    expect((await getExcel(get("/api/relatorios/avec/xyz/excel", g), ctx("xyz"))).status).toBe(404);
  });

  it("perfil que vê Relatórios e exporta, mas não vê valores (ou só os próprios números), não envia nem baixa: o Avec traz valores de todo mundo", async () => {
    const { reportId } = await stored();
    for (const [key, permissions] of [["sem-valores", ["relatorios.ver", "relatorios.equipe", "relatorios.exportar"]], ["so-meus", ["relatorios.ver", "relatorios.exportar", "valores.ver"]]] as const) {
      const [p] = await db.insert(profiles).values({ key, name: key, permissions: [...permissions] }).returning();
      const [u] = await db.insert(users).values({ name: key, email: `${key}@teste.local`, passwordHash: "x", profileId: p.id }).returning();
      const c = `cf_session=${(await insertSession(u.id)).token}`;
      expect((await getExcel(get(`/api/relatorios/avec/${reportId}/excel`, c), ctx(reportId))).status, key).toBe(403);
      expect((await getPdf(get(`/api/relatorios/avec/${reportId}/pdf`, c), ctx(reportId))).status, key).toBe(403);
      expect((await upload(c, [{ name: "clientes.xlsx", data: await clientesXlsx() }])).status, key).toBe(403);
    }
    expect(renderPagePdf).not.toHaveBeenCalled();
  });

  it("PDF: atendente recebe 403 sem gerar nada; gestão recebe o PDF da página de impressão do Avec, em paisagem", async () => {
    const { gestao, reportId } = await stored();
    const { cookie: atendente } = await cookie("atendente");
    expect((await getPdf(get(`/api/relatorios/avec/${reportId}/pdf`, atendente), ctx(reportId))).status).toBe(403);
    expect(renderPagePdf).not.toHaveBeenCalled();

    const res = await getPdf(get(`/api/relatorios/avec/${reportId}/pdf`, gestao), ctx(reportId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/\.pdf"/);
    expect(renderPagePdf).toHaveBeenCalledWith(expect.objectContaining({ path: "/imprimir/avec", params: { id: reportId }, landscape: true }));

    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await getPdf(get(`/api/relatorios/avec/${missing}/pdf`, gestao), ctx(missing))).status).toBe(404);
  });
});
