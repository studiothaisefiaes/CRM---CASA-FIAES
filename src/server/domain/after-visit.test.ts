import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { appointments, auditLog, channels, contacts, deals, outbox, stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { setSetting } from "../../../test/agenda-fixtures";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { createVisit } from "./agenda/visits";
import { setAppointmentStatus } from "./appointments";
import { addPayment, closeComanda, openComandaForAppointment } from "./caixa/comandas";
import { drainOutbox } from "./outbox";
import { AFTER_VISIT_SOURCE, afterVisitDone, afterVisitHook, getAfterVisit, runAfterVisit, saveAfterVisit, type AfterVisitConfig } from "./after-visit";
import { CASA_AGRADECIMENTO } from "@/lib/casa-texts";
import { VIRADA_FALTA, VIRADA_ITENS } from "@/lib/virada";
import { getVirada, saveVirada } from "./virada";
import { fazerVirada } from "../../../test/virada";

/** Instante de Salvador (UTC−3). */
const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const at = (iso: string) => new Date(iso);
const GOOGLE = "https://g.page/r/casa-fiaes/review";
const OBRIGADA = "Oi, Paula! Obrigada por estar com a gente hoje na Casa Fiaes. 💛\n\nSe puder, conte como foi no Google. Sua avaliação ajuda muito: https://g.page/r/casa-fiaes/review\n\nE quando quiser voltar, pergunte pelos nossos Combos Especiais.";

// Provider falso: nenhum teste fala com a Evolution nem envia mensagem real.
const sent: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { sent.push(text); return { externalId: `OUT${sent.length}` }; },
  sendPoll: async () => ({ externalId: "POLL" }),
};

let s: Awaited<ReturnType<typeof setupCaixa>>;
let seq = 0;
const outboxRows = () => db.select().from(outbox);
/** Liga como a tela da Virada (Task 10, ruling R4): checklist feito, teste recente do modo e a confirmação de envio real. */
const ligado = async (patch: Partial<AfterVisitConfig> = {}) => {
  const mode = patch.mode ?? "agradecimento";
  if (mode !== "desligado") await fazerVirada("depois", s.gestora.id, mode);
  return saveAfterVisit({ ...(await getAfterVisit()), mode, linkGoogle: GOOGLE, ...patch }, s.gestora.id, { confirmouEnvio: true });
};

/** Cliente com conversa aberta. */
async function cliente(name = "Paula Souza") {
  const [c] = await db.insert(contacts).values({ name, phoneE164: `+5571988${String(++seq).padStart(6, "0")}` }).returning();
  const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
  const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id }).returning();
  return { contactId: c.id, dealId: d.id };
}
/** Visita de Corte (Ana) + Hidratação (Bia) no dia, a partir de `hm`. */
async function visita(contactId: string, day = "2026-10-20", hm = "13:00", n = 2) {
  const items = [{ serviceId: s.corte.id, professionalId: s.ana.id }, { serviceId: s.hidratacao.id, professionalId: s.bia.id }].slice(0, n)
    .map((i, k) => ({ ...i, preference: "escolhida" as const, mode: k ? "depois" as const : undefined }));
  const v = await createVisit({ requestKey: randomUUID(), client: { contactId }, startsAt: bahia(day, hm).toISOString(), items }, s.recepcao, bahia("2026-10-15", "09:00"));
  return v;
}
/** Todos os horários da visita Finalizados em `when` (direto no banco: sem o gancho da porta, para testar a função sozinha). */
const finishAll = async (visitId: string, when: Date) =>
  db.update(appointments).set({ status: "compareceu", arrivedAt: when, finishedAt: when, updatedAt: when }).where(eq(appointments.visitId, visitId));

beforeEach(async () => {
  sent.length = 0;
  await resetDb();
  s = await setupCaixa();
  setWhatsappProvider(fake);
  await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" });
  await setSetting("business_hours", { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "18:00"] });
});
afterEach(() => { setWhatsappProvider(null); vi.useRealTimers(); });

describe("Depois do atendimento: quando entra na fila", () => {
  it("visita com todos os serviços Finalizados: o agradecimento entra na fila para 2 h depois, uma vez só", async () => {
    await ligado();
    const p = await cliente();
    const { visitId } = await visita(p.contactId);
    await finishAll(visitId, at("2026-10-20T17:00:00Z"));
    expect(await afterVisitDone(visitId, at("2026-10-20T17:00:00Z"))).toBe("enfileirado");
    expect(await afterVisitDone(visitId, at("2026-10-20T17:01:00Z"))).toBe("ja_tem");
    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ notBefore: at("2026-10-20T19:00:00Z"), dealId: p.dealId, kind: "text", text: OBRIGADA, options: { source: `${AFTER_VISIT_SOURCE}${visitId}` } });
  });

  it("visita com um serviço ainda em atendimento não dispara", async () => {
    await ligado();
    const p = await cliente();
    const v = await visita(p.contactId);
    await finishAll(v.visitId, at("2026-10-20T17:00:00Z"));
    await db.update(appointments).set({ status: "em_atendimento", finishedAt: null }).where(eq(appointments.id, v.appointmentIds[1]));
    expect(await afterVisitDone(v.visitId, at("2026-10-20T17:00:00Z"))).toBe("nao_concluida");
    expect(await outboxRows()).toHaveLength(0);
  });

  it("cliente que faltou não recebe (nem com um serviço Finalizado e o outro com falta)", async () => {
    await ligado();
    const a = await cliente("Ana Clara");
    const va = await visita(a.contactId);
    await db.update(appointments).set({ status: "faltou" }).where(eq(appointments.visitId, va.visitId));
    expect(await afterVisitDone(va.visitId, at("2026-10-20T17:00:00Z"))).toBe("nao_concluida");
    const b = await cliente("Zélia Igarashi");
    const vb = await visita(b.contactId, "2026-10-20", "15:00");
    await finishAll(vb.visitId, at("2026-10-20T19:00:00Z"));
    await db.update(appointments).set({ status: "faltou", finishedAt: null }).where(eq(appointments.id, vb.appointmentIds[1]));
    expect(await afterVisitDone(vb.visitId, at("2026-10-20T19:00:00Z"))).toBe("nao_concluida");
    expect(await runAfterVisit(at("2026-10-20T19:05:00Z"))).toEqual({ enqueued: 0 });
    expect(await outboxRows()).toHaveLength(0);
  });

  it("serviço cancelado na visita não conta: o resto Finalizado conclui", async () => {
    await ligado();
    const p = await cliente();
    const v = await visita(p.contactId);
    await finishAll(v.visitId, at("2026-10-20T17:00:00Z"));
    await db.update(appointments).set({ status: "cancelado", finishedAt: null }).where(eq(appointments.id, v.appointmentIds[1]));
    expect(await afterVisitDone(v.visitId, at("2026-10-20T17:00:00Z"))).toBe("enfileirado");
  });

  it("conclusão às 19h30: com 2 h cairia às 21h30, fora da janela 8h–20h: sai às 8h do dia seguinte", async () => {
    await ligado();
    const p = await cliente();
    const { visitId } = await visita(p.contactId, "2026-10-20", "17:00", 1);
    await finishAll(visitId, bahia("2026-10-20", "19:30"));
    expect(await afterVisitDone(visitId, bahia("2026-10-20", "19:30"))).toBe("enfileirado");
    expect((await outboxRows())[0].notBefore).toEqual(bahia("2026-10-21", "08:00"));
  });

  it("Avec importado no dia seguinte: o job pega a visita concluída há menos de 24 h; mais velha que isso não sai", async () => {
    await ligado();
    const p = await cliente();
    const velha = await cliente("Rita Lima");
    const avec = (contactId: string, startsAt: Date, updatedAt: Date) => db.insert(appointments).values({ contactId, clientName: "x", professionalId: s.ana.id, serviceId: s.corte.id,
      serviceLabel: "Corte", startsAt, durationMin: 60, status: "compareceu", origin: "avec", externalKey: `avec:${++seq}`, updatedAt });
    await avec(p.contactId, bahia("2026-10-20", "14:00"), bahia("2026-10-21", "09:00")); // a importação do Avec de manhã deu a baixa
    await avec(velha.contactId, bahia("2026-10-19", "14:00"), bahia("2026-10-20", "08:00")); // 25 h antes do job
    const now = bahia("2026-10-21", "09:10");
    expect(await runAfterVisit(now)).toEqual({ enqueued: 1 });
    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dealId: p.dealId, notBefore: bahia("2026-10-21", "11:00") });
    expect(await runAfterVisit(bahia("2026-10-21", "09:25"))).toEqual({ enqueued: 0 });
  });

  it("Finalizado na Agenda (porta única) dispara sozinho, depois do commit", async () => {
    await ligado();
    const p = await cliente();
    const v = await visita(p.contactId, "2026-10-20", "13:00", 1);
    await setAppointmentStatus(v.appointmentIds[0], "compareceu", s.cati.id, { via: "recepcao", now: bahia("2026-10-20", "14:00") });
    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dealId: p.dealId, notBefore: bahia("2026-10-20", "16:00"), options: { source: `${AFTER_VISIT_SOURCE}${v.visitId}` } });
  });

  it("erro no Depois do atendimento nunca derruba o Finalizado", async () => {
    await ligado();
    const p = await cliente();
    const v = await visita(p.contactId, "2026-10-20", "13:00", 1);
    const spy = vi.spyOn(afterVisitHook, "done").mockRejectedValueOnce(new Error("banco caiu"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(setAppointmentStatus(v.appointmentIds[0], "compareceu", s.cati.id, { via: "recepcao", now: bahia("2026-10-20", "14:00") })).resolves.toMatchObject({ changed: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(quiet).toHaveBeenCalled();
    spy.mockRestore(); quiet.mockRestore();
    expect((await db.select().from(appointments).where(eq(appointments.id, v.appointmentIds[0])))[0].status).toBe("compareceu");
  });

  it("comanda fechada no caixa do CRM dispara pelo mesmo caminho (sem duplicar com o Finalizado)", async () => {
    await ligado();
    const p = await cliente();
    const now = bahia("2026-10-20", "15:00");
    const v = await visita(p.contactId);
    const c = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, now);
    await addPayment(c.comandaId, { method: "pix", valueCents: 21000 }, s.caixaRecepcao, now);
    await closeComanda(c.comandaId, {}, s.caixaRecepcao, now);
    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dealId: p.dealId, notBefore: bahia("2026-10-20", "17:00"), options: { source: `${AFTER_VISIT_SOURCE}${v.visitId}` } });
    expect(await runAfterVisit(now)).toEqual({ enqueued: 0 });
    expect(await afterVisitDone(v.visitId, now)).toBe("ja_tem");
    expect(await outboxRows()).toHaveLength(1);
  });

  it("modo desligado ou link do Google vazio no agradecimento: não enfileira e o servidor não deixa ligar", async () => {
    const p = await cliente();
    const { visitId } = await visita(p.contactId);
    await finishAll(visitId, at("2026-10-20T17:00:00Z"));
    expect((await getAfterVisit()).mode).toBe("desligado"); // nasce desligado
    expect(await afterVisitDone(visitId, at("2026-10-20T17:00:00Z"))).toBe("desligado");
    expect(await runAfterVisit(at("2026-10-20T17:05:00Z"))).toEqual({ enqueued: 0 });
    await expect(ligado({ linkGoogle: null })).rejects.toThrow("Ponha o link da Avaliação no Google para ligar o agradecimento.");
    await expect(ligado({ linkGoogle: "" })).rejects.toThrow("Ponha o link da Avaliação no Google para ligar o agradecimento.");
    // Gravado à mão sem o link: continua sem enfileirar.
    await setSetting("depois_atendimento", { ...(await getAfterVisit()), mode: "agradecimento", linkGoogle: null });
    expect(await afterVisitDone(visitId, at("2026-10-20T17:00:00Z"))).toBe("desligado");
    expect(await outboxRows()).toHaveLength(0);
  });

  it("cliente sem conversa: não enfileira (o envio é sempre por uma conversa)", async () => {
    await ligado();
    const [c] = await db.insert(contacts).values({ name: "Sem Conversa", phoneE164: "+5571977770000" }).returning();
    const { visitId } = await visita(c.id);
    await finishAll(visitId, at("2026-10-20T17:00:00Z"));
    expect(await afterVisitDone(visitId, at("2026-10-20T17:00:00Z"))).toBe("sem_conversa");
    expect(await outboxRows()).toHaveLength(0);
  });
});

describe("Depois do atendimento: tudo configurável (regra do dono)", () => {
  it("o padrão: desligado, 2 h depois, janela 8h–20h, até 24 h, textos da Casa", async () => {
    expect(await getAfterVisit()).toMatchObject({ mode: "desligado", delayMinutes: 120, janelaInicio: 8, janelaFim: 20, horasMax: 24, textoAgradecimento: CASA_AGRADECIMENTO, linkGoogle: null, notaAltaMin: 4, etiquetaNotaBaixa: "Nota baixa",
      textoNotaBaixa: "{nome} deu nota {nota} para {servicos} com {profissionais}. Fale com ela hoje." });
  });

  it("atraso de 30 min e janela até as 22h: a conclusão às 19h30 sai às 20h do mesmo dia", async () => {
    await ligado({ delayMinutes: 30, janelaFim: 22 });
    const p = await cliente();
    const { visitId } = await visita(p.contactId, "2026-10-20", "17:00", 1);
    await finishAll(visitId, bahia("2026-10-20", "19:30"));
    expect(await afterVisitDone(visitId, bahia("2026-10-20", "19:30"))).toBe("enfileirado");
    expect((await outboxRows())[0].notBefore).toEqual(bahia("2026-10-20", "20:00"));
  });

  it("limite de 48 h: o job pega a visita concluída há 25 h", async () => {
    await ligado({ horasMax: 48 });
    const p = await cliente();
    await db.insert(appointments).values({ contactId: p.contactId, clientName: "x", professionalId: s.ana.id, serviceId: s.corte.id, serviceLabel: "Corte",
      startsAt: bahia("2026-10-20", "07:00"), durationMin: 60, status: "compareceu", origin: "avec", externalKey: "avec:48", updatedAt: bahia("2026-10-20", "08:00") });
    expect(await runAfterVisit(bahia("2026-10-21", "09:10"))).toEqual({ enqueued: 1 });
  });

  it("valores fora do limite são recusados; quem salvou fica na auditoria", async () => {
    await expect(ligado({ delayMinutes: 20 })).rejects.toThrow();
    await expect(ligado({ delayMinutes: 1441 })).rejects.toThrow();
    await expect(ligado({ janelaInicio: 20, janelaFim: 8 })).rejects.toThrow("A janela precisa começar antes de terminar.");
    await expect(ligado({ horasMax: 73 })).rejects.toThrow();
    await expect(ligado({ linkGoogle: "não é link" })).rejects.toThrow();
    // Validação cruzada: 1.440 min depois com limite de 24 h cancelaria toda mensagem no envio.
    await expect(ligado({ delayMinutes: 1440 })).rejects.toThrow("pode levar até 36 h para sair. Aumente o limite para pelo menos 37 h");
    await expect(ligado({ horasMax: 14 })).rejects.toThrow("pode levar até 14 h para sair. Aumente o limite para pelo menos 15 h");
    await ligado();
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, "depois_atendimento"))).map((a) => a.action)).toEqual(["ligou"]);
  });
});

describe("Depois do atendimento: nenhum valor aceito cancela toda mensagem (validação cruzada)", () => {
  it("no limite aceito (2 h depois, janela 8h–20h, limite de 15 h): a conclusão às 18h, a pior hora, sai às 8h do dia seguinte", async () => {
    await ligado({ horasMax: 15 });
    const p = await cliente();
    const { visitId } = await visita(p.contactId, "2026-10-20", "16:00", 1);
    await finishAll(visitId, bahia("2026-10-20", "18:00"));
    expect(await afterVisitDone(visitId, bahia("2026-10-20", "18:00"))).toBe("enfileirado");
    expect((await outboxRows())[0].notBefore).toEqual(bahia("2026-10-21", "08:00"));
    expect((await drainOutbox(bahia("2026-10-21", "08:00"))).sent).toBe(1);
    expect(sent).toHaveLength(1);
  });
});

describe("Depois do atendimento: na hora de enviar (processItem reconfere)", () => {
  const prepara = async () => {
    await ligado();
    const p = await cliente();
    const v = await visita(p.contactId);
    await finishAll(v.visitId, bahia("2026-10-20", "14:00"));
    await afterVisitDone(v.visitId, bahia("2026-10-20", "14:00"));
    return v;
  };
  const status = async () => (await outboxRows()).map((o) => [o.status, o.error]);

  it("sai às 16h com o texto refeito na hora (texto mudado depois de enfileirar)", async () => {
    await prepara();
    await ligado({ textoAgradecimento: "Oi, {primeiro_nome}! Obrigada 💛 {link_google}" });
    expect((await drainOutbox(bahia("2026-10-20", "15:59"))).sent).toBe(0);
    expect((await drainOutbox(bahia("2026-10-20", "16:00"))).sent).toBe(1);
    expect(sent).toEqual([`Oi, Paula! Obrigada 💛 ${GOOGLE}`]);
  });

  it("dentro da janela sai com a Casa fechada; fora da janela espera", async () => {
    await ligado();
    const p = await cliente();
    const { visitId } = await visita(p.contactId, "2026-10-20", "17:00", 1);
    await finishAll(visitId, bahia("2026-10-20", "19:30"));
    await afterVisitDone(visitId, bahia("2026-10-20", "19:30"));
    await db.update(outbox).set({ notBefore: bahia("2026-10-20", "21:00") });
    expect((await drainOutbox(bahia("2026-10-20", "21:30"))).sent).toBe(0); // 21h30: fora da janela
    expect(await status()).toEqual([["pending", null]]);
    await setSetting("business_hours", { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }); // Casa fechada
    expect((await drainOutbox(bahia("2026-10-21", "08:00"))).sent).toBe(1);
  });

  it("desligado depois de enfileirar: cancela", async () => {
    await prepara();
    await saveAfterVisit({ ...(await getAfterVisit()), mode: "desligado" }, s.gestora.id);
    await drainOutbox(bahia("2026-10-20", "16:00"));
    expect(await status()).toEqual([["cancelled", "O Depois do atendimento foi desligado."]]);
    expect(sent).toEqual([]);
  });

  it("visita que deixou de estar concluída (Desfazer o Finalizado): cancela", async () => {
    const v = await prepara();
    await db.update(appointments).set({ status: "em_atendimento" }).where(inArray(appointments.id, v.appointmentIds));
    await drainOutbox(bahia("2026-10-20", "16:00"));
    expect(await status()).toEqual([["cancelled", "A visita não está mais concluída."]]);
  });

  it("passou do limite de horas desde a conclusão: cancela", async () => {
    await prepara();
    await drainOutbox(bahia("2026-10-21", "14:01"));
    expect(await status()).toEqual([["cancelled", "Passou de 24 h desde o atendimento."]]);
  });

  it("mudou para a Pesquisa de satisfação depois de enfileirar: sai a enquete, não o agradecimento (uma mensagem só)", async () => {
    await prepara();
    await setSetting("depois_atendimento", { ...(await getAfterVisit()), mode: "pesquisa" });
    expect((await drainOutbox(bahia("2026-10-20", "16:00"))).sent).toBe(1);
    expect(await status()).toEqual([["sent", null]]);
    expect((await outboxRows())[0]).toMatchObject({ kind: "poll", text: "Paula, de 1 a 5, como foi seu atendimento hoje na Casa Fiaes?" });
    expect(sent).toEqual([]);
  });
});

describe("Virada (Task 10): o Depois do atendimento só liga com o agradecimento do Avec desligado, o texto conferido e o teste recebido", () => {
  const cfg = async (mode: AfterVisitConfig["mode"]) => ({ ...(await getAfterVisit()), mode, linkGoogle: GOOGLE });
  it("mesma trava do lembrete, com avec_agradecimento", async () => {
    await expect(saveAfterVisit(await cfg("agradecimento"), s.gestora.id, { confirmouEnvio: true })).rejects.toThrow(VIRADA_FALTA.depois);
    await fazerVirada("lembrete", s.gestora.id); // a Virada do lembrete não vale para o Depois do atendimento
    await expect(saveAfterVisit(await cfg("agradecimento"), s.gestora.id, { confirmouEnvio: true })).rejects.toThrow(VIRADA_FALTA.depois);
    await db.insert(auditLog).values({ userId: s.gestora.id, action: "teste_virada", entity: "virada", entityId: "depois", data: { modo: "agradecimento" } });
    await saveVirada("depois", ["texto_conferido", "teste_enviado"], s.gestora.id);
    await expect(saveAfterVisit(await cfg("agradecimento"), s.gestora.id, { confirmouEnvio: true })).rejects.toThrow(VIRADA_FALTA.depois);
    await saveVirada("depois", [...VIRADA_ITENS.depois], s.gestora.id);
    await expect(saveAfterVisit(await cfg("agradecimento"), s.gestora.id)).rejects.toThrow("Confirme o envio real para ligar.");
    await expect(saveAfterVisit(await cfg("agradecimento"), s.gestora.id, { confirmouEnvio: true })).resolves.toBeUndefined();
    expect((await getAfterVisit()).mode).toBe("agradecimento");
  });

  it("o teste vale para o modo testado: o do agradecimento não liga a Pesquisa de satisfação", async () => {
    await fazerVirada("depois", s.gestora.id, "agradecimento");
    await expect(saveAfterVisit(await cfg("pesquisa"), s.gestora.id, { confirmouEnvio: true })).rejects.toThrow("Mande o teste");
    expect((await getAfterVisit()).mode).toBe("desligado");
  });

  it("trocar agradecimento ↔ pesquisa com ele ligado é ligar o modo novo: pede o teste desse modo e a confirmação de envio real (fix 1)", async () => {
    await ligado(); // agradecimento
    await expect(saveAfterVisit(await cfg("pesquisa"), s.gestora.id)).rejects.toThrow("Mande o teste");
    await db.insert(auditLog).values({ userId: s.gestora.id, action: "teste_virada", entity: "virada", entityId: "depois", data: { modo: "pesquisa" } });
    await expect(saveAfterVisit(await cfg("pesquisa"), s.gestora.id)).rejects.toThrow("Confirme o envio real para ligar.");
    expect((await getAfterVisit()).mode).toBe("agradecimento");
    await expect(saveAfterVisit(await cfg("pesquisa"), s.gestora.id, { confirmouEnvio: true })).resolves.toBeUndefined();
    expect((await getAfterVisit()).mode).toBe("pesquisa");
    // Editar no mesmo modo continua sem pedir de novo.
    await expect(saveAfterVisit({ ...(await cfg("pesquisa")), delayMinutes: 90 }, s.gestora.id)).resolves.toBeUndefined();
  });

  it("desligar não pede virada e zera o checklist (o que está na fila cancela no envio: 'desligado depois de enfileirar')", async () => {
    await ligado();
    await saveVirada("depois", [], s.gestora.id); // nem o checklist desfeito impede desligar
    await expect(saveAfterVisit(await cfg("desligado"), s.gestora.id)).resolves.toBeUndefined();
    await ligado();
    await saveAfterVisit(await cfg("desligado"), s.gestora.id);
    expect((await getVirada("depois"))?.marcados).toEqual([]);
    await expect(saveAfterVisit(await cfg("agradecimento"), s.gestora.id, { confirmouEnvio: true })).rejects.toThrow(VIRADA_FALTA.depois);
  });
});
