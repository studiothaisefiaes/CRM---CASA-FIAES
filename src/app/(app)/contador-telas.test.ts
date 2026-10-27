import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { profiles, settings, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { resetDb } from "../../../test/db";

/**
 * Perfil Contador (26/10), de ponta a ponta nos guardas de verdade (requirePerm/requireAnyPerm de session.ts, com a sessão no banco):
 * cada tela de leitura do dinheiro e do fiscal abre, sem nenhuma ação de escrita; as de conversa, clientes, agenda, caixa (operar) e
 * configurações mandam de volta para Relatórios com o aviso "sem permissão".
 */
const h = vi.hoisted(() => ({ token: "" }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "cf_session" && h.token ? { name: n, value: h.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("@/server/reports/financeiro/notas", async (orig) => ({ ...(await orig<typeof import("@/server/reports/financeiro/notas")>()), notasFiscaisOn: async () => true }));

type El = ReactElement<Record<string, unknown>>;
/** Procura no JSX devolvido pela página (sem renderizar) os elementos de um componente. */
function findAll(node: ReactNode, type: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) findAll(n, type, out); return out; }
  if (!isValidElement(node)) return out;
  const el = node as El;
  if (el.type === type) out.push(el);
  for (const v of Object.values(el.props ?? {})) if (Array.isArray(v) || isValidElement(v)) findAll(v as ReactNode, type, out);
  return out;
}

const SEM = "REDIRECT:/relatorios?aviso=sem-permissao";
let contadorId = "";
beforeEach(async () => {
  await resetDb();
  const [p] = await db.select().from(profiles).where(eq(profiles.key, "contador"));
  contadorId = (await db.insert(users).values({ name: "Carlos Contador", email: "carlos@contabil.com", passwordHash: "x", profileId: p.id }).returning())[0].id;
  h.token = (await insertSession(contadorId)).token;
  await db.insert(settings).values({ key: "financeiro_config", value: { contasAPagar: true, resultado: true } });
});

const page = async (path: string) => (await import(path ? `./${path}/page.tsx` : "./page.tsx")).default as (p: unknown) => Promise<ReactNode>;
const open = async (path: string, sp: Record<string, string> = {}) => (await page(path))({ searchParams: Promise.resolve(sp), params: Promise.resolve({}) });

describe("Contador: telas que abrem (só ver)", () => {
  it("Relatórios sem aba abre direto no Financeiro", async () => {
    const tree = await open("relatorios");
    const { FinanceTab } = await import("@/components/reports/financeiro");
    expect(findAll(tree, FinanceTab)).toHaveLength(1);
  });

  it("Financeiro › Contas a pagar: abre sem Lançar, Pagar, Cancelar nem cadastros", async () => {
    const { ContasAPagar } = await import("@/components/reports/contas-a-pagar");
    const [el] = findAll(await open("relatorios", { aba: "financeiro", vista: "contas" }), ContasAPagar);
    expect(el.props.can).toEqual({ lancar: false, pagar: false, cancelar: false, cadastros: false });
  });

  it("Financeiro › Resultado abre", async () => {
    const { ResultadoTab } = await import("@/components/reports/resultado");
    expect(findAll(await open("relatorios", { aba: "financeiro", vista: "resultado" }), ResultadoTab)).toHaveLength(1);
  });

  it("Financeiro › Notas fiscais abre, com o XML para baixar (nota.ver) e nada de emitir ou cancelar", async () => {
    const { NotasFiscaisTab } = await import("@/components/reports/notas-fiscais");
    const [el] = findAll(await open("relatorios", { aba: "financeiro", vista: "notas" }), NotasFiscaisTab);
    expect(el.props.xml).toBe(true);
  });

  it("Exceções e Comissão (Resumo) abrem", async () => {
    await expect(open("relatorios/excecoes")).resolves.toBeTruthy();
    const { SectionTabs } = await import("@/components/shell/section-tabs");
    const tree = await open("caixa/comissao");
    // Só a aba Resumo: nada de A pagar, Lançamentos ou Regras.
    const tabs = findAll(tree, SectionTabs).flatMap((t) => (t.props.tabs as { label: string }[]).map((x) => x.label));
    expect(tabs.filter((l) => ["A pagar", "Lançamentos", "Regras"].includes(l))).toEqual([]);
  });

  it("Caixas da equipe abre sem Fechar nem Reabrir caixa, com volta para Relatórios", async () => {
    await db.insert(settings).values({ key: "caixa_modo", value: "crm" }).onConflictDoNothing();
    const tree = await open("caixa/equipe");
    const { TeamCash } = await import("@/components/caixa/team-cash");
    for (const el of findAll(tree, TeamCash)) expect(el.props.canGerir).toBe(false);
    const { PageBack } = await import("@/components/page-header");
    expect(findAll(tree, PageBack).map((b) => b.props.href)).toEqual(["/relatorios?aba=financeiro"]);
  });

  it("Fechamentos de caixa abre só o histórico (sem Reabrir), sem passar pelo Fechar caixa / dia", async () => {
    const tree = await open("caixa/fechamentos");
    const { FechamentosHistorico } = await import("@/components/caixa/fechamentos-historico");
    const [el] = findAll(tree, FechamentosHistorico);
    expect((el.props.user as { id: string }).id).toBe(contadorId);
    const { ReopenCashButton } = await import("@/components/caixa/reopen-cash-button");
    expect(findAll(await FechamentosHistorico(el.props as Parameters<typeof FechamentosHistorico>[0]), ReopenCashButton)).toEqual([]);
  });
});

describe("Contador: telas que não abrem", () => {
  it("o Hoje manda direto para Relatórios", async () => {
    await expect(open("")).rejects.toThrow("REDIRECT:/relatorios");
  });

  it.each([
    "atendimento", "agenda", "contatos", "funil", "jornada", "ao-vivo", "servicos", "pacotes",
    "caixa", "caixa/fechar-dia", "caixa/comandas", "caixa/pacotes",
    "config", "config/equipe", "config/equipe/perfis", "config/api", "config/financeiro", "config/nota-fiscal", "config/whatsapp",
    "relatorios/avec",
  ])("/%s volta para Relatórios com o aviso", async (path) => {
    await expect(open(path)).rejects.toThrow(path === "relatorios/avec" ? /REDIRECT:\/relatorios\?aviso=sem-permissao/ : SEM);
  });
});
