import { describe, expect, it } from "vitest";
import { isGenericClient, isGenericClientName } from "./generic-client";

describe("CLIENTE PADRÃO (a cliente genérica do Avec)", () => {
  it("reconhece o nome com ou sem acento, em qualquer caixa e com observação no fim", () => {
    for (const n of ["CLIENTE PADRÃO", "Cliente Padrao", " cliente  padrão (x)", "CLIENTE PADRAO 2"]) expect(isGenericClientName(n)).toBe(true);
    for (const n of ["Clientes Padrinho", "Ana", "Padrão Cliente", "", null, undefined]) expect(isGenericClientName(n)).toBe(false);
  });

  it("horário: pelo nome da ficha ou, sem ficha, pelo nome que veio do Avec", () => {
    expect(isGenericClient({ contactId: null, clientName: "CLIENTE PADRÃO" })).toBe(true);
    expect(isGenericClient({ contactId: "c1", clientName: "CLIENTE PADRÃO", name: "Ana Souza" })).toBe(false);
    expect(isGenericClient({ contactId: "c1", clientName: null, name: "Cliente Padrão" })).toBe(true);
    expect(isGenericClient({ contactId: null, clientName: "Ana" })).toBe(false);
  });
});
