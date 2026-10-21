import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { profiles, settings, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { resetDb } from "../../../../../test/db";
import { payment } from "../../../../../test/salon-fixtures";
import { GET } from "./route";

const profileId = async (key: string) => (await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, key)))[0].id;
async function cookie(key: "gestao" | "atendente") {
  const [u] = await db.insert(users).values({ name: key === "gestao" ? "Gestora Teste" : "Atendente Teste", email: `${key}@teste.local`, passwordHash: "x", profileId: await profileId(key) }).returning();
  return `cf_session=${(await insertSession(u.id)).token}`;
}
const get = (c: string | null, q = "de=2026-10-01&ate=2026-10-15") => GET(new NextRequest(`http://localhost/api/relatorios/excel-financeiro?${q}`, { headers: c ? { cookie: c } : {} }));

beforeEach(resetDb);
const sheets = async (r: Response) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await r.arrayBuffer()); return wb.worksheets.map((w) => w.name); };
const cfg = (v: { contasAPagar: boolean; resultado: boolean }) => db.insert(settings).values({ key: "financeiro_config", value: { ...v, venceEmDias: 7, repetirMaxMeses: 24 } }).onConflictDoUpdate({ target: settings.key, set: { value: { ...v, venceEmDias: 7, repetirMaxMeses: 24 } } });

describe("GET /api/relatorios/excel-financeiro", () => {
  it("sem sessão 401; sem ver valores 403", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get(await cookie("atendente"))).status).toBe(403);
  });
  it("gestão baixa o .xlsx do período, com a venda do Avec", async () => {
    await payment({ day: "2026-10-05", comanda: "12", method: "Pix", value: 4500 });
    const r = await get(await cookie("gestao"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.headers.get("content-disposition")).toContain("financeiro_2026-10-01_a_2026-10-15.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await r.arrayBuffer());
    const vendas = wb.getWorksheet("Vendas")!;
    expect(vendas.getRow(2).values).toEqual(expect.arrayContaining(["Avec", "12", 45]));
  });
  it("as abas Despesas e Resultado seguem o liga/desliga de Configurações › Financeiro", async () => {
    const c = await cookie("gestao");
    await cfg({ contasAPagar: true, resultado: true });
    expect(await sheets(await get(c))).toEqual(["Painel", "Formas", "Caixas", "Vendas", "Itens", "Exceções", "Despesas", "Resultado"]);
    await cfg({ contasAPagar: false, resultado: true });
    expect((await sheets(await get(c))).slice(6)).toEqual(["Resultado"]);
    await cfg({ contasAPagar: true, resultado: false });
    expect((await sheets(await get(c))).slice(6)).toEqual(["Despesas"]);
    await cfg({ contasAPagar: false, resultado: false });
    expect(await sheets(await get(c))).toEqual(["Painel", "Formas", "Caixas", "Vendas", "Itens", "Exceções"]);
  });
});
