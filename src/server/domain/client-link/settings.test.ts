import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, lists, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import {
  DEFAULT_LINK_TEXT, DEFAULT_REMINDER_TEXT, DEFAULT_RESCHEDULED_TEXT, getCasaInfo, getClientLinkSettings, getLembreteD1, getOnlineBooking, saveCasaInfo, saveClientLinkSettings, saveOnlineBooking,
} from "./settings";

let g = "";
beforeEach(async () => { await resetDb(); g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id; });

describe("agendamento online: ligar exige serviço (QA r58, I-5)", () => {
  it("ligar sem nenhum serviço marcado é recusado com \"Escolha ao menos um serviço\"; desligado salva", async () => {
    await expect(saveOnlineBooking({ enabled: true, antecedenciaMin: 60, diasAFrente: 40, servicos: [], profissionais: [] }, g)).rejects.toThrow("Escolha ao menos um serviço");
    expect((await getOnlineBooking()).enabled).toBe(false);
    await saveOnlineBooking({ enabled: false, antecedenciaMin: 60, diasAFrente: 40, servicos: [], profissionais: [] }, g);
  });

  it("só serviços sem duração também não abrem a página (eles não aparecem no site)", async () => {
    const [semDuracao] = await db.insert(lists).values({ kind: "service", label: "Mechas", position: 90 }).returning();
    await expect(saveOnlineBooking({ enabled: true, antecedenciaMin: 60, diasAFrente: 40, servicos: [semDuracao.id], profissionais: [] }, g)).rejects.toThrow("Escolha ao menos um serviço com duração");
    const [corte] = await db.insert(lists).values({ kind: "service", label: "Corte 60", position: 91, durationMin: 60 }).returning();
    await saveOnlineBooking({ enabled: true, antecedenciaMin: 60, diasAFrente: 40, servicos: [semDuracao.id, corte.id], profissionais: [] }, g);
    expect((await getOnlineBooking()).enabled).toBe(true);
  });
});

describe("configurações da área da cliente (seção 3.1)", () => {
  it("sem as chaves: tudo desligado e com os padrões da spec (o seed não grava nada)", async () => {
    expect(await getCasaInfo()).toEqual({ endereco: null, whatsapp: null, mapa: null, latitude: null, longitude: null });
    expect(await getClientLinkSettings()).toEqual({ cancelarAteHoras: 24, texto: DEFAULT_LINK_TEXT });
    // Pedido do dono (15/10): 24 h antes, sem link por padrão (comLink), e a mensagem de "remarcado"; tudo desligado.
    expect(await getLembreteD1()).toEqual({ enabled: false, comLink: false, texto: DEFAULT_REMINDER_TEXT, textoRemarcado: DEFAULT_RESCHEDULED_TEXT });
    expect(DEFAULT_REMINDER_TEXT).not.toContain("{link}");
    expect(DEFAULT_RESCHEDULED_TEXT).not.toContain("{link}");
    expect(await getOnlineBooking()).toEqual({ enabled: false, antecedenciaMin: 60, diasAFrente: 40, servicos: [], profissionais: [] });
  });

  it("pino da Casa (Como chegar): latitude e longitude juntas, dentro dos limites", async () => {
    await saveCasaInfo({ endereco: "Rua A", whatsapp: null, latitude: -12.9714, longitude: -38.5014 }, g);
    expect(await getCasaInfo()).toMatchObject({ latitude: -12.9714, longitude: -38.5014 });
    await expect(saveCasaInfo({ endereco: null, whatsapp: null, latitude: -12.9, longitude: null }, g)).rejects.toThrow("Preencha latitude e longitude juntas");
    await expect(saveCasaInfo({ endereco: null, whatsapp: null, latitude: 91, longitude: 0 }, g)).rejects.toThrow("Latitude de -90 a 90.");
    await saveCasaInfo({ endereco: null, whatsapp: null }, g);
    expect(await getCasaInfo()).toMatchObject({ latitude: null, longitude: null });
  });

  it("salva com auditoria; WhatsApp vira E.164; endereço vazio fica sem endereço; prazo fora de 0–168 h é recusado", async () => {
    await saveCasaInfo({ endereco: " Rua das Flores, 10 - Pituba ", whatsapp: "71 98888-7777", mapa: " https://maps.app.goo.gl/casa " }, g);
    expect(await getCasaInfo()).toEqual({ endereco: "Rua das Flores, 10 - Pituba", whatsapp: "+5571988887777", mapa: "https://maps.app.goo.gl/casa", latitude: null, longitude: null });
    await saveCasaInfo({ endereco: "", whatsapp: "" }, g);
    expect(await getCasaInfo()).toEqual({ endereco: null, whatsapp: null, mapa: null, latitude: null, longitude: null });
    await expect(saveCasaInfo({ endereco: null, whatsapp: "123" }, g)).rejects.toThrow("WhatsApp inválido. Use DDD + número.");
    await expect(saveCasaInfo({ endereco: null, whatsapp: null, mapa: "maps da casa" }, g)).rejects.toThrow("O link do mapa começa com https://");
    await saveClientLinkSettings({ cancelarAteHoras: 0, texto: "Oi, {primeiro_nome}! {link}" }, g);
    expect((await getClientLinkSettings()).cancelarAteHoras).toBe(0);
    await expect(saveClientLinkSettings({ cancelarAteHoras: 200, texto: DEFAULT_LINK_TEXT }, g)).rejects.toThrow("Use de 0 a 168 horas.");
    await saveOnlineBooking({ enabled: false, antecedenciaMin: 120, diasAFrente: 30, servicos: [], profissionais: [] }, g);
    expect((await getOnlineBooking()).antecedenciaMin).toBe(120);
    expect((await db.select().from(auditLog).where(eq(auditLog.entity, "settings"))).map((a) => a.entityId)).toEqual(["casa_info", "casa_info", "cliente_link", "agendamento_online"]);
  });
});
