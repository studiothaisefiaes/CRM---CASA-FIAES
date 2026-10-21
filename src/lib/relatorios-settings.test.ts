import { expect, it } from "vitest";
import { DEFAULT_RELATORIOS_CONFIG, readRelatoriosConfig } from "./relatorios-settings";

it("padrão: Ocupação ligada; lê tolerante", () => {
  expect(DEFAULT_RELATORIOS_CONFIG).toEqual({ ocupacao: true });
  expect(readRelatoriosConfig(undefined)).toEqual({ ocupacao: true });
  expect(readRelatoriosConfig({ ocupacao: "não" })).toEqual({ ocupacao: true });
  expect(readRelatoriosConfig({ ocupacao: false })).toEqual({ ocupacao: false });
});
