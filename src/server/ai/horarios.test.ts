import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { agendaBlocks, appointments, clientPackages, contacts, lists, professionals, professionalServices, settings } from "../db/schema";
import { resetDb } from "../../../test/db";
import { asksForSlots, pediuHorario, pediuHorarioNovo, durationText, formatFreeHours, hourMentions, isAgreement, MAX_LINE_CHARS, MAX_OPTIONS, mentionsTime, metodoTopic, offeredSlot, openDays, parseWindow, serviceFromText, type DayFree } from "./horarios";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { freeHoursLine } from "./horarios-agenda";
import { DEFAULT_HOURS } from "@/lib/business-hours";

// Casa: terça a sábado, 9h–18h (domingo e segunda fechados). 19/10/2026 é segunda.
const CASA = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const NOW = at("2026-10-19", "10:00");

describe("asksForSlots: a conversa pede horário?", () => {
  it("pedidos de horário, dia, vaga, manutenção, hora", () => {
    for (const t of ["Tem horário sábado?", "quero agendar", "Queria marcar uma escova", "tem vaga amanhã?", "Está disponível na quinta?", "pode ser dia 22?",
      "Preciso fazer a manutenção", "pode ser 15h?", "às 9 dá?", "essa semana ainda dá?", "de manhã é melhor", "(áudio) consegue hoje à tarde?"]) expect(asksForSlots([t]), t).toBe(true);
  });
  it("cumprimento, preço e agradecimento não pedem", () => {
    for (const t of ["Bom dia!", "Boa tarde, tudo bem?", "Quanto custa a escova?", "Obrigada!", "Vocês aceitam pix?", "", null]) expect(asksForSlots([t]), String(t)).toBe(false);
    expect(asksForSlots(["Bom dia", "tem horário amanhã?"])).toBe(true);
  });
});

describe("IA v3.1 (17/10): semana pedida, cadastro não é dia, nome do serviço em Título", () => {
  const HOJE = "2026-10-17"; // sábado
  it("'semana do dia 26' / 'semana do 26/10' / 'semana que vem': a semana inteira (segunda a domingo)", () => {
    const semana = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
    expect(parseWindow(["Oi cati Pode ser na semana do dia 26?"], HOJE)).toEqual({ days: semana, period: null, label: "semana de 26/10" });
    expect(parseWindow(["na semana do 28/10 à tarde"], HOJE)).toEqual({ days: semana, period: "tarde", label: "semana de 26/10 à tarde" });
    expect(parseWindow(["pode ser semana que vem?"], HOJE)?.days).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  });
  it("caso Lorena: CPF, e-mail e data de nascimento não são pedido de horário nem dia", () => {
    const cadastro = "104.143.815-05 Lorena Guedes lorena@exemplo.com 11/03/2007";
    expect(parseWindow([cadastro], HOJE)).toBeNull();
    expect(asksForSlots([cadastro], 2026)).toBe(false);
    expect(asksForSlots(["[CPF] Lorena [e-mail] 11/03/07"], 2026)).toBe(false);
    expect(parseWindow(["tem hoje às 17h?", cadastro], HOJE)).toMatchObject({ days: ["2026-10-17"] });
    // Data com o ano atual vale; ano passado nunca.
    expect(parseWindow(["pode ser 22/10/2026?"], HOJE)).toMatchObject({ days: ["2026-10-22"] });
    expect(parseWindow(["foi 22/10/2025"], HOJE)).toBeNull();
  });
  it("serviço da linha em Título e a regra 'só com' no cabeçalho", () => {
    const days: DayFree[] = [{ day: "2026-10-21", pros: [{ name: "Maiara", starts: [750] }] }];
    expect(formatFreeHours({ serviceLabel: "MANUTENÇÃO PROTESE CAPILAR", durationMin: 60, days }).line).toBe("Horários livres (Manutenção Protese Capilar, 1 h): qua 21/10 Maiara 12h30 (h1)");
    expect(formatFreeHours({ serviceLabel: "AVALIAÇÃO", durationMin: 60, days, onlyWith: "Thaise" }).line).toMatch(/^Horários livres \(Avaliação, 1 h; só com Thaise\):/);
  });
});

describe("partes puras", () => {
  const svcs = [{ label: "Escova" }, { label: "Escova Progressiva" }, { label: "Manutenção Método Fiaes" }, { label: "Corte" }];
  it("serviceFromText: lista de opções da descrição acha o serviço; 'cabelo' sozinho e texto corrido não", () => {
    const l = [
      { label: "Ritual de Tratamento", description: "Hidratação | Nutrição | Reconstrução: Profissional autorizado: THAISE" },
      { label: "Alinhamento", description: "Alinhamento com função de reduzir volume e/ou mudança de textura." },
      { label: "Cabelo Método Fiaes 1", description: "Fornecimento de Cabelo Natural: volume, preenchimento." },
    ];
    expect(serviceFromText("quanto é a hidratação?", l)?.label).toBe("Ritual de Tratamento");
    expect(serviceFromText("esse é meu cabelo hoje, com volume e textura", l)).toBeNull();
  });
  it("serviceFromText: prefere em dois níveis desempata 'manutenção'", () => {
    const m = [{ label: "Manutenção unha Gel" }, { label: "Manutenção Método Fiaes" }];
    expect(serviceFromText("tem vaga para manutenção?", m, { prefere: (s) => (s.label.includes("Método") ? 2 : 1) })?.label).toBe("Manutenção Método Fiaes");
  });
  it("serviceFromText: o serviço citado, o mais específico", () => {
    expect(serviceFromText("quanto é a escova?", svcs)?.label).toBe("Escova");
    expect(serviceFromText("quero fazer progressiva", svcs)?.label).toBe("Escova Progressiva");
    expect(serviceFromText("tem horário pra manutenção?", svcs)?.label).toBe("Manutenção Método Fiaes");
    expect(serviceFromText("vi a Casa Fiaes no insta", svcs)).toBeNull();
  });
  it("openDays: pula os dias fechados da Casa", () => {
    expect(openDays("2026-10-19", CASA as never)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
    expect(openDays("2026-10-24", DEFAULT_HOURS)).toEqual(["2026-10-24", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
  });
  it("durationText e mentionsTime", () => {
    expect([durationText(60), durationText(240), durationText(90), durationText(45)]).toEqual(["1 h", "4 h", "1 h 30", "45 min"]);
    expect(mentionsTime("Tenho terça às 9h ou 13h30, qual prefere?")).toBe(true);
    expect(mentionsTime("Às 14:00 fica bom?")).toBe(true);
    expect(mentionsTime("Vou verificar a agenda e já te falo 😊")).toBe(false);
  });
  it("formatFreeHours: no máximo 8 opções e ~150 tokens, espalhadas pelos dias", () => {
    const all = Array.from({ length: 19 }, (_, k) => 540 + k * 30);
    const days: DayFree[] = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"].map((day) => ({ day, pros: ["Thaise", "Ana", "Maiara", "Gilvan"].map((name) => ({ name, starts: all })) }));
    const r = formatFreeHours({ serviceLabel: "Manutenção Método Fiaes", durationMin: 240, days, rotate: true });
    expect(r.options).toHaveLength(MAX_OPTIONS);
    // Cada opção com id curto na linha, na ordem: h1…h8.
    expect(r.options.map((o) => o.id)).toEqual(["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"]);
    for (const o of r.options) expect(r.line).toContain(`(${o.id})`);
    expect(r.line.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
    expect(r.line.length / 3.5).toBeLessThan(150); // ~3,5 caracteres por token em português
    expect((r.line.match(/\b\d{1,2}h/g) ?? []).length).toBe(8);
    for (const d of ["ter 20/10", "qua 21/10", "qui 22/10", "sex 23/10", "sáb 24/10"]) expect(r.line).toContain(d);
    expect(formatFreeHours({ serviceLabel: "Corte", durationMin: 60, days: [] }).line).toBe("Horários livres (Corte, 1 h): nenhum nos próximos 5 dias de funcionamento na agenda do CRM.");
  });
});

describe("janela pedida (dia e período) filtra as opções", () => {
  const HOJE = "2026-10-16"; // sexta
  it("parseWindow: dia da semana, amanhã, hoje, dd/mm, 'dia 20' e período; cumprimento não conta", () => {
    expect(parseWindow(["quais horários livres na terça à tarde para avaliação"], HOJE)).toEqual({ days: ["2026-10-20"], period: "tarde", label: "ter 20/10 à tarde" });
    expect(parseWindow(["Boa tarde! Tem amanhã cedo?"], HOJE)).toMatchObject({ days: ["2026-10-17"], period: "manha" });
    expect(parseWindow(["hoje à noite dá?"], HOJE)).toMatchObject({ days: ["2026-10-16"], period: "noite" });
    expect(parseWindow(["pode ser 22/10?"], HOJE)).toMatchObject({ days: ["2026-10-22"], period: null });
    expect(parseWindow(["no dia 3"], HOJE)).toMatchObject({ days: ["2026-11-03"] });
    expect(parseWindow(["queria marcar sexta", "de manhã"], HOJE)).toMatchObject({ days: ["2026-10-16"], period: "manha" });
    expect(parseWindow(["Boa tarde, quanto custa a escova?"], HOJE)).toBeNull();
  });
  const days: DayFree[] = [
    { day: "2026-10-16", pros: [{ name: "Cati", starts: [960] }, { name: "Gilvan", starts: [990] }] },
    { day: "2026-10-17", pros: [{ name: "Gilvan", starts: [540] }, { name: "Maiara", starts: [930] }] },
    { day: "2026-10-20", pros: [{ name: "Jackson", starts: [540, 780, 840, 900, 960] }, { name: "Maiara", starts: [540, 810, 870] }] },
  ];
  it("só opções dentro da janela, até 6 (caso do dono: terça à tarde para avaliação)", () => {
    const r = formatFreeHours({ serviceLabel: "AVALIAÇÃO", durationMin: 60, days, window: parseWindow(["quais horários livres na terça à tarde para avaliação"], HOJE) });
    expect(r.line).toBe("Horários livres (Avaliação, 1 h) para ter 20/10 à tarde: ter 20/10 Jackson 13h (h1), 14h (h2), 15h (h3), 16h (h4); Maiara 13h30 (h5), 14h30 (h6)");
    expect(r.options.map((o) => [o.id, o.day, o.name, o.start])).toEqual([["h1", "2026-10-20", "Jackson", 780], ["h2", "2026-10-20", "Jackson", 840], ["h3", "2026-10-20", "Jackson", 900],
      ["h4", "2026-10-20", "Jackson", 960], ["h5", "2026-10-20", "Maiara", 810], ["h6", "2026-10-20", "Maiara", 870]]);
    expect(r.fora).toBeNull();
  });
  it("nada na janela: as mais próximas, avisando", () => {
    const r = formatFreeHours({ serviceLabel: "AVALIAÇÃO", durationMin: 60, days, window: parseWindow(["terça à noite"], HOJE) });
    expect(r.line).toMatch(/^Horários livres \(Avaliação, 1 h\): nenhum livre ter 20\/10 à noite; os mais próximos: ter 20\/10 Jackson 9h/);
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.fora).toBe("ter 20/10 à noite"); // a garantia do servidor diz à cliente que ali não tem
  });
});

describe("freeHoursLine: lista da agenda do CRM", () => {
  let thaise = "", ana = "", manut = "", escova = "", maria = "";
  beforeEach(async () => {
    await resetDb();
    await db.insert(settings).values({ key: "business_hours", value: CASA });
    [thaise, ana] = (await db.insert(professionals).values([{ name: "THAISE FIAES", agendaPosition: 1 }, { name: "ana paula", agendaPosition: 2 }]).returning()).map((p) => p.id);
    [manut, escova] = (await db.insert(lists).values([
      { kind: "service", label: "Manutenção Método Fiaes", durationMin: 240, category: "Cabelo", position: 50 },
      { kind: "service", label: "Escova", category: "Cabelo", position: 51 }, // sem duração: 1 h
    ]).returning()).map((s) => s.id);
    await db.insert(professionalServices).values([{ professionalId: thaise, serviceId: manut }, { professionalId: ana, serviceId: escova }]);
    [{ id: maria }] = await db.insert(contacts).values({ name: "Carla Duarte", phoneE164: "+5571999990901" }).returning();
    // Almoço de todas, de terça a sábado.
    await db.insert(agendaBlocks).values({ professionalId: null, title: "Almoço", startsOn: "2026-10-20", endsOn: "2026-10-24", startTime: "12:00", endTime: "13:00", externalKey: "alm" });
  });

  it("serviço do texto, duração dele, dias fechados de fora, bloqueio (folga e almoço) e horário ocupado respeitados", async () => {
    await db.insert(agendaBlocks).values({ professionalId: thaise, title: "Folga", startsOn: "2026-10-21", endsOn: "2026-10-21", startTime: "00:00", endTime: "23:59", externalKey: "folga" });
    await db.insert(appointments).values({ professionalId: thaise, clientName: "Outra", serviceLabel: "Corte", startsAt: at("2026-10-22", "13:00"), durationMin: 60, status: "agendado", origin: "crm", externalKey: "a1" });
    const r = await freeHoursLine({ contactId: maria, dealServiceId: null, texts: ["Oi! tem horário pra manutenção essa semana?"], now: NOW });
    // 4 h com almoço 12–13 e fim às 18h: só 13h–14h cabem; quarta é folga; quinta 13h está ocupado → 14h.
    expect(r?.line).toBe("Horários livres (Manutenção Método Fiaes, 4 h): ter 20/10 Thaise 13h (h1) · qui 22/10 Thaise 14h (h2) · sex 23/10 Thaise 13h (h3) · sáb 24/10 Thaise 13h (h4)");
    // O servidor guarda o que cada id quer dizer: dia, hora, profissional, serviço e duração.
    expect(r?.options[1]).toEqual({ id: "h2", day: "2026-10-22", time: "14:00", professionalId: thaise, professionalName: "THAISE FIAES", serviceId: manut, serviceLabel: "Manutenção Método Fiaes", durationMin: 240, origem: "lista" });
  });

  it("dia pedido além de 3 semanas (\"dia 21/11\") é lido na agenda, não vira \"nenhum livre\" (coerência, 20/10)", async () => {
    const r = await freeHoursLine({ contactId: maria, dealServiceId: null, texts: ["Agenda minha manutenção para dia 21/11 então"], now: NOW });
    expect(r?.options[0]?.day).toBe("2026-11-21");
    expect(r?.line).not.toMatch(/nenhum livre/);
  });

  it("dia especial fechado não entra nas sugestões (mesmo pedido pela cliente); dia reduzido só oferece dentro da janela", async () => {
    await db.insert(settings).values({ key: "dias_especiais", value: [{ day: "2026-10-24", window: null, text: null }] });
    const r = await freeHoursLine({ contactId: maria, dealServiceId: escova, texts: ["tem pra sábado?"], now: NOW });
    expect(r?.options.some((o) => o.day === "2026-10-24")).toBe(false);
    expect(r?.options.length).toBeGreaterThan(0);
    await db.update(settings).set({ value: [{ day: "2026-10-24", window: ["09:00", "11:00"], text: null }] }).where(eq(settings.key, "dias_especiais"));
    const r2 = await freeHoursLine({ contactId: maria, dealServiceId: escova, texts: ["tem pra sábado?"], now: NOW });
    expect(r2?.line).toBe("Horários livres (Escova, 1 h) para sáb 24/10: sáb 24/10 Ana 9h (h1), 10h (h2)");
    // Profissional com horário próprio também respeita o dia especial.
    await db.update(professionals).set({ workHours: { "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": [["08:00", "18:00"]] } }).where(eq(professionals.id, ana));
    const r3 = await freeHoursLine({ contactId: maria, dealServiceId: escova, texts: ["tem pra sábado?"], now: NOW });
    expect(r3?.options.filter((o) => o.day === "2026-10-24").map((o) => o.time)).toEqual(["09:00", "10:00"]);
  });

  it("serviço sem duração: 1 h; serviço da conversa quando o texto não cita", async () => {
    const r = await freeHoursLine({ contactId: maria, dealServiceId: escova, texts: ["tem pra sábado?"], now: NOW });
    // Pediu sábado: só sábado (mesmo além dos próximos dias), com mais opções.
    expect(r?.line).toBe("Horários livres (Escova, 1 h) para sáb 24/10: sáb 24/10 Ana 9h (h1), 10h (h2), 11h (h3), 13h (h4), 14h (h5), 15h (h6)");
    expect(r?.options).toHaveLength(6);
  });

  it("0084: a IA oferece cada profissional com o tempo dela (Ana leva 150 min na Escova: 10h e 11h não cabem antes do almoço)", async () => {
    await db.update(professionalServices).set({ durationMin: 150 }).where(eq(professionalServices.professionalId, ana));
    const r = await freeHoursLine({ contactId: maria, dealServiceId: escova, texts: ["tem pra sábado?"], now: NOW });
    const times = (r?.options ?? []).map((o) => o.time);
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("11:00");
    expect(times).toContain("09:00");
    expect(r?.options.every((o) => o.durationMin === 150)).toBe(true);
  });

  it("pacote ativo: o serviço do pacote; sem nada: as de cabelo, 1 h", async () => {
    await db.insert(clientPackages).values({ contactId: maria, packageName: "Pacote Método Fiaes", serviceLabel: "Manutenção Método Fiaes", totalSessions: 4, usedSessions: 1, externalKey: "p1" });
    expect((await freeHoursLine({ contactId: maria, dealServiceId: null, texts: ["quando tem vaga?"], now: NOW }))?.line).toMatch(/^Horários livres \(Manutenção Método Fiaes, 4 h\)/);
    const [{ id: nova }] = await db.insert(contacts).values({ name: "Nova", phoneE164: "+5571999990902" }).returning();
    const r = await freeHoursLine({ contactId: nova, dealServiceId: null, texts: ["quando tem vaga?"], now: NOW });
    expect(r?.line).toMatch(/^Horários livres \(cabelo, 1 h\): /);
    expect(r?.line).toContain("Thaise");
    expect(r?.line).toContain("Ana");
  });

  it("assistente (17/10): a IA nunca oferece a assistente como quem atende", async () => {
    await db.update(professionals).set({ assistantOf: thaise }).where(eq(professionals.id, ana));
    const [{ id: nova }] = await db.insert(contacts).values({ name: "Nova", phoneE164: "+5571999990903" }).returning();
    const r = await freeHoursLine({ contactId: nova, dealServiceId: null, texts: ["quando tem vaga?"], now: NOW });
    expect(r?.line).toContain("Thaise");
    expect(r?.line).not.toContain("Ana");
    expect((await freeHoursLine({ contactId: nova, dealServiceId: escova, texts: ["tem pra sábado?"], now: NOW }))?.line ?? "").not.toContain("Ana");
  });

  it("pacote do Avec em várias linhas (uma por serviço) é uma compra: serviço conhecido da compra; compra esgotada não conta", async () => {
    const combo = { contactId: maria, packageName: "Combo Manutenção Método Fiaes", totalSessions: 4, priceCents: 800000, purchasedOn: "2026-09-01", validUntil: "2027-09-01" };
    await db.insert(clientPackages).values([
      { ...combo, serviceLabel: "Finalização Metodo Fiaes", usedSessions: 0, externalKey: "c1" }, // não está no cadastro
      { ...combo, serviceLabel: "Manutenção Método Fiaes", usedSessions: 1, externalKey: "c2" },
    ]);
    expect((await freeHoursLine({ contactId: maria, dealServiceId: null, texts: ["quando tem vaga?"], now: NOW }))?.line).toMatch(/^Horários livres \(Manutenção Método Fiaes, 4 h\)/);
    // Um serviço da compra com as 4 sessões usadas = compra esgotada: não vale o outro serviço dela.
    await db.update(clientPackages).set({ usedSessions: 4 }).where(eq(clientPackages.externalKey, "c1"));
    expect((await freeHoursLine({ contactId: maria, dealServiceId: null, texts: ["quando tem vaga?"], now: NOW }))?.line).toMatch(/^Horários livres \(cabelo, 1 h\)/);
  });
});

describe("concordância da cliente e o horário que a Casa ofereceu (partes puras)", () => {
  it("isAgreement: 'pode ser', 'sim', 'fechado', 'quero', 'a das 16h30'; não/pergunta/outro dia não", () => {
    for (const t of ["Pode ser!", "sim", "Sim, pode ser 😊", "fechado", "Quero", "ok", "Perfeito, pode marcar", "a das 16h30", "16h30 pode ser", "Isso mesmo"]) expect(isAgreement([t]), t).toBe(true);
    for (const t of ["Não posso nesse dia", "Tem outro horário?", "pode ser às 16h?", "Obrigada pela informação, vou ver com meu marido e depois te falo", "quanto custa?", ""]) expect(isAgreement([t]), t).toBe(false);
  });
  it("hourMentions: 15h, 16h30, 14:00, às 9 (não confunde data nem preço)", () => {
    expect(hourMentions("Tenho terça, 21/10, às 15h com a Thaise ou às 16h30 com a Ana").map((h) => h.start)).toEqual([900, 990]);
    expect(hourMentions("Pode ser às 9? ou 14:00").map((h) => h.start)).toEqual([540, 840]);
    expect(hourMentions("dia 20/10, R$ 150")).toEqual([]);
  });
  const PROS = [{ id: "p-thaise", name: "THAISE FIAES" }, { id: "p-ana", name: "Ana Paula" }, { id: "p-jack", name: "Jackson" }];
  it("offeredSlot: um horário só; com dois, vale o que ela citou; sem citar, ambíguo; profissional mais perto do horário", () => {
    const hoje = "2026-10-16"; // sexta
    expect(offeredSlot({ casa: "Tenho terça, 20/10, às 15h com a Thaise. Posso reservar?", client: ["pode ser"], today: hoje, pros: PROS }))
      .toEqual({ status: "ok", day: "2026-10-20", start: 900, proId: "p-thaise" });
    const dois = "Tenho terça às 15h com a Thaise ou quarta às 16h30 com a Ana. Posso reservar?";
    expect(offeredSlot({ casa: dois, client: ["pode ser"], today: hoje, pros: PROS })).toEqual({ status: "ambiguo", times: [900, 990] });
    expect(offeredSlot({ casa: dois, client: ["a das 16h30"], today: hoje, pros: PROS })).toEqual({ status: "ok", day: "2026-10-21", start: 990, proId: "p-ana" });
    // Sem dia na mensagem da Casa: o dia que a cliente tinha pedido antes.
    expect(offeredSlot({ casa: "Tenho às 10h com o Jackson", client: ["fechado"], before: ["tem amanhã?"], today: hoje, pros: PROS })).toEqual({ status: "ok", day: "2026-10-17", start: 600, proId: "p-jack" });
    expect(offeredSlot({ casa: "Tenho às 10h com o Jackson", client: ["fechado"], today: hoje, pros: PROS })).toBeNull();
    expect(offeredSlot({ casa: "Vou ver a agenda!", client: ["ok"], today: hoje, pros: PROS })).toBeNull();
  });
  it("metodoTopic: método, transição, preenchimento, aplicação, manutenção, revisão", () => {
    expect(metodoTopic(["Quero conhecer o Método Fiaes"])).toBe(true);
    expect(metodoTopic(["queria fazer a transição"])).toBe(true);
    expect(metodoTopic(["quanto custa a escova?"])).toBe(false);
  });
});

describe("regra do Método: avaliação do Método SÓ com a Thaise ('A IA oferece só com')", () => {
  let thaise = "", jackson = "", maiara = "", aval = "", manut = "", maria = "";
  beforeEach(async () => {
    await resetDb();
    await db.insert(settings).values({ key: "business_hours", value: CASA });
    const ps = await db.insert(professionals).values([{ name: "JACKSON", agendaPosition: 1 }, { name: "MAIARA", agendaPosition: 2 }, { name: "THAISE FIAES", agendaPosition: 3 }]).returning();
    [jackson, maiara, thaise] = ["JACKSON", "MAIARA", "THAISE FIAES"].map((n) => ps.find((p) => p.name === n)!.id);
    [aval, manut] = (await db.insert(lists).values([
      { kind: "service", label: "AVALIAÇÃO", durationMin: 60, category: "Cabelo", position: 60 },
      { kind: "service", label: "Manutenção Método Fiaes", durationMin: 240, category: "Cabelo", position: 61 },
    ]).returning()).map((s) => s.id);
    // Como em produção: a AVALIAÇÃO ligada a várias profissionais (a Casa vai acertar; o código garante a regra mesmo assim).
    await db.insert(professionalServices).values([thaise, jackson, maiara].map((p) => ({ professionalId: p, serviceId: aval })));
    await db.insert(professionalServices).values([{ professionalId: maiara, serviceId: manut }]);
    [{ id: maria }] = await db.insert(contacts).values({ name: "Carla Duarte", phoneE164: "+5571999990911" }).returning();
  });
  const regra = (scope: "sempre" | "metodo") => db.update(lists).set({ aiProIds: [thaise], aiProScope: scope }).where(eq(lists.id, aval));
  const line = async (text: string) => (await freeHoursLine({ contactId: maria, dealServiceId: null, texts: [text], now: NOW }))!;

  it("assunto Método: só a Thaise (nunca Jackson ou Maiara), mesmo com o cadastro de quem faz mais largo", async () => {
    await regra("metodo");
    const r = await line("Quero agendar a avaliação do Método Fiaes, tem terça à tarde?");
    expect(r.line).toMatch(/^Horários livres \(Avaliação, 1 h; só com Thaise\) para ter 20\/10 à tarde: ter 20\/10 Thaise 12h \(h1\)/);
    expect(r.line).not.toMatch(/Jackson|Maiara/);
    expect(new Set(r.options.map((o) => o.professionalId))).toEqual(new Set([thaise]));
    expect(r.options[0]).toMatchObject({ serviceId: aval, serviceLabel: "AVALIAÇÃO", durationMin: 60, professionalName: "THAISE FIAES" });
  });
  it("só 'quero conhecer o Método' (sem citar serviço) e ainda não é do Método: começa pela avaliação com a Thaise", async () => {
    await regra("metodo");
    const r = await line("Oi! Quero conhecer o Método Fiaes, tem horário essa semana?");
    expect(r.line).toMatch(/^Horários livres \(Avaliação, 1 h; só com Thaise\)/);
    expect(r.line).not.toMatch(/Jackson|Maiara/);
  });
  it("caso Mary (17/10): Método só no resto da conversa + 'semana do dia 26' sem Thaise: próximos DELA até 30 dias, nunca outra profissional", async () => {
    await regra("metodo");
    const context = ["Comecei a transição e vi alguns relatos no IG sobre o método", "Mary, já conhece o método Fiaes?", "Oi cati Pode ser na semana do dia 26?"];
    const ask = () => freeHoursLine({ contactId: maria, dealServiceId: null, texts: ["Oi cati Pode ser na semana do dia 26?"], now: NOW, context });
    // Com Thaise livre na semana: a semana inteira é a janela.
    const ok = (await ask())!;
    expect(ok.line).toMatch(/^Horários livres \(Avaliação, 1 h; só com Thaise\) para semana de 26\/10: ter 27\/10 Thaise 9h \(h1\)/);
    // Thaise de folga de 26/10 a 08/11: avisa e oferece os próximos dela (10/11), não os de antes nem de outra.
    await db.insert(agendaBlocks).values({ professionalId: thaise, title: "Curso", startsOn: "2026-10-26", endsOn: "2026-11-08", startTime: "00:00", endTime: "23:59", externalKey: "curso" });
    const r = (await ask())!;
    expect(r.line).toMatch(/^Horários livres \(Avaliação, 1 h; só com Thaise\): nenhum livre semana de 26\/10; os mais próximos: ter 10\/11 Thaise/);
    expect(r.line).not.toMatch(/Jackson|Maiara|Cati/);
    expect(new Set(r.options.map((o) => o.professionalId))).toEqual(new Set([thaise]));
    expect(r.options.every((o) => o.day >= "2026-11-10" && o.day <= "2026-11-18")).toBe(true);
    // Sem o Método na conversa: não vira avaliação do Método.
    const semMetodo = (await freeHoursLine({ contactId: maria, dealServiceId: null, texts: ["Pode ser na semana do dia 26?"], now: NOW, context: ["Oi", "Pode ser na semana do dia 26?"] }))!;
    expect(semMetodo.line).not.toContain("só com Thaise");
  });

  it("avaliação sem ser do Método: a regra 'só quando é Método' não vale (quem faz)", async () => {
    await regra("metodo");
    const r = await line("Tem horário pra avaliação sábado?");
    expect(r.line).toContain("Jackson");
    expect(r.line).toContain("Thaise");
  });
  it("regra 'sempre': só a Thaise em qualquer conversa; sem regra: quem faz", async () => {
    expect((await line("Tem horário pra avaliação sábado?")).line).toContain("Jackson");
    await regra("sempre");
    const r = await line("Tem horário pra avaliação sábado?");
    expect(r.line).not.toMatch(/Jackson|Maiara/);
    expect(r.line).toContain("Thaise");
  });
  it("cliente que já é do Método pedindo manutenção: o serviço dela, sem a regra da avaliação", async () => {
    await regra("metodo");
    const r = await line("Tem vaga pra minha manutenção na sexta?");
    expect(r.line).toMatch(/^Horários livres \(Manutenção Método Fiaes, 4 h\)/);
    expect(r.line).toContain("Maiara");
  });

  it("migration 0050 (dados): liga a AVALIAÇÃO à regra 'Thaise, só quando é Método' sem apagar quem faz; não sobrescreve regra da Casa; roda de novo sem mudar", async () => {
    const stmt = readFileSync("drizzle/0050_ia_marca.sql", "utf8").split("--> statement-breakpoint").find((x) => /UPDATE "lists"/.test(x))!;
    // Com acento no cadastro ("THAÍSE FIAES") também vale.
    await db.update(professionals).set({ name: "THAÍSE FIAES" }).where(eq(professionals.id, thaise));
    await db.execute(sql.raw(stmt));
    const [a] = await db.select().from(lists).where(eq(lists.id, aval));
    expect(a).toMatchObject({ aiProIds: [thaise], aiProScope: "metodo" });
    expect(await db.select().from(professionalServices).where(eq(professionalServices.serviceId, aval))).toHaveLength(3);
    const [m] = await db.select().from(lists).where(eq(lists.id, manut));
    expect(m.aiProIds).toBeNull();
    // A Casa mudou a regra: rodar de novo não mexe.
    await db.update(lists).set({ aiProIds: [maiara], aiProScope: "sempre" }).where(eq(lists.id, aval));
    await db.execute(sql.raw(stmt));
    expect((await db.select().from(lists).where(eq(lists.id, aval)))[0]).toMatchObject({ aiProIds: [maiara], aiProScope: "sempre" });
  });
});

describe("pediuHorario: a cliente pediu horário de verdade (a garantia do servidor só age aí)", () => {
  it("pedido de horário, remarcação e hora", () => {
    for (const t of ["Tem horário sábado à tarde?", "quero agendar", "pode ser 15h?", "Consegue reagendar por favor o procedimento para 12:00?", "quero remarcar, vou precisar cancelar o de amanhã", "tem vaga amanhã?"])
      expect(pediuHorario([t]), t).toBe(true);
  });
  it("cancelamento sem remarcar, pergunta de preço, cumprimento", () => {
    for (const t of ["Infelizmente vou precisar desagendar", "quero cancelar meu horário", "pode desmarcar, por favor", "Quanto custa a manutenção?", "Bom dia", "ele está livre de química?"])
      expect(pediuHorario([t]), t).toBe(false);
  });
});

describe("isAgreement: a concordância como as clientes escrevem (avaliação real de 17/10: 6 de 20 sem horário por isso)", () => {
  it("com 'então'/'oi'/'bom dia' antes, 'correto', hora solta e pergunta de confirmação", () => {
    for (const t of [["Então pode ser 14:30"], ["Oi, pode marcar!"], ["Bom dia Confirmado", "As 13:00 né"], ["Obrigado", "As 13:00hs", "Correto"],
      ["Então ficamos com 14:30 mesmo?"], ["Bom dia. Certo! Só para confirmar, 9h?"], ["As 13:00 né"]]) expect(isAgreement(t), t.join(" / ")).toBe(true);
  });
  it("continua não sendo: pergunta de outro horário, recusa, dúvida", () => {
    for (const t of ["pode ser às 16h?", "Tem outro horário?", "Não posso nesse dia", "Então não vai dar", "Oi, quanto custa?", "Bom dia, tem horário sábado?"])
      expect(isAgreement([t]), t).toBe(false);
  });
});

describe("'sábado que vem' (caso Leomar, avaliação real de 17/10)", () => {
  it("dito na sexta: o sábado da semana seguinte; 'sábado' sozinho: amanhã; dito na segunda: o sábado desta semana", () => {
    expect(parseWindow(["Existe a possibilidade de remarcar p sabado que vem?"], "2026-10-16")?.days).toEqual(["2026-10-24"]);
    expect(parseWindow(["pode ser no próximo sábado?"], "2026-10-16")?.days).toEqual(["2026-10-24"]);
    expect(parseWindow(["tem sábado?"], "2026-10-16")?.days).toEqual(["2026-10-17"]);
    expect(parseWindow(["sábado que vem dá?"], "2026-10-19")?.days).toEqual(["2026-10-24"]);
  });
});

describe("revisão final (ia-horarios2): concordância, pedido de horário e contraproposta", () => {
  it("F1: pedido que começa com cumprimento não é concordância", () => {
    for (const t of ["Oi, quero saber se tem sábado", "Bom dia, quero marcar escova", "Então prefiro sábado", "Bom dia, agenda pra mim uma escova", "Bom dia, quero marcar escova pra sábado"])
      expect(isAgreement([t]), t).toBe(false);
    for (const t of ["Quero", "Quero sim", "Oi, pode marcar!", "Perfeito, pode marcar", "Sim, pode ser 😊", "Então pode ser 14:30"]) expect(isAgreement([t]), t).toBe(true);
  });
  it("F2: agradecimento, atraso e reclamação com 'hoje' não são pedido; cancelamento em mensagens separadas também não", () => {
    for (const t of [["Obrigada pelo atendimento de hoje, amei!"], ["Vou chegar 10 min atrasada hoje"], ["Estou insatisfeita com a escova de hoje"],
      ["Infelizmente vou precisar desagendar", "o de amanhã não vou conseguir"]]) expect(pediuHorario(t), t.join(" / ")).toBe(false);
    for (const t of [["Vou viajar realmente preciso fazer as luzes quarta", "Por isso estou perguntando"], ["Oi cati Pode ser na semana do dia 26?"], ["amanhã às 15h dá?"]])
      expect(pediuHorario(t), t.join(" / ")).toBe(true);
  });
  it("F4: a cliente responde com OUTRA hora (contraproposta): não confirma a hora da Casa", () => {
    const PROS = [{ id: "p-thaise", name: "THAISE FIAES" }];
    const casa = "Tenho terça, 20/10, às 15h com a Thaise. Posso reservar?";
    expect(offeredSlot({ casa, client: ["As 16h"], today: "2026-10-16", pros: PROS })).toBeNull();
    expect(offeredSlot({ casa: "Tenho terça, 20/10, às 14h com a Thaise. Posso reservar?", client: ["Então pode ser 14:30"], today: "2026-10-16", pros: PROS })).toBeNull();
    expect(offeredSlot({ casa, client: ["pode ser às 15h"], today: "2026-10-16", pros: PROS })).toMatchObject({ status: "ok", start: 900 });
  });
});

describe("coerência (20/10): pedido de horário NOVO (gatilho da garantia) e conversa real", () => {
  it("recusa, remarcação sem dia, pedido para conferir e o horário que ela já tem não são pedido de horário novo", () => {
    expect(pediuHorarioNovo(["Querida, vou dar mais um tempo. Não deixe esse horário reservado. Vou pensar."])).toBe(false);
    expect(pediuHorarioNovo(["Olá bom dia, eu adoeci", "Vou precisar remarcar"])).toBe(false);
    expect(pediuHorarioNovo(["confirma c jackson o horário", "Verifica com ele pra mim, por favor"])).toBe(false);
    expect(pediuHorarioNovo(["Bom dia! Pode deixar a progressiva marcada com a cabeleireira que fez da última vez?"], { temHorario: true })).toBe(false);
  });
  it("continuam pedido: remarcar com dia, vaga com dia, quem já tem horário pedindo outro", () => {
    expect(pediuHorarioNovo(["Vou precisar remarcar meu dia com Gilvan. Vamos remarcar para terça dia 20, pode ser?"])).toBe(true);
    expect(pediuHorarioNovo(["Amanhã nao, tem vaga no sábado?"])).toBe(true);
    expect(pediuHorarioNovo(["Tem horário pra unha também?"], { temHorario: true })).toBe(true);
    expect(pediuHorarioNovo(["Tem vaga para manutenção dia 24/09?"], { temHorario: true })).toBe(true);
  });
  it("\"Fica sim\" (resposta a \"fica bom para você?\") é concordância; \"fica longe\" não", () => {
    expect(isAgreement(["Fica sim"])).toBe(true);
    expect(isAgreement(["Fica sim! Vamos agendar"])).toBe(true);
    expect(isAgreement(["fica ótimo"])).toBe(true);
    expect(isAgreement(["fica longe pra mim"])).toBe(false);
  });
  it("serviço do texto: nome de profissional não conta; no empate vale o assunto dela", () => {
    const svcs = [{ label: "Corte Thaise Fiaes" }, { label: "Retoque de raiz" }, { label: "Manutenção unha Gel" }, { label: "Manutenção Método Fiaes" }];
    expect(serviceFromText("Quero marcar o retoque de raiz pintura com Thaise", svcs, { nomes: ["THAISE FIAES"] })?.label).toBe("Retoque de raiz");
    expect(serviceFromText("quero marcar com Thaise", svcs, { nomes: ["THAISE FIAES"] })).toBeNull();
    expect(serviceFromText("quero um corte no sábado", [{ label: "Corte Thaise Fiaes" }, { label: "Corte Feminino" }], { nomes: ["THAISE FIAES"] })?.label).toBe("Corte Feminino");
    expect(serviceFromText("Tem vaga para manutenção dia 24/09?", svcs)?.label).toBe("Manutenção unha Gel"); // sem assunto: o nome mais curto
    expect(serviceFromText("Tem vaga para manutenção dia 24/09?", svcs, { prefere: (x) => /m[eé]todo/i.test(x.label) })?.label).toBe("Manutenção Método Fiaes");
  });
  it("\"segunda semana\" é a 2ª semana, não segunda-feira", () => {
    expect(parseWindow(["Pode ser na segunda semana"], "2026-09-19")).toBeNull();
    expect(parseWindow(["segunda à tarde"], "2026-09-19")?.days).toEqual(["2026-09-21"]);
    expect(parseWindow(["Agenda minha manutenção para dia 21/11 então"], "2026-09-19")?.days).toEqual(["2026-11-21"]); // não o dia 21 deste mês
  });
});
