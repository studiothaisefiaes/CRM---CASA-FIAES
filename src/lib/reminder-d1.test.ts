import { describe, expect, it } from "vitest";
import { inReminderWindow, LINK_SUFFIX, reminderSendAt, renderReminder } from "./reminder-d1";

/** Instante de Salvador escrito à mão: o teste não depende do fuso do processo (rode também com TZ=UTC e TZ=Asia/Tokyo). */
const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const at = (day: string, hm: string) => reminderSendAt(bahia(day, hm).getTime()).toISOString();

describe("lembrete 24 h antes, na janela 8h–20h (pedido do dono, 15/10)", () => {
  it("24 h antes quando cai dentro da janela", () => {
    expect(at("2026-10-16", "10:00")).toBe(bahia("2026-10-15", "10:00").toISOString());
    expect(at("2026-10-16", "08:00")).toBe(bahia("2026-10-15", "08:00").toISOString());
    expect(at("2026-10-16", "20:00")).toBe(bahia("2026-10-15", "20:00").toISOString());
  });

  it("fora da janela: o limite mais próximo, sempre antes do horário", () => {
    expect(at("2026-10-16", "21:00")).toBe(bahia("2026-10-15", "20:00").toISOString()); // 20h da véspera (1 h) ganha de 8h do dia (11 h)
    expect(at("2026-10-16", "07:00")).toBe(bahia("2026-10-15", "08:00").toISOString()); // 8h da véspera (1 h) ganha de 20h de dois dias antes
    expect(at("2026-10-17", "00:30")).toBe(bahia("2026-10-15", "20:00").toISOString()); // 00:30 da véspera: 20h (4h30) ganha de 8h (7h30)
  });

  it("janela de envio no relógio de Salvador", () => {
    expect(inReminderWindow(bahia("2026-10-19", "08:00").getTime())).toBe(true);
    expect(inReminderWindow(bahia("2026-10-19", "19:59").getTime())).toBe(true);
    expect(inReminderWindow(bahia("2026-10-19", "20:00").getTime())).toBe(false);
    expect(inReminderWindow(bahia("2026-10-19", "07:59").getTime())).toBe(false);
  });

  it("texto: sem link por padrão; com link, a frase do link vai no fim; {link} sem link some", () => {
    const v = { primeiro_nome: "Paula", data: "sexta, 16/10", hora: "10:00", servicos: ["Corte com a Maiara"] };
    expect(renderReminder("Oi, {primeiro_nome}! Lembrete: {data} às {hora}, {servicos}. Até lá!", v, null)).toBe("Oi, Paula! Lembrete: sexta, 16/10 às 10:00, Corte com a Maiara. Até lá!");
    expect(renderReminder("Oi, {primeiro_nome}! Até lá!", v, "https://crm.x/c/abc")).toBe(`Oi, Paula! Até lá! ${LINK_SUFFIX.replace("{link}", "https://crm.x/c/abc")}`);
    expect(renderReminder("Oi, {primeiro_nome}! Toque: {link}", v, null)).toBe("Oi, Paula! Toque:");
    expect(renderReminder("Oi, {primeiro_nome}! Toque: {link}", v, "https://crm.x/c/abc")).toBe("Oi, Paula! Toque: https://crm.x/c/abc");
    expect(renderReminder("Oi, {primeiro_nome}!", { ...v, primeiro_nome: "" }, null)).toBe("Oi!");
  });
});

describe("véspera no relógio de Salvador (17/10: lembrete saiu no próprio dia dizendo 'amanhã')", () => {
  it("isEveOf: o instante cai no dia anterior ao do horário", async () => {
    const { isEveOf } = await import("./reminder-d1");
    expect(isEveOf(bahia("2026-10-16", "08:00").getTime(), bahia("2026-10-17", "09:00").getTime())).toBe(true);
    expect(isEveOf(bahia("2026-10-16", "23:59").getTime(), bahia("2026-10-17", "00:30").getTime())).toBe(true);
    expect(isEveOf(bahia("2026-10-17", "08:00").getTime(), bahia("2026-10-17", "09:00").getTime())).toBe(false); // o próprio dia
    expect(isEveOf(bahia("2026-10-15", "20:00").getTime(), bahia("2026-10-17", "00:30").getTime())).toBe(false); // dois dias antes
  });
});

describe("texto arejado (17/10: 'tudo junto, bagunçadinho')", () => {
  const v = { primeiro_nome: "Paula", data: "sexta, 16/10", hora: "10:00", servicos: ["Corte com Maiara", "Escova com Bia"] };
  it("{servicos} sozinho na linha: um serviço por linha; no meio da frase: 'a e b'; as quebras de linha ficam", () => {
    expect(renderReminder("Oi, {primeiro_nome}!\n\n📅 *{data}* às *{hora}*\n{servicos}\n\nAté lá!", v, null))
      .toBe("Oi, Paula!\n\n📅 *sexta, 16/10* às *10:00*\nCorte com Maiara\nEscova com Bia\n\nAté lá!");
    expect(renderReminder("Oi! {data}, {servicos}.", v, null)).toBe("Oi! sexta, 16/10, Corte com Maiara e Escova com Bia.");
  });
  it("texto com várias linhas: a frase do link vai num parágrafo próprio", () => {
    expect(renderReminder("Oi, {primeiro_nome}!\n\nAté lá!", v, "https://crm.x/c/abc")).toBe(`Oi, Paula!\n\nAté lá!\n\n${LINK_SUFFIX.replace("{link}", "https://crm.x/c/abc")}`);
  });
  it("o texto padrão: data e hora em negrito do WhatsApp, cada serviço numa linha", async () => {
    const { DEFAULT_REMINDER_TEXT, DEFAULT_RESCHEDULED_TEXT } = await import("@/server/domain/client-link/settings");
    expect(renderReminder(DEFAULT_REMINDER_TEXT, v, null)).toBe([
      "Olá, Paula! 💛", "", "Passando para lembrar do seu horário amanhã na Casa Fiaes:", "", "📅 *sexta, 16/10*", "⏰ às *10:00*", "✨ Corte com Maiara", "✨ Escova com Bia", "",
      "Temos tolerância de 15 minutos.", "", "Você confirma sua presença? Se precisar remarcar, é só responder por aqui.", // Fase B: o texto da Casa; sem endereço, sem 📍 nem mapa
    ].join("\n"));
    expect(renderReminder(DEFAULT_RESCHEDULED_TEXT, v, null)).toBe([
      "Olá, Paula! 💛", "", "Seu horário na Casa Fiaes foi remarcado para:", "", "📅 *sexta, 16/10*", "⏰ às *10:00*", "✨ Corte com Maiara", "✨ Escova com Bia", "",
      "Se o novo horário não ficar bom para você, é só responder por aqui.",
    ].join("\n"));
  });
});
