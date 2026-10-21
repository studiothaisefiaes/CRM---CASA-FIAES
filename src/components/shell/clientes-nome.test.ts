import { it, expect } from "vitest";
import nextConfig from "../../../next.config";
import { PERM_LABEL } from "@/lib/permissions";

it("o menu chama Contatos de 'Clientes' (a rota continua /contatos)", async () => {
  const { NAV } = await import("./nav");
  expect(NAV.find((n) => n.href === "/contatos")?.label).toBe("Clientes");
  expect(PERM_LABEL["contatos.ver"]).toBe("Ver Clientes");
});

it("/clientes leva para /contatos (links novos não quebram)", async () => {
  const r = await nextConfig.redirects!();
  expect(r).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: "/clientes", destination: "/contatos", permanent: false }),
    expect.objectContaining({ source: "/clientes/:path*", destination: "/contatos/:path*", permanent: false }),
  ]));
});

it("o grupo das permissões também se chama Clientes", async () => {
  const { PERM_GROUPS, PERM_GROUP } = await import("@/lib/permissions");
  expect(PERM_GROUPS).toContain("Clientes");
  expect(PERM_GROUP["contatos.ver"]).toBe("Clientes");
});
