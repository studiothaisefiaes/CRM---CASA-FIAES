import { it, expect } from "vitest";
import { NAV } from "./nav";
import { SYSTEM_PROFILES, ONE_TIME_GRANTS, can } from "@/lib/permissions";
import { configTabs } from "@/lib/config-tabs";

it("Serviços e pacotes fica no grupo Gestão do menu (fora de Configurações), no celular dentro de Mais", () => {
  const s = NAV.find((n) => n.href === "/servicos");
  expect(s).toMatchObject({ key: "servicos", label: "Serviços e pacotes", perm: "atendimento.ver", group: "gestao", mobile: "mais" });
});

it("gestão e recepção mudam serviços e preços; a atendente só consulta", () => {
  const perms = (k: string) => SYSTEM_PROFILES.find((p) => p.key === k)!.permissions;
  expect(can(perms("gestao"), "servicos.editar")).toBe(true);
  expect(can(perms("recepcao"), "servicos.editar")).toBe(true);
  expect(can(perms("atendente"), "servicos.editar")).toBe(false);
  expect(can(perms("atendente"), "atendimento.ver")).toBe(true);
  expect(ONE_TIME_GRANTS).toContainEqual({ profile: "recepcao", perm: "servicos.editar" });
});

it("Configurações não tem mais o atalho Serviços (o menu já tem Serviços e pacotes)", () => {
  expect(configTabs(["config.diaadia"]).find((i) => i.id === "servicos")).toBeUndefined();
  expect(configTabs(["config.sistema"]).find((i) => i.id === "servicos")).toBeUndefined();
});

it("Serviços e pacotes tem as abas Serviços · Pacotes · Fidelidade · Formas de pagamento (e Produtos só com o estoque); Clientes com pacote saiu daqui", async () => {
  const { servicosView } = await import("@/lib/servicos-tabs");
  const gestao = SYSTEM_PROFILES.find((p) => p.key === "gestao")!.permissions;
  const tab = (aba: string, estoqueOn = true) => servicosView(gestao, { aba, estoqueOn })?.tab;
  expect(["pacotes", "fidelidade", "formas", "produtos"].map((a) => tab(a))).toEqual(["pacotes", "fidelidade", "formas", "produtos"]);
  expect(tab("produtos", false)).toBe("servicos");
  expect(tab("clientes")).toBe("servicos");
});
