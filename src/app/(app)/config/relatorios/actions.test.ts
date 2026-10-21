import { beforeEach, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: "", perms: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { UserFacingError } = await import("@/server/domain/errors");
  const { can } = await import("@/lib/permissions");
  return { assertPerm: async (p: never) => { if (!can(user.perms, p)) throw new UserFacingError("Você não tem permissão para isso."); return user; } };
});
import { resetDb } from "../../../../../test/db";
import { setupCaixa } from "../../../../../test/caixa-fixtures";
import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getRelatoriosConfig } from "@/server/domain/relatorios-config";
import { salvarRelatoriosConfig } from "./actions";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); user.id = s.caixaGestao.id; user.perms = [...s.caixaGestao.perms]; });

it("sem config.sistema, a ação é recusada no servidor e nada muda", async () => {
  user.perms = user.perms.filter((p) => p !== "config.sistema");
  expect(await salvarRelatoriosConfig({ ocupacao: false })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect((await getRelatoriosConfig()).ocupacao).toBe(true);
});
it("com a permissão, grava e audita de/para", async () => {
  expect(await salvarRelatoriosConfig({ ocupacao: false })).toEqual({ ok: true });
  expect(await getRelatoriosConfig()).toEqual({ ocupacao: false });
  const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "relatorios_configurado"));
  expect(a.data).toEqual({ de: { ocupacao: true }, para: { ocupacao: false } });
});
