import { it, expect } from "vitest";
import { parseConfirmation } from "./confirmation";

const AT = Date.parse("2026-10-15T14:00:00Z"); // qui 15/10 11h em Salvador

it("lê a confirmação padrão da Casa: dia e hora (horário de Salvador)", () => {
  const body = "*SARA - CASA FIAES:*\nConfirmado agendamento , aqui na Casa Fiaes, com o Especialista , para dia 17/10 (SÁBADO ) às 9h Avisos importantes: Estamos na Alameda";
  expect(parseConfirmation(body, AT)?.toISOString()).toBe("2026-10-17T12:00:00.000Z");
});

it("com ano curto e minutos (dia DD/MM/AA às HH:MMh)", () => {
  expect(parseConfirmation("Confirmado agendamento da Wanda Rezende dia 20/10/26 às 14:30h", AT)?.toISOString()).toBe("2026-10-20T17:30:00.000Z");
});

it("data antes da conversa sem ano: é do ano que vem", () => {
  expect(parseConfirmation("Confirmado agendamento para dia 05/01 às 10h", AT)?.toISOString()).toBe("2027-01-05T13:00:00.000Z");
});

it("o dia que vem depois de 'Confirmado agendamento' é o que vale (o 'seu novo momento será dia' antes não conta)", () => {
  const body = "Oii! seu novo momento será dia 21/10 Confirmado agendamento , aqui na Casa Fiaes, para dia 22/10 (QUINTA-FEIRA ) às 9h";
  expect(parseConfirmation(body, AT)?.toISOString()).toBe("2026-10-22T12:00:00.000Z");
});

it("sem a frase da confirmação, ou sem dia/hora, não é confirmação", () => {
  expect(parseConfirmation("Posso confirmar seu agendamento dia 17/10 às 9h?", AT)).toBeNull();
  expect(parseConfirmation("Confirmado agendamento! Te espero", AT)).toBeNull();
  expect(parseConfirmation("Confirmado agendamento dia 31/02 às 9h", AT)).toBeNull();
  expect(parseConfirmation(null, AT)).toBeNull();
});
