import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { profiles, users } from "@/server/db/schema";
import { issuePrintToken } from "@/server/reports/print-token";
import { applyAvecFile } from "@/server/domain/avec/apply";
import { resetDb } from "../../../../test/db";
import { loadAvecPrint, PRINT_MAX_ROWS } from "./load";

// Planilha SINTÉTICA.
const rows = (n: number) => [["Cliente", "Celular", "CPF"], ...Array.from({ length: n }, (_, i) => [`Cliente Teste ${i + 1}`, `7198888${String(i).padStart(4, "0")}`, "000.000.000-00"])];
const user = async (key: string, email: string) => {
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, key));
  return (await db.insert(users).values({ name: "Pessoa Teste", email, passwordHash: "x", profileId: p.id }).returning())[0].id;
};

beforeEach(async () => { await resetDb(); });

describe("página de impressão do relatório do Avec", () => {
  it("só abre com token válido de quem vê e exporta relatórios; o token vale uma vez", async () => {
    const { reportId } = await applyAvecFile({ fileName: "clientes.xlsx", rows: rows(2) });
    const atendente = await issuePrintToken(await user("atendente", "a@teste.local"));
    expect(await loadAvecPrint(atendente, reportId)).toBeNull();
    expect(await loadAvecPrint(null, reportId)).toBeNull();
    const t = await issuePrintToken(await user("gestao", "g@teste.local"));
    const ok = await loadAvecPrint(t, reportId);
    expect(ok?.table.columns).toEqual(["Cliente", "Celular"]);
    expect(ok?.table.rows).toHaveLength(2);
    expect(ok?.cut).toBe(0);
    expect(await loadAvecPrint(t, reportId)).toBeNull();
  });

  it(`tabela muito grande sai com as primeiras ${PRINT_MAX_ROWS} linhas e avisa quantas ficaram de fora`, async () => {
    const { reportId } = await applyAvecFile({ fileName: "clientes.xlsx", rows: rows(PRINT_MAX_ROWS + 5) });
    const ok = await loadAvecPrint(await issuePrintToken(await user("gestao", "g@teste.local")), reportId);
    expect(ok?.table.rows).toHaveLength(PRINT_MAX_ROWS);
    expect(ok?.cut).toBe(5);
  });
});
