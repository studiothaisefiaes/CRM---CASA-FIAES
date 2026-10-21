import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { permsFor } from "../../../test/perms";
import { assertOcupacaoOn, getRelatoriosConfig, saveRelatoriosConfig } from "./relatorios-config";
import { setupCaixa } from "../../../test/caixa-fixtures";

beforeEach(resetDb);

it("padrão ligado; desligar muda assertOcupacaoOn; sem config.sistema recusa", async () => {
  const s = await setupCaixa();
  await expect(assertOcupacaoOn()).resolves.toBeUndefined();
  await expect(saveRelatoriosConfig({ ocupacao: false }, { id: s.caixaGestao.id, perms: permsFor("atendente") })).rejects.toThrow("permissão");
  await saveRelatoriosConfig({ ocupacao: false }, { id: s.caixaGestao.id, perms: [...s.caixaGestao.perms] });
  expect((await getRelatoriosConfig()).ocupacao).toBe(false);
  await expect(assertOcupacaoOn()).rejects.toThrow("Ocupação está desligada");
});
