import { expect, it } from "vitest";
import { contactsCsv, type ContactExportRow } from "./contacts-csv";

const row = (o: Partial<ContactExportRow> = {}): ContactExportRow => ({
  id: "c1", name: "Rita Fictícia", phone: "+5571966000601", email: "rita@exemplo.com", instagram: null, isClient: true, clientSince: null, lastServiceAt: null,
  ignored: false, hasAvatar: false, lastDealId: null, openDealId: null, openDealOwnerId: null, openDealOwnerName: "Sara Lima", deals: 1, snippet: null,
  visits: 7, lastVisitOn: "2026-09-25", nextAppointmentAt: null, nextProfessional: null, preferredProfessional: "MAIARA", pkg: { used: 3, total: 10 },
  birthday: "17/10", origin: "Instagram", situation: "última visita há 20 dias", states: [], tags: ["Noiva", "VIP"], totalCents: 123_456, ...o,
});

it("CSV sem coluna de valor para quem não vê valores", () => {
  const csv = contactsCsv([row()], { money: false });
  const [header, line] = csv.replace(/^﻿/, "").split("\r\n");
  expect(header).toBe("Nome;Telefone;E-mail;Situação;Última visita;Visitas;Próximo horário;Profissional preferida;Pacote;Aniversário;Responsável;Etiquetas;Como conheceu");
  expect(line).toBe("Rita Fictícia;(71) 96600-0601;rita@exemplo.com;última visita há 20 dias;25/09/2026;7;;Maiara;3/10;17/10;Sara Lima;Noiva, VIP;Instagram");
  expect(csv).not.toMatch(/1234|Total gasto/);
});

it("com 'ver valores': coluna Total gasto; número oculto sai vazio; fórmula vira texto", () => {
  const csv = contactsCsv([row({ phone: "lid:777", name: "=HYPERLINK(\"x\")" })], { money: true });
  const [header, line] = csv.replace(/^﻿/, "").split("\r\n");
  expect(header.endsWith(";Total gasto (R$)")).toBe(true);
  expect(line.startsWith(`"'=HYPERLINK(""x"")";;`)).toBe(true);
  expect(line.endsWith(";1234,56")).toBe(true);
});

it("Como conheceu: a origem gravada como Retorno sugerido sai como Hora de voltar", () => {
  const csv = contactsCsv([row({ origin: "Retorno sugerido" })], { money: false });
  expect(csv.split("\r\n")[1].endsWith(";Hora de voltar")).toBe(true);
});
