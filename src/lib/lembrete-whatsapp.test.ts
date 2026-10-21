import { describe, expect, it } from "vitest";
import { messageDay, messageHour } from "./client-link";
import { CASA_CONFIRMACAO_D1 } from "./casa-texts";
import { DEFAULT_RESCHEDULED_TEXT, effectiveText, LEGACY_REMINDER_TEXTS, LEGACY_RESCHEDULED_TEXTS, reminderWhen, renderReminder } from "./reminder-d1";

/** Instante de Salvador escrito à mão: o teste não depende do fuso do processo (rode também com TZ=UTC e TZ=Asia/Tokyo). */
const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);

describe("data e hora na mensagem para a cliente (21/10, Cati: 'a cliente não vê bem a data e a hora')", () => {
  it("data por extenso com o dia da semana inteiro, no relógio de Salvador", () => {
    expect(messageDay(bahia("2026-10-22", "14:00"))).toBe("quinta-feira, 22/10");
    expect(messageDay(bahia("2026-10-24", "09:00"))).toBe("sábado, 24/10");
    expect(messageDay(bahia("2026-10-25", "10:00"))).toBe("domingo, 25/10");
    // 23h30 em Salvador já é o dia seguinte em UTC: vale o dia de Salvador.
    expect(messageDay(bahia("2026-10-22", "23:30"))).toBe("quinta-feira, 22/10");
    // 00h10 em Salvador ainda é o dia anterior em Tóquio: vale o dia de Salvador.
    expect(messageDay(bahia("2026-11-02", "00:10"))).toBe("segunda-feira, 02/11");
  });

  it("hora como a Casa escreve: 14h, 9h, 14h30", () => {
    expect(messageHour(bahia("2026-10-22", "14:00"))).toBe("14h");
    expect(messageHour(bahia("2026-10-22", "09:00"))).toBe("9h");
    expect(messageHour(bahia("2026-10-22", "14:30"))).toBe("14h30");
    expect(messageHour(bahia("2026-10-22", "23:45"))).toBe("23h45");
    expect(messageHour(bahia("2026-10-22", "00:05"))).toBe("0h05");
  });

  it("reminderWhen: as variáveis {data} e {hora} do lembrete", () => {
    expect(reminderWhen(bahia("2026-10-22", "14:00"))).toEqual({ data: "quinta-feira, 22/10", hora: "14h" });
  });
});

describe("lembrete da véspera para WhatsApp (21/10)", () => {
  const v = { primeiro_nome: "Paula", ...reminderWhen(bahia("2026-10-22", "14:00")), servicos: ["Corte com Jackson", "Escova com Maiara"] };

  it("o texto padrão renderizado: curto, com quebras de linha, data e hora cada uma na sua linha, endereço e a pergunta no fim", () => {
    expect(renderReminder(CASA_CONFIRMACAO_D1, { ...v, endereco: "Alameda das Seringueiras, 44 - Caminho das Árvores", mapa: "https://maps.app.goo.gl/casa" }, null)).toBe([
      "Olá, Paula! 💛",
      "",
      "Passando para lembrar do seu horário amanhã na Casa Fiaes:",
      "",
      "📅 *quinta-feira, 22/10*",
      "⏰ às *14h*",
      "✨ Corte com Jackson",
      "✨ Escova com Maiara",
      "",
      "📍 Alameda das Seringueiras, 44 - Caminho das Árvores",
      "https://maps.app.goo.gl/casa",
      "",
      "Temos tolerância de 15 minutos.",
      "",
      "Você confirma sua presença? Se precisar remarcar, é só responder por aqui.",
    ].join("\n"));
  });

  it("negrito do WhatsApp só na data e na hora", () => {
    const t = renderReminder(CASA_CONFIRMACAO_D1, { ...v, endereco: "Rua A, 1", mapa: "" }, null);
    expect([...t.matchAll(/\*([^*\n]+)\*/g)].map((m) => m[1])).toEqual(["quinta-feira, 22/10", "14h"]);
    const r = renderReminder(DEFAULT_RESCHEDULED_TEXT, v, null);
    expect([...r.matchAll(/\*([^*\n]+)\*/g)].map((m) => m[1])).toEqual(["quinta-feira, 22/10", "14h"]);
  });

  it("tom da Casa: sem 'Oii', sem 'SIM' gritado, termina com a pergunta de confirmação", () => {
    const t = renderReminder(CASA_CONFIRMACAO_D1, v, null);
    expect(t).not.toMatch(/\bOii|\bSIM\b|!!/);
    expect(t.trim().endsWith("?") || /\?[^?]*$/.test(t)).toBe(true);
    expect(t.split("\n").at(-1)).toMatch(/^Você confirma sua presença\?/);
  });

  it("sem endereço: some a linha do 📍 e a do mapa, sem linha em branco dupla", () => {
    const t = renderReminder(CASA_CONFIRMACAO_D1, v, null);
    expect(t).not.toContain("📍");
    expect(t).not.toMatch(/\n\n\n/);
    expect(t).toContain("✨ Escova com Maiara\n\nTemos tolerância de 15 minutos.");
  });

  it("sem nome: 'Olá! 💛'", () => {
    expect(renderReminder(CASA_CONFIRMACAO_D1, { ...v, primeiro_nome: "" }, null).split("\n")[0]).toBe("Olá! 💛");
  });

  it("remarcação no mesmo desenho", () => {
    expect(renderReminder(DEFAULT_RESCHEDULED_TEXT, { ...v, servicos: ["Corte com Jackson"] }, null)).toBe([
      "Olá, Paula! 💛", "", "Seu horário na Casa Fiaes foi remarcado para:", "", "📅 *quinta-feira, 22/10*", "⏰ às *14h*", "✨ Corte com Jackson", "",
      "Se o novo horário não ficar bom para você, é só responder por aqui.",
    ].join("\n"));
  });

  it("marcador antes de {servicos} vale para cada serviço; {servicos} sozinho continua um por linha sem marcador", () => {
    expect(renderReminder("• {servicos}", v, null)).toBe("• Corte com Jackson\n• Escova com Maiara");
    expect(renderReminder("Oi!\n{servicos}\nAté", v, null)).toBe("Oi!\nCorte com Jackson\nEscova com Maiara\nAté");
    expect(renderReminder("Serviços: {servicos}.", v, null)).toBe("Serviços: Corte com Jackson e Escova com Maiara.");
  });

  it("os textos novos cabem no limite da tela (600)", () => {
    expect(CASA_CONFIRMACAO_D1.length).toBeLessThanOrEqual(600);
    expect(DEFAULT_RESCHEDULED_TEXT.length).toBeLessThanOrEqual(600);
  });
});

describe("texto salvo pela gestão: padrão antigo vira o novo, personalizado fica", () => {
  it("salvo igual a um padrão antigo (a tela salva o texto inteiro mesmo sem mudança): vale o novo", () => {
    for (const old of LEGACY_REMINDER_TEXTS) expect(effectiveText(old, CASA_CONFIRMACAO_D1, LEGACY_REMINDER_TEXTS)).toBe(CASA_CONFIRMACAO_D1);
    for (const old of LEGACY_RESCHEDULED_TEXTS) expect(effectiveText(old, DEFAULT_RESCHEDULED_TEXT, LEGACY_RESCHEDULED_TEXTS)).toBe(DEFAULT_RESCHEDULED_TEXT);
    // \r\n do navegador e espaço no fim não contam como mudança.
    expect(effectiveText(`${LEGACY_REMINDER_TEXTS[1].replace(/\n/g, "\r\n")}  `, CASA_CONFIRMACAO_D1, LEGACY_REMINDER_TEXTS)).toBe(CASA_CONFIRMACAO_D1);
  });

  it("personalizado (qualquer mudança) fica como está; vazio ou ausente vale o padrão", () => {
    const meu = `${LEGACY_REMINDER_TEXTS[1]} Beijos!`;
    expect(effectiveText(meu, CASA_CONFIRMACAO_D1, LEGACY_REMINDER_TEXTS)).toBe(meu);
    expect(effectiveText("", CASA_CONFIRMACAO_D1, LEGACY_REMINDER_TEXTS)).toBe(CASA_CONFIRMACAO_D1);
    expect(effectiveText(undefined, CASA_CONFIRMACAO_D1, LEGACY_REMINDER_TEXTS)).toBe(CASA_CONFIRMACAO_D1);
  });

  it("o texto antigo salvo também ganha a data por extenso e a hora nova (as variáveis são as mesmas)", () => {
    const meu = "Oi, {primeiro_nome}! Seu horário: {data} às {hora}. {servicos}. Beijo!";
    expect(renderReminder(meu, { primeiro_nome: "Ana", ...reminderWhen(bahia("2026-10-22", "09:30")), servicos: ["Corte"] }, null))
      .toBe("Oi, Ana! Seu horário: quinta-feira, 22/10 às 9h30. Corte. Beijo!");
  });
});
