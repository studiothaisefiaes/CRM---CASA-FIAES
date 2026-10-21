import { describe, expect, it } from "vitest";
import { changedNotice, hourText, linkExpiry, linkPageState, longDay, onlyFirstName, renderLinkText, servicesText, shortDay, waLink, whenLine, type LinkAppt } from "./client-link";

/** Instante de Salvador escrito à mão: o teste não depende do fuso do processo (rode também com TZ=UTC e TZ=Asia/Tokyo). */
const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const NOW = bahia("2026-10-14", "12:00");
const ap = (o: Partial<LinkAppt> = {}): LinkAppt => ({ startsAt: bahia("2026-10-16", "10:00"), durationMin: 80, status: "agendado", service: "Corte feminino", pro: "ANA", ...o });

describe("link da cliente (seção 9.4)", () => {
  it("validade: o menor entre o fim + 24 h e a geração + 60 dias", () => {
    expect(linkExpiry(bahia("2026-10-16", "11:20"), NOW).toISOString()).toBe(bahia("2026-10-17", "11:20").toISOString());
    expect(linkExpiry(bahia("2027-01-30", "11:20"), NOW).toISOString()).toBe(new Date(NOW.getTime() + 60 * 86_400_000).toISOString());
  });

  it("só o primeiro nome, nunca o sobrenome; datas e horas em Salvador", () => {
    expect(onlyFirstName("paula de souza")).toBe("Paula");
    expect(onlyFirstName(null)).toBeNull();
    expect(longDay(bahia("2026-10-16", "10:00"))).toBe("sexta, 16 de outubro");
    expect(shortDay(bahia("2026-10-16", "10:00"))).toBe("sexta, 16/10");
    expect(hourText(bahia("2026-10-16", "00:30"))).toBe("00:30");
  });

  it("agendado: os três botões; a visita inteira numa frase", () => {
    const st = linkPageState([ap(), ap({ startsAt: bahia("2026-10-16", "11:20"), durationMin: 40, service: "Escova", pro: "BIA" })], bahia("2026-10-16", "10:00"), NOW, 24);
    expect(st).toMatchObject({ state: "agendado", canAct: true, canCancel: true, changed: false });
    expect(servicesText(st.items)).toBe("Corte feminino com Ana e Escova com Bia");
    // sem artigo antes do nome (Jackson e Gilvan são homens) e o que vem do Avec em MAIÚSCULAS sai em Título
    expect(servicesText([{ service: "AVALIAÇÃO", pro: "GILVAN" }, { service: "Corte Masculino", pro: "Jackson" }])).toBe("Avaliação com Gilvan e Corte Masculino com Jackson");
    expect(whenLine(st.start, st.end)).toBe("sexta, 16 de outubro · 10:00 às 12:00");
  });

  it("confirmado, cancelado (sem botões), já aconteceu e pedido pelo site", () => {
    expect(linkPageState([ap({ status: "confirmado" })], bahia("2026-10-16", "10:00"), NOW, 24).state).toBe("confirmado");
    expect(linkPageState([ap({ status: "cancelado" })], bahia("2026-10-16", "10:00"), NOW, 24)).toMatchObject({ state: "cancelado", canAct: false, canCancel: false });
    expect(linkPageState([ap()], bahia("2026-10-16", "10:00"), bahia("2026-10-16", "10:00"), 24)).toMatchObject({ state: "aconteceu", canAct: false });
    expect(linkPageState([ap({ status: "solicitado" })], bahia("2026-10-16", "10:00"), NOW, 24)).toMatchObject({ state: "solicitado", canAct: false });
  });

  it("remarcado depois do link: avisa que mudou; uma das profissionais cancelou: mostra só o que continua", () => {
    expect(linkPageState([ap({ startsAt: bahia("2026-10-16", "14:00") })], bahia("2026-10-16", "10:00"), NOW, 24).changed).toBe(true);
    expect(changedNotice(bahia("2026-10-16", "14:00"))).toBe("Seu horário mudou: agora é sexta, 16/10, às 14:00");
    const half = linkPageState([ap({ status: "cancelado" }), ap({ startsAt: bahia("2026-10-16", "11:20"), service: "Escova", pro: "BIA" })], bahia("2026-10-16", "10:00"), NOW, 24);
    expect(half.items.map((i) => i.service)).toEqual(["Escova"]);
    expect(half.changed).toBe(true);
  });

  it("cancelar só até 24 h antes (fora do prazo, os outros botões continuam); sem duração não inventa o fim", () => {
    expect(linkPageState([ap()], bahia("2026-10-16", "10:00"), bahia("2026-10-15", "10:30"), 24)).toMatchObject({ canAct: true, canCancel: false });
    expect(linkPageState([ap()], bahia("2026-10-16", "10:00"), bahia("2026-10-15", "10:00"), 24).canCancel).toBe(true);
    const sem = linkPageState([ap({ durationMin: null })], bahia("2026-10-16", "10:00"), NOW, 24);
    expect(sem.end).toBeNull();
    expect(whenLine(sem.start, sem.end)).toBe("sexta, 16 de outubro · às 10:00");
  });

  it("texto modelo com as variáveis; sem {link} no modelo, o link vai no fim; sem nome, sem vírgula sobrando", () => {
    const v = { primeiro_nome: "Paula", data: "sexta, 16/10", hora: "10:00", servicos: "Corte feminino com Ana", link: "https://crm.x/c/abc" };
    expect(renderLinkText("Oi, {primeiro_nome}! Seu horário na Casa Fiaes: {data} às {hora} ({servicos}). Para confirmar ou remarcar, é só tocar aqui: {link}", v))
      .toBe("Oi, Paula! Seu horário na Casa Fiaes: sexta, 16/10 às 10:00 (Corte feminino com Ana). Para confirmar ou remarcar, é só tocar aqui: https://crm.x/c/abc");
    expect(renderLinkText("Oi, {primeiro_nome}!", v)).toBe("Oi, Paula!\nhttps://crm.x/c/abc");
    expect(renderLinkText("Oi, {primeiro_nome}! Seu horário: {data}. {link}", { ...v, primeiro_nome: "" })).toBe("Oi! Seu horário: sexta, 16/10. https://crm.x/c/abc");
  });

  it("Falar com a Casa: wa.me só com WhatsApp configurado", () => {
    expect(waLink("+55 71 99999-0000", "Oi!")).toBe("https://wa.me/5571999990000?text=Oi!");
    expect(waLink(null, "Oi")).toBeNull();
  });
});

describe("serviços da mesma profissional numa frase só (17/10)", () => {
  it("junta os serviços de quem atende, na ordem em que aparecem", () => {
    expect(servicesText([{ service: "Luzes e Mechas", pro: "THAISE" }, { service: "Coloração ou Tonalização", pro: "THAISE" }])).toBe("Luzes e Mechas e Coloração ou Tonalização com Thaise");
    expect(servicesText([{ service: "Corte", pro: "Ana" }, { service: "Unha", pro: "Bia" }, { service: "Escova", pro: "Ana" }])).toBe("Corte e Escova com Ana e Unha com Bia");
  });
});

