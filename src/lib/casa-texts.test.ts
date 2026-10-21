import { describe, expect, it } from "vitest";
import { CASA_AGRADECIMENTO, CASA_CONFIRMACAO_D1, CASA_NOTA_ALTA, CASA_PESQUISA_TITULO } from "./casa-texts";
import { DEFAULT_REMINDER_TEXT, renderReminder } from "./reminder-d1";

const TEXTOS = { CASA_CONFIRMACAO_D1, CASA_AGRADECIMENTO, CASA_PESQUISA_TITULO, CASA_NOTA_ALTA };
const v = { primeiro_nome: "Paula", data: "sexta, 16/10", hora: "10:00", servicos: ["Corte com Maiara", "Escova com Bia"] };

describe("textos da Casa (estilo da Casa)", () => {
  it.each(Object.entries(TEXTOS))("%s: sem artigo antes de nome (só \"Casa Fiaes\"), Método Fiaes® sempre com ®", (_k, t) => {
    const comArtigo = [...t.matchAll(/\b(?:a|o|da|do|na|no|pela|pelo) ([A-Z][a-z]+) Fiaes\b/g)].map((m) => m[1]);
    expect(comArtigo.every((nome) => nome === "Casa")).toBe(true);
    expect(t).not.toMatch(/Método Fiaes(?!®)/);
  });

  it("a confirmação da véspera é o texto padrão do lembrete", () => {
    expect(DEFAULT_REMINDER_TEXT).toBe(CASA_CONFIRMACAO_D1);
  });

  it("confirmação com endereço e mapa: cada um na sua linha", () => {
    expect(renderReminder(CASA_CONFIRMACAO_D1, { ...v, endereco: "Rua das Flores, 10 - Pituba", mapa: "https://maps.app.goo.gl/casa" }, null)).toBe([
      "Olá, Paula! 💛", "", "Passando para lembrar do seu horário amanhã na Casa Fiaes:", "", "📅 *sexta, 16/10*", "⏰ às *10:00*", "✨ Corte com Maiara", "✨ Escova com Bia", "",
      "📍 Rua das Flores, 10 - Pituba", "https://maps.app.goo.gl/casa", "", "Temos tolerância de 15 minutos.", "",
      "Você confirma sua presença? Se precisar remarcar, é só responder por aqui.",
    ].join("\n"));
  });

  it("endereço vazio tira a linha do 📍 e a do mapa, sem linha em branco dupla", () => {
    const esperado = [
      "Olá, Paula! 💛", "", "Passando para lembrar do seu horário amanhã na Casa Fiaes:", "", "📅 *sexta, 16/10*", "⏰ às *10:00*", "✨ Corte com Maiara", "✨ Escova com Bia", "",
      "Temos tolerância de 15 minutos.", "", "Você confirma sua presença? Se precisar remarcar, é só responder por aqui.",
    ].join("\n");
    expect(renderReminder(CASA_CONFIRMACAO_D1, { ...v, endereco: "", mapa: "https://maps.app.goo.gl/casa" }, null)).toBe(esperado);
    expect(renderReminder(CASA_CONFIRMACAO_D1, v, null)).toBe(esperado); // sem as variáveis novas (quem chama ainda não as passa)
    expect(renderReminder(CASA_CONFIRMACAO_D1, v, null)).not.toMatch(/\n\n\n/);
  });

  it("endereço sem mapa: fica o 📍 e some só a linha do mapa", () => {
    expect(renderReminder(CASA_CONFIRMACAO_D1, { ...v, endereco: "Rua das Flores, 10", mapa: "" }, null)).toContain("✨ Escova com Bia\n\n📍 Rua das Flores, 10\n\nTemos tolerância");
  });
});
