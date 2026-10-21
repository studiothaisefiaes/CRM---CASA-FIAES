import { expect, it } from "vitest";
import { contactListQuery, parseContactListParams } from "./contact-list-params";

it("lê a URL; valores desconhecidos viram 'sem filtro'; a URL volta igual (sem página 1 e sem vazios)", () => {
  const p = parseContactListParams(new URLSearchParams("q=ana&f=sumidas&pro=0b9b1d1e-2f3a-4c5d-8e9f-0a1b2c3d4e5f&svc=Escova&ordem=visitas&p=2&clientes=1"));
  expect(p).toMatchObject({ q: "ana", filter: "sumidas", professionalId: "0b9b1d1e-2f3a-4c5d-8e9f-0a1b2c3d4e5f", service: "Escova", sort: "visitas", page: 2, onlyClients: true, includeIgnored: false });
  expect(parseContactListParams({ f: "inventado", ordem: "x", pro: "não-é-uuid", p: "-3" })).toMatchObject({ filter: null, sort: null, professionalId: null, page: 1 });
  expect(contactListQuery(p, { page: 1, filter: null })).toBe("?q=ana&clientes=1&pro=0b9b1d1e-2f3a-4c5d-8e9f-0a1b2c3d4e5f&svc=Escova&ordem=visitas");
});
